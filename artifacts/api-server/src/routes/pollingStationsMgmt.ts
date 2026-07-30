/**
 * Polling Stations Management API
 *
 * polling_stations holds shared geographic/infrastructure data.
 * Per-tenant campaign state (accreditation, training, agent assignments) is stored
 * in campaign_station_profiles, scoped to the active tenant.
 *
 * All 24,594 real stations are visible to any authenticated campaign user —
 * a campaign does not need to have deployed agents to view or profile a station.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  pollingStationsTable,
  pollingAgentsTable,
  campaignStationProfilesTable,
  resultSubmissionsTable,
  pollingCentresTable,
  wardsTable,
  constituenciesTable,
  countiesTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, count, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { resolveTenant } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canViewStations = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "returning-officer",
  "county-coordinator",
  "constituency-coordinator",
  "polling-agent-supervisor",
]);

const canManageStations = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "returning-officer",
  "county-coordinator",
]);

// GET /api/polling-stations-mgmt/stations
// Returns ALL polling stations. Per-tenant campaign profile (agent assignment,
// accreditation, etc.) is joined per-page. A campaign can view any station
// regardless of whether it has deployed agents there.
router.get("/stations", requireAuth, resolveTenant, canViewStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { countyId, constituencyId, wardId, search, unassigned, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(parseInt(limit as string) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (countyId) conditions.push(eq(pollingStationsTable.countyId, countyId as string));
    if (constituencyId) conditions.push(eq(pollingStationsTable.constituencyId, constituencyId as string));
    if (wardId) conditions.push(eq(pollingStationsTable.wardId, wardId as string));
    if (search) {
      conditions.push(or(
        ilike(pollingStationsTable.name, `%${search}%`),
        ilike(pollingStationsTable.code, `%${search}%`),
      ));
    }

    // Unassigned filter: exclude stations where this tenant has already assigned a primary agent
    if (unassigned === "true") {
      const assignedSq = db
        .selectDistinct({ stationId: campaignStationProfilesTable.stationId })
        .from(campaignStationProfilesTable)
        .where(and(
          tenantFilter(campaignStationProfilesTable, t.id),
          isNotNull(campaignStationProfilesTable.primaryAgentId),
        ));
      conditions.push(notInArray(pollingStationsTable.id, assignedSq));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }], [{ totalAll }], [{ assignedCount }], counties] = await Promise.all([
      // Main page of results with geography names joined
      db.select({
        id: pollingStationsTable.id,
        code: pollingStationsTable.code,
        name: pollingStationsTable.name,
        registeredVoters: pollingStationsTable.registeredVoters,
        wardId: pollingStationsTable.wardId,
        constituencyId: pollingStationsTable.constituencyId,
        countyId: pollingStationsTable.countyId,
        wardName: wardsTable.name,
        constituencyName: constituenciesTable.name,
        countyName: countiesTable.name,
        pollingCentreName: pollingCentresTable.name,
      })
        .from(pollingStationsTable)
        .innerJoin(wardsTable, eq(pollingStationsTable.wardId, wardsTable.id))
        .innerJoin(constituenciesTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
        .innerJoin(countiesTable, eq(pollingStationsTable.countyId, countiesTable.id))
        .innerJoin(pollingCentresTable, eq(pollingStationsTable.centreId, pollingCentresTable.id))
        .where(where)
        .orderBy(pollingStationsTable.code)
        .limit(pageSize)
        .offset(offset),

      // Filtered total
      db.select({ total: count() }).from(pollingStationsTable).where(where),

      // Grand total (no filters) for coverage denominator
      db.select({ totalAll: count() }).from(pollingStationsTable),

      // Stations with a primary agent assigned in this campaign
      db.select({ assignedCount: count() })
        .from(campaignStationProfilesTable)
        .where(and(
          tenantFilter(campaignStationProfilesTable, t.id),
          isNotNull(campaignStationProfilesTable.primaryAgentId),
        )),

      // All counties for the filter dropdown
      db.select({ id: countiesTable.id, name: countiesTable.name })
        .from(countiesTable)
        .orderBy(countiesTable.name),
    ]);

    // Attach this campaign's profile to each station in the current page
    const stationIds = rows.map(r => r.id);
    const profiles = stationIds.length
      ? await db.select()
          .from(campaignStationProfilesTable)
          .where(and(
            inArray(campaignStationProfilesTable.stationId, stationIds),
            tenantFilter(campaignStationProfilesTable, t.id),
          ))
      : [];
    const profileMap = new Map(profiles.map(p => [p.stationId, p]));

    const data = rows.map(s => {
      const profile = profileMap.get(s.id) ?? null;
      return {
        ...s,
        campaignProfile: profile,
        hasAgent: !!(profile?.primaryAgentId),
        accreditationStatus: profile?.accreditationStatus ?? "pending",
        trainingStatus: profile?.trainingStatus ?? "pending",
        contactStatus: profile?.contactStatus ?? "pending",
        reportingStatus: profile?.reportingStatus ?? "not_reported",
      };
    });

    res.json({
      data,
      total: Number(total),
      totalAll: Number(totalAll),
      assignedCount: Number(assignedCount),
      page: pageNum,
      pageSize,
      counties,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-stations-mgmt/stations/:id
// Returns a single station with its geography and this campaign's profile.
// Any authenticated campaign user can view any station in the geography.
router.get("/stations/:id", requireAuth, resolveTenant, canViewStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);

    const [row] = await db.select({
      id: pollingStationsTable.id,
      code: pollingStationsTable.code,
      name: pollingStationsTable.name,
      registeredVoters: pollingStationsTable.registeredVoters,
      latitude: pollingStationsTable.latitude,
      longitude: pollingStationsTable.longitude,
      wardName: wardsTable.name,
      constituencyName: constituenciesTable.name,
      countyName: countiesTable.name,
      pollingCentreName: pollingCentresTable.name,
    })
      .from(pollingStationsTable)
      .innerJoin(wardsTable, eq(pollingStationsTable.wardId, wardsTable.id))
      .innerJoin(constituenciesTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
      .innerJoin(countiesTable, eq(pollingStationsTable.countyId, countiesTable.id))
      .innerJoin(pollingCentresTable, eq(pollingStationsTable.centreId, pollingCentresTable.id))
      .where(eq(pollingStationsTable.id, req.params.id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Station not found" });

    // Fetch this campaign's profile and any deployed agents
    const [campaignProfile, agents] = await Promise.all([
      db.select()
        .from(campaignStationProfilesTable)
        .where(and(
          eq(campaignStationProfilesTable.stationId, req.params.id),
          tenantFilter(campaignStationProfilesTable, t.id),
        ))
        .limit(1)
        .then(rows => rows[0] ?? null),

      db.select()
        .from(pollingAgentsTable)
        .where(and(
          eq(pollingAgentsTable.pollingStationId, req.params.id),
          tenantFilter(pollingAgentsTable, t.id),
        )),
    ]);

    // Resolve primary/backup agent details via the profile's agent IDs
    let primaryAgent: any = null;
    let backupAgent: any = null;
    const agentIds = [campaignProfile?.primaryAgentId, campaignProfile?.backupAgentId].filter(Boolean) as string[];
    if (agentIds.length) {
      const agentRows = await db.select()
        .from(pollingAgentsTable)
        .where(inArray(pollingAgentsTable.id, agentIds));
      primaryAgent = agentRows.find(a => a.id === campaignProfile?.primaryAgentId) ?? null;
      backupAgent = agentRows.find(a => a.id === campaignProfile?.backupAgentId) ?? null;
    }

    res.json({
      ...row,
      campaignProfile,
      agents,
      primaryAgent,
      backupAgent,
      accreditationStatus: campaignProfile?.accreditationStatus ?? "pending",
      trainingStatus: campaignProfile?.trainingStatus ?? "pending",
      contactStatus: campaignProfile?.contactStatus ?? "pending",
      reportingStatus: campaignProfile?.reportingStatus ?? "not_reported",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-stations-mgmt/stations/:id
// Upserts this campaign's profile for a station. Never touches the shared station row.
// Any station in the geography can be profiled, even without deployed agents.
router.patch("/stations/:id", requireAuth, resolveTenant, canManageStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);

    const { primaryAgentId, backupAgentId, accreditationStatus, trainingStatus, contactStatus, reportingStatus } = req.body;
    const updateData: any = {};
    if (primaryAgentId !== undefined) updateData.primaryAgentId = primaryAgentId;
    if (backupAgentId !== undefined) updateData.backupAgentId = backupAgentId;
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    if (!Object.keys(updateData).length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    // Confirm the station exists in the shared geography
    const [exists] = await db.select({ id: pollingStationsTable.id })
      .from(pollingStationsTable)
      .where(eq(pollingStationsTable.id, req.params.id))
      .limit(1);
    if (!exists) return res.status(404).json({ error: "Station not found" });

    const [profile] = await db.insert(campaignStationProfilesTable)
      .values({ tenantId: t.id, stationId: req.params.id, ...updateData })
      .onConflictDoUpdate({
        target: [campaignStationProfilesTable.tenantId, campaignStationProfilesTable.stationId],
        set: { ...updateData, updatedAt: new Date() },
      })
      .returning();
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-stations-mgmt/stations/import
// Bulk-upserts shared station master data (admin-only path, rarely used now that
// the seed covers all 24,594 real stations).
router.post("/stations/import", requireAuth, resolveTenant, canManageStations, async (req: any, res: any) => {
  try {
    assertTenant(req);
    const stations: any[] = req.body;
    if (!Array.isArray(stations) || stations.length === 0) {
      return res.status(400).json({ error: "Expected a non-empty JSON array" });
    }

    const results: any[] = [];
    for (const s of stations) {
      if (!s.code || !s.name) {
        results.push({ code: s.code, status: "skipped", reason: "missing code or name" });
        continue;
      }
      try {
        const [row] = await db.insert(pollingStationsTable)
          .values({
            code: s.code,
            name: s.name,
            centreId: s.pollingCentreId,
            wardId: s.wardId,
            constituencyId: s.constituencyId,
            countyId: s.countyId,
            registeredVoters: s.registeredVoters ?? 0,
          })
          .onConflictDoUpdate({
            target: pollingStationsTable.code,
            set: { name: s.name, registeredVoters: s.registeredVoters ?? 0 },
          })
          .returning({ id: pollingStationsTable.id });
        results.push({ code: s.code, status: "ok", id: row.id });
      } catch (e: any) {
        results.push({ code: s.code, status: "error", reason: e.message });
      }
    }
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-stations-mgmt/stations/bulk-status
// Bulk-upserts campaign_station_profiles for a set of station IDs.
router.post("/stations/bulk-status", requireAuth, resolveTenant, canManageStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { stationIds, accreditationStatus, trainingStatus, contactStatus, reportingStatus } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ error: "stationIds array required" });
    }

    const updateData: any = {};
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    if (!Object.keys(updateData).length) {
      return res.status(400).json({ error: "No status fields to update" });
    }

    let updated = 0;
    for (const stationId of stationIds) {
      await db.insert(campaignStationProfilesTable)
        .values({ tenantId: t.id, stationId, ...updateData })
        .onConflictDoUpdate({
          target: [campaignStationProfilesTable.tenantId, campaignStationProfilesTable.stationId],
          set: { ...updateData, updatedAt: new Date() },
        });
      updated++;
    }

    res.json({ updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-stations-mgmt/coverage-gaps
// Returns station-agent coverage aggregated by ward (county + constituency names
// denormalised), plus a campaign-level summary.  Left-joins the tenant-scoped
// campaignStationProfiles so only agent assignments for this campaign are counted.
//
// SQL COUNT(column) ignores NULLs, so count(primaryAgentId) naturally gives the
// number of stations where this campaign has assigned a primary agent.
router.get("/coverage-gaps", requireAuth, resolveTenant, canViewStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { countyId, constituencyId } = req.query;

    const conditions: any[] = [];
    if (countyId) conditions.push(eq(pollingStationsTable.countyId, countyId as string));
    if (constituencyId) conditions.push(eq(pollingStationsTable.constituencyId, constituencyId as string));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ grandTotal }], [{ grandAssigned }], counties] = await Promise.all([
      // Ward-level breakdown: total stations vs assigned by this campaign
      db
        .select({
          countyId:          countiesTable.id,
          countyName:        countiesTable.name,
          constituencyId:    constituenciesTable.id,
          constituencyName:  constituenciesTable.name,
          wardId:            wardsTable.id,
          wardName:          wardsTable.name,
          total:             count(pollingStationsTable.id),
          // count() ignores NULLs — stations with no profile row return NULL from
          // the left-join and are therefore not counted as assigned.
          assigned: sql<number>`count(${campaignStationProfilesTable.primaryAgentId})::int`,
        })
        .from(pollingStationsTable)
        .innerJoin(wardsTable,         eq(pollingStationsTable.wardId,         wardsTable.id))
        .innerJoin(constituenciesTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
        .innerJoin(countiesTable,       eq(pollingStationsTable.countyId,       countiesTable.id))
        .leftJoin(
          campaignStationProfilesTable,
          and(
            eq(campaignStationProfilesTable.stationId, pollingStationsTable.id),
            eq(campaignStationProfilesTable.tenantId,  t.id),
          ),
        )
        .where(where)
        .groupBy(
          countiesTable.id,         countiesTable.name,
          constituenciesTable.id,   constituenciesTable.name,
          wardsTable.id,            wardsTable.name,
        )
        .orderBy(countiesTable.name, constituenciesTable.name, wardsTable.name),

      // Grand total — ALL stations (no tenant filter; stations are global geography)
      db.select({ grandTotal: count() }).from(pollingStationsTable),

      // Grand assigned count for this tenant specifically
      db
        .select({ grandAssigned: sql<number>`count(${campaignStationProfilesTable.primaryAgentId})::int` })
        .from(campaignStationProfilesTable)
        .where(and(
          tenantFilter(campaignStationProfilesTable, t.id),
          isNotNull(campaignStationProfilesTable.primaryAgentId),
        )),

      // County list for the filter dropdown
      db.select({ id: countiesTable.id, name: countiesTable.name })
        .from(countiesTable)
        .orderBy(countiesTable.name),
    ]);

    const total    = Number(grandTotal);
    const assigned = Number(grandAssigned);

    res.json({
      summary: {
        total,
        assigned,
        unassigned:  total - assigned,
        coveragePct: total > 0 ? Math.round((assigned / total) * 100) : 0,
      },
      rows: rows.map(r => ({
        ...r,
        total:      Number(r.total),
        assigned:   Number(r.assigned),
        unassigned: Number(r.total) - Number(r.assigned),
      })),
      counties,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
