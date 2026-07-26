/**
 * Polling Stations Management API
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  pollingStationsTable,
  pollingAgentsTable,
  resultSubmissionsTable,
  pollingCentresTable,
  wardsTable,
  constituenciesTable,
  countiesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";

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
router.get("/stations", requireAuth, canViewStations, async (req: any, res: any) => {
  try {
    const { countyId, constituencyId, wardId, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (countyId) conditions.push(eq(pollingStationsTable.countyId, countyId));
    if (constituencyId) conditions.push(eq(pollingStationsTable.constituencyId, constituencyId));
    if (wardId) conditions.push(eq(pollingStationsTable.wardId, wardId));
    if (search) conditions.push(or(
      ilike(pollingStationsTable.name, `%${search}%`),
      ilike(pollingStationsTable.code, `%${search}%`),
    ));
    const where = conditions.length ? and(...conditions) : undefined;

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

    res.json({ data: rows, total: Number(total), page: pageNum, pageSize, counties, constituencies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-stations-mgmt/stations/:id
router.get("/stations/:id", requireAuth, canViewStations, async (req: any, res: any) => {
  try {
    const [station] = await db.select().from(pollingStationsTable)
      .where(eq(pollingStationsTable.id, req.params.id)).limit(1);
    if (!station) return res.status(404).json({ error: "Station not found" });

    const [agents, submissions] = await Promise.all([
      db.select().from(pollingAgentsTable)
        .where(eq(pollingAgentsTable.pollingStationId, req.params.id)),
      db.select({ id: resultSubmissionsTable.id, status: resultSubmissionsTable.status, submittedAt: resultSubmissionsTable.submittedAt })
        .from(resultSubmissionsTable)
        .where(eq(resultSubmissionsTable.pollingStationId, req.params.id))
        .orderBy(desc(resultSubmissionsTable.createdAt))
        .limit(10),
    ]);

    // Derive primaryAgent / backupAgent from agents array for frontend compatibility
    const primaryAgent = agents.find(a => !a.isBackup) ?? null;
    const backupAgent = agents.find(a => a.isBackup) ?? null;

    res.json({ ...station, agents, primaryAgent, backupAgent, submissionSummary: submissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-stations-mgmt/stations/:id
router.patch("/stations/:id", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    const { primaryAgentId, backupAgentId, accreditationStatus, trainingStatus, contactStatus, reportingStatus, ...rest } = req.body;
    const updateData: any = { ...rest };
    if (primaryAgentId !== undefined) updateData.primaryAgentId = primaryAgentId;
    if (backupAgentId !== undefined) updateData.backupAgentId = backupAgentId;
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    const [row] = await db.update(pollingStationsTable).set(updateData)
      .where(eq(pollingStationsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Station not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-stations-mgmt/stations/import
router.post("/stations/import", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    const stations: any[] = req.body;
    if (!Array.isArray(stations) || stations.length === 0) {
      return res.status(400).json({ error: "Expected a non-empty JSON array" });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const s of stations) {
      try {
        // Resolve centreId from centreCode if provided
        let centreId = s.centreId;
        if (!centreId && s.centreCode) {
          // centreCode lookup not directly available — skip for now, require centreId
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
router.post("/stations/bulk-status", requireAuth, canManageStations, async (req: any, res: any) => {
  try {
    const { stationIds, accreditationStatus, trainingStatus, contactStatus, reportingStatus } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ error: "stationIds array required" });
    }

    const updateData: any = {};
    if (accreditationStatus !== undefined) updateData.accreditationStatus = accreditationStatus;
    if (trainingStatus !== undefined) updateData.trainingStatus = trainingStatus;
    if (contactStatus !== undefined) updateData.contactStatus = contactStatus;
    if (reportingStatus !== undefined) updateData.reportingStatus = reportingStatus;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No status fields to update" });
    }

    const rows = await db.update(pollingStationsTable).set(updateData)
      .where(inArray(pollingStationsTable.id, stationIds)).returning({ id: pollingStationsTable.id });

    res.json({ updated: rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
