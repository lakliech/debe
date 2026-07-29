/**
 * Polling Stations Management API
 *
 * polling_stations holds shared geographic/infrastructure data only.
 * Per-tenant campaign state (accreditation, training, agent assignments) is stored
 * in campaign_station_profiles, scoped to the active tenant.
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
import { eq, desc, and, or, ilike, count, inArray, sql } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
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
// Returns only stations where this campaign has deployed at least one agent.
router.get("/stations", requireAuth, canViewStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { countyId, constituencyId, wardId, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    // Base conditions on the shared stations table
    const stationConditions: any[] = [];
    if (countyId) stationConditions.push(eq(pollingStationsTable.countyId, countyId));
    if (constituencyId) stationConditions.push(eq(pollingStationsTable.constituencyId, constituencyId));
    if (wardId) stationConditions.push(eq(pollingStationsTable.wardId, wardId));
    if (search) stationConditions.push(or(
      ilike(pollingStationsTable.name, `%${search}%`),
      ilike(pollingStationsTable.code, `%${search}%`),
    ));

    // Scope to stations where this tenant has agents
    const agentStationIds = await db
      .selectDistinct({ stationId: pollingAgentsTable.pollingStationId })
      .from(pollingAgentsTable)
      .where(tenantFilter(pollingAgentsTable, t.id));
    const tenantStationIds = agentStationIds
      .map(r => r.stationId)
      .filter((id): id is string => !!id);

    if (tenantStationIds.length === 0) {
      const [counties, constituencies] = await Promise.all([
        db.select({ id: countiesTable.id, name: countiesTable.name }).from(countiesTable).orderBy(countiesTable.name),
        db.select({ id: constituenciesTable.id, name: constituenciesTable.name, countyId: constituenciesTable.countyId })
          .from(constituenciesTable).orderBy(constituenciesTable.name),
      ]);
      return res.json({ data: [], total: 0, page: pageNum, pageSize, counties, constituencies });
    }

    const where = and(
      inArray(pollingStationsTable.id, tenantStationIds),
      ...(stationConditions.length ? stationConditions : []),
    );

    const [rows, [{ total }], counties, constituencies] = await Promise.all([
      db.select().from(pollingStationsTable)
        .where(where)
        .orderBy(pollingStationsTable.code)
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(pollingStationsTable).where(where),
      db.select({ id: countiesTable.id, name: countiesTable.name }).from(countiesTable).orderBy(countiesTable.name),
      db.select({ id: constituenciesTable.id, name: constituenciesTable.name, countyId: constituenciesTable.countyId })
        .from(constituenciesTable).orderBy(constituenciesTable.name),
    ]);

    // Attach tenant-specific profiles to each station row
    const profiles = await db.select().from(campaignStationProfilesTable)
      .where(and(
        inArray(campaignStationProfilesTable.stationId, rows.map(r => r.id)),
        tenantFilter(campaignStationProfilesTable, t.id),
      ));
    const profileMap = new Map(profiles.map(p => [p.stationId, p]));

    const data = rows.map(s => ({ ...s, campaignProfile: profileMap.get(s.id) ?? null }));
    res.json({ data, total: Number(total), page: pageNum, pageSize, counties, constituencies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-stations-mgmt/stations/:id
router.get("/stations/:id", requireAuth, canViewStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);

    // Verify this tenant has at least one agent at this station
    const [tenantAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.pollingStationId, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!tenantAgent) return res.status(404).json({ error: "Station not found" });

    const [station] = await db.select().from(pollingStationsTable)
      .where(eq(pollingStationsTable.id, req.params.id)).limit(1);
    if (!station) return res.status(404).json({ error: "Station not found" });

    // Fetch tenant-specific campaign profile and tenant-scoped child records
    const [campaignProfile, agents, submissions] = await Promise.all([
      db.select().from(campaignStationProfilesTable)
        .where(and(eq(campaignStationProfilesTable.stationId, req.params.id), tenantFilter(campaignStationProfilesTable, t.id)))
        .limit(1).then(rows => rows[0] ?? null),
      db.select().from(pollingAgentsTable)
        .where(and(eq(pollingAgentsTable.pollingStationId, req.params.id), tenantFilter(pollingAgentsTable, t.id))),
      db.select({ id: resultSubmissionsTable.id, status: resultSubmissionsTable.status, submittedAt: resultSubmissionsTable.submittedAt })
        .from(resultSubmissionsTable)
        .where(and(eq(resultSubmissionsTable.pollingStationId, req.params.id), tenantFilter(resultSubmissionsTable, t.id)))
        .orderBy(desc(resultSubmissionsTable.createdAt))
        .limit(10),
    ]);

    const primaryAgent = agents.find((a: any) => !a.isBackup) ?? null;
    const backupAgent = agents.find((a: any) => a.isBackup) ?? null;

    res.json({ ...station, campaignProfile, agents, primaryAgent, backupAgent, submissionSummary: submissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-stations-mgmt/stations/:id
// Updates this tenant's campaign_station_profiles row (upsert). Never touches shared station fields.
router.patch("/stations/:id", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify tenant has at least one agent at this station
    const [tenantAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.pollingStationId, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!tenantAgent) return res.status(404).json({ error: "Station not found" });

    const { primaryAgentId, backupAgentId, accreditationStatus, trainingStatus, contactStatus, reportingStatus } = req.body;
    const updateData: any = {};
    if (primaryAgentId !== undefined) updateData.primaryAgentId = primaryAgentId;
    if (backupAgentId !== undefined) updateData.backupAgentId = backupAgentId;
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    // Upsert into campaign_station_profiles — tenant-scoped, never touches shared station rows
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
router.post("/stations/import", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    // assertTenant so only authenticated campaign users can import station master data
    assertTenant(req);
    const stations: any[] = req.body;
    if (!Array.isArray(stations) || stations.length === 0) {
      return res.status(400).json({ error: "Expected a non-empty JSON array" });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const s of stations) {
      try {
        if (!s.centreId) {
          return res.status(400).json({ error: `Station ${s.code}: centreId required` });
        }

        const [row] = await db.insert(pollingStationsTable).values({
          code: s.code,
          name: s.name,
          centreId: s.centreId,
          wardId: s.wardId,
          constituencyId: s.constituencyId,
          countyId: s.countyId,
          registeredVoters: s.registeredVoters ?? 0,
          latitude: s.lat ?? s.latitude,
          longitude: s.lon ?? s.longitude,
        }).onConflictDoUpdate({
          target: pollingStationsTable.code,
          set: {
            name: s.name,
            registeredVoters: s.registeredVoters ?? 0,
          },
        }).returning();
        results.push(row);
      } catch (e: any) {
        errors.push({ code: s.code, error: e.message });
      }
    }

    res.status(201).json({ imported: results.length, errors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-stations-mgmt/stations/bulk-status
// Bulk-upserts campaign_station_profiles for stations where this tenant has agents.
router.post("/stations/bulk-status", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { stationIds, accreditationStatus, trainingStatus, contactStatus, reportingStatus } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ error: "stationIds array required" });
    }

    // Only allow updates on stations where this tenant has agents
    const tenantStations = await db.select({ stationId: pollingAgentsTable.pollingStationId })
      .from(pollingAgentsTable)
      .where(and(inArray(pollingAgentsTable.pollingStationId, stationIds), tenantFilter(pollingAgentsTable, t.id)));
    const allowedIds = [...new Set(tenantStations.map(r => r.stationId).filter(Boolean))] as string[];
    if (allowedIds.length === 0) return res.json({ updated: 0 });

    const updateData: any = {};
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No status fields to update" });
    }

    // Upsert a profile row per station, scoped to this tenant
    let updated = 0;
    for (const stationId of allowedIds) {
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

export default router;
