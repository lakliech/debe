import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
} from "@workspace/db";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../lib/validate";
import { resolveScopeGeoFilter, type ScopeGeoFilter } from "../lib/campaignScope";

const router = Router();

const constituenciesQuerySchema = z.object({
  countyId: z.string().uuid().optional(),
});
const wardsQuerySchema = z.object({
  constituencyId: z.string().uuid().optional(),
  countyId: z.string().uuid().optional(),
});
const pollingCentresQuerySchema = z.object({
  wardId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
});
const pollingStationsQuerySchema = z.object({
  centreId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  countyId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
});

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/**
 * Campaign-scope geography filter. Geography is shared reference data (not
 * secret), but a campaign should only be SHOWN the geography it contests —
 * a Nairobi senatorial campaign sees Nairobi's hierarchy, not 47 counties.
 * Resolved from req.tenant (attached by resolveTenantOptional when the caller
 * has campaign context); ?all=1 bypasses for scope-SELECTION pickers, which
 * must offer the full map.
 */
async function scopeFilterFor(req: any): Promise<ScopeGeoFilter | null> {
  if (req.query?.all === "1") return null;
  const tenant = req.tenant;
  if (!tenant?.seatType) return null;
  return resolveScopeGeoFilter(tenant);
}

/** WHERE clauses matching each level's rows to the scope filter. The filter
 * always carries countyId (parents are resolved), so the non-null assertions
 * are safe. */
function constituencyScopeWhere(filter: ScopeGeoFilter | null) {
  if (!filter) return undefined;
  return filter.constituencyId
    ? eq(constituenciesTable.id, filter.constituencyId)
    : eq(constituenciesTable.countyId, filter.countyId!);
}
function wardScopeWhere(filter: ScopeGeoFilter | null) {
  if (!filter) return undefined;
  if (filter.wardId) return eq(wardsTable.id, filter.wardId);
  if (filter.constituencyId) return eq(wardsTable.constituencyId, filter.constituencyId);
  return eq(wardsTable.countyId, filter.countyId!);
}
function centreScopeWhere(filter: ScopeGeoFilter | null) {
  if (!filter) return undefined;
  if (filter.wardId) return eq(pollingCentresTable.wardId, filter.wardId);
  if (filter.constituencyId) return eq(pollingCentresTable.constituencyId, filter.constituencyId);
  return eq(pollingCentresTable.countyId, filter.countyId!);
}
function stationScopeWhere(filter: ScopeGeoFilter | null) {
  if (!filter) return undefined;
  if (filter.wardId) return eq(pollingStationsTable.wardId, filter.wardId);
  if (filter.constituencyId) return eq(pollingStationsTable.constituencyId, filter.constituencyId);
  return eq(pollingStationsTable.countyId, filter.countyId!);
}

// GET /api/geography/counties
router.get("/counties", requireAuth, async (req: any, res: any) => {
  const filter = await scopeFilterFor(req);
  const counties = await db
    .select()
    .from(countiesTable)
    .where(filter ? eq(countiesTable.id, filter.countyId!) : undefined)
    .orderBy(countiesTable.code);

  // Get constituency and ward counts (scoped the same way so per-county
  // totals reflect what the campaign can actually see)
  const constCounts = await db
    .select({
      countyId: constituenciesTable.countyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(constituenciesTable)
    .where(constituencyScopeWhere(filter))
    .groupBy(constituenciesTable.countyId);

  const wardCounts = await db
    .select({
      countyId: wardsTable.countyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(wardsTable)
    .where(wardScopeWhere(filter))
    .groupBy(wardsTable.countyId);

  const constMap: Record<string, number> = {};
  for (const c of constCounts) constMap[c.countyId] = c.count;
  const wardMap: Record<string, number> = {};
  for (const w of wardCounts) wardMap[w.countyId] = w.count;

  res.json(counties.map((c) => ({
    ...c,
    constituencyCount: constMap[c.id] || 0,
    wardCount: wardMap[c.id] || 0,
  })));
});

// GET /api/geography/counties/:id
router.get("/counties/:id", requireAuth, async (req: any, res: any) => {
  const filter = await scopeFilterFor(req);
  // Out-of-scope counties are indistinguishable from unknown ones.
  if (filter && req.params.id !== filter.countyId) {
    return res.status(404).json({ error: "County not found" });
  }

  const county = await db
    .select()
    .from(countiesTable)
    .where(eq(countiesTable.id, req.params.id))
    .limit(1);

  if (!county[0]) return res.status(404).json({ error: "County not found" });

  const constituencies = await db
    .select()
    .from(constituenciesTable)
    .where(constituencyScopeWhere(filter) ?? eq(constituenciesTable.countyId, req.params.id))
    .orderBy(constituenciesTable.code);

  const [wardCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(wardsTable)
    .where(wardScopeWhere(filter) ?? eq(wardsTable.countyId, req.params.id));

  const [stationCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(pollingStationsTable)
    .where(stationScopeWhere(filter) ?? eq(pollingStationsTable.countyId, req.params.id));

  // Add ward counts to constituencies
  const wardCounts = await db
    .select({
      constituencyId: wardsTable.constituencyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(wardsTable)
    .where(eq(wardsTable.countyId, req.params.id))
    .groupBy(wardsTable.constituencyId);

  const wcMap: Record<string, number> = {};
  for (const w of wardCounts) wcMap[w.constituencyId] = w.count;

  const { id, code, name, capital, registeredVoters, latitude, longitude } = county[0];
  res.json({
    id,
    code,
    name,
    capital,
    registeredVoters,
    latitude,
    longitude,
    constituencyCount: constituencies.length,
    wardCount: wardCount?.count || 0,
    pollingStationCount: stationCount?.count || 0,
    constituencies: constituencies.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      countyId: req.params.id,
      countyName: county[0].name,
      wardCount: wcMap[c.id] || 0,
      registeredVoters: c.registeredVoters,
    })),
  });
});

// GET /api/geography/constituencies
router.get("/constituencies", requireAuth, async (req: any, res: any) => {
  const q = validate(constituenciesQuerySchema, req.query, res);
  if (!q) return;
  const { countyId } = q;
  const filter = await scopeFilterFor(req);
  const conditions = [];
  if (countyId) conditions.push(eq(constituenciesTable.countyId, countyId));
  const scoped = constituencyScopeWhere(filter);
  if (scoped) conditions.push(scoped);
  const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;

  const constituencies = await db
    .select({
      id: constituenciesTable.id,
      code: constituenciesTable.code,
      name: constituenciesTable.name,
      countyId: constituenciesTable.countyId,
      countyName: countiesTable.name,
      registeredVoters: constituenciesTable.registeredVoters,
    })
    .from(constituenciesTable)
    .innerJoin(countiesTable, eq(constituenciesTable.countyId, countiesTable.id))
    .where(whereConditions)
    .orderBy(constituenciesTable.code);

  const wardCounts = await db
    .select({
      constituencyId: wardsTable.constituencyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(wardsTable)
    .where(wardScopeWhere(filter))
    .groupBy(wardsTable.constituencyId);

  const wcMap: Record<string, number> = {};
  for (const w of wardCounts) wcMap[w.constituencyId] = w.count;

  res.json(constituencies.map((c) => ({ ...c, wardCount: wcMap[c.id] || 0 })));
});

// GET /api/geography/wards
router.get("/wards", requireAuth, async (req: any, res: any) => {
  const q = validate(wardsQuerySchema, req.query, res);
  if (!q) return;
  const { constituencyId, countyId } = q;
  const filter = await scopeFilterFor(req);
  const conditions = [];
  if (constituencyId) conditions.push(eq(wardsTable.constituencyId, constituencyId));
  if (countyId) conditions.push(eq(wardsTable.countyId, countyId));
  const scopedWards = wardScopeWhere(filter);
  if (scopedWards) conditions.push(scopedWards);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const wards = await db
    .select({
      id: wardsTable.id,
      code: wardsTable.code,
      name: wardsTable.name,
      constituencyId: wardsTable.constituencyId,
      constituencyName: constituenciesTable.name,
      countyId: wardsTable.countyId,
      countyName: countiesTable.name,
      registeredVoters: wardsTable.registeredVoters,
    })
    .from(wardsTable)
    .innerJoin(constituenciesTable, eq(wardsTable.constituencyId, constituenciesTable.id))
    .innerJoin(countiesTable, eq(wardsTable.countyId, countiesTable.id))
    .where(whereClause)
    .orderBy(wardsTable.code)
    .limit(500);

  res.json(wards);
});

// GET /api/geography/polling-centres
router.get("/polling-centres", requireAuth, async (req: any, res: any) => {
  const q = validate(pollingCentresQuerySchema, req.query, res);
  if (!q) return;
  const { wardId, constituencyId } = q;
  const filter = await scopeFilterFor(req);
  const conditions = [];
  if (wardId) conditions.push(eq(pollingCentresTable.wardId, wardId));
  if (constituencyId) conditions.push(eq(pollingCentresTable.constituencyId, constituencyId));
  const scopedCentres = centreScopeWhere(filter);
  if (scopedCentres) conditions.push(scopedCentres);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const centres = await db
    .select({
      id: pollingCentresTable.id,
      name: pollingCentresTable.name,
      wardId: pollingCentresTable.wardId,
      wardName: wardsTable.name,
      constituencyId: pollingCentresTable.constituencyId,
      countyId: pollingCentresTable.countyId,
      latitude: pollingCentresTable.latitude,
      longitude: pollingCentresTable.longitude,
    })
    .from(pollingCentresTable)
    .innerJoin(wardsTable, eq(pollingCentresTable.wardId, wardsTable.id))
    .where(whereClause)
    .limit(500);

  const stationCounts = await db
    .select({
      centreId: pollingStationsTable.centreId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(pollingStationsTable)
    .groupBy(pollingStationsTable.centreId);

  const scMap: Record<string, number> = {};
  for (const s of stationCounts) scMap[s.centreId] = s.count;

  res.json(centres.map((c) => ({ ...c, stationCount: scMap[c.id] || 0 })));
});

// GET /api/geography/polling-stations
router.get("/polling-stations", requireAuth, async (req: any, res: any) => {
  const q = validate(pollingStationsQuerySchema, req.query, res);
  if (!q) return;
  const { centreId, wardId, constituencyId, countyId, search } = q;
  const filter = await scopeFilterFor(req);
  const conditions = [];
  if (centreId) conditions.push(eq(pollingStationsTable.centreId, centreId));
  if (wardId) conditions.push(eq(pollingStationsTable.wardId, wardId));
  if (constituencyId) conditions.push(eq(pollingStationsTable.constituencyId, constituencyId));
  if (countyId) conditions.push(eq(pollingStationsTable.countyId, countyId));
  const scopedStations = stationScopeWhere(filter);
  if (scopedStations) conditions.push(scopedStations);
  // search by station code or name (case-insensitive)
  if (search) conditions.push(or(ilike(pollingStationsTable.code, `%${search}%`), ilike(pollingStationsTable.name, `%${search}%`)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const stations = await db
    .select({
      id: pollingStationsTable.id,
      code: pollingStationsTable.code,
      name: pollingStationsTable.name,
      centreId: pollingStationsTable.centreId,
      centreName: pollingCentresTable.name,
      wardId: pollingStationsTable.wardId,
      wardName: wardsTable.name,
      constituencyId: pollingStationsTable.constituencyId,
      countyId: pollingStationsTable.countyId,
      registeredVoters: pollingStationsTable.registeredVoters,
      latitude: pollingStationsTable.latitude,
      longitude: pollingStationsTable.longitude,
      primaryAgentId: pollingStationsTable.primaryAgentId,
      backupAgentId: pollingStationsTable.backupAgentId,
    })
    .from(pollingStationsTable)
    .innerJoin(pollingCentresTable, eq(pollingStationsTable.centreId, pollingCentresTable.id))
    .innerJoin(wardsTable, eq(pollingStationsTable.wardId, wardsTable.id))
    .where(whereClause)
    .limit(500);

  res.json(stations);
});

// GET /api/geography/polling-stations/:id — fetch a single station by UUID
// Used by the mobile app to resolve a station's countyId from the agent's
// pollingStationId without relying on name/code search.
// The campaign-scope filter is applied so callers cannot look up stations
// outside their campaign's geographic scope.
router.get("/polling-stations/:id", requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const filter = await scopeFilterFor(req);
    const scopedWhere = stationScopeWhere(filter);

    // Require BOTH the exact ID match AND the campaign scope.
    const whereClause = scopedWhere
      ? and(eq(pollingStationsTable.id, id), scopedWhere)
      : eq(pollingStationsTable.id, id);

    const [station] = await db
      .select({
        id: pollingStationsTable.id,
        code: pollingStationsTable.code,
        name: pollingStationsTable.name,
        centreId: pollingStationsTable.centreId,
        wardId: pollingStationsTable.wardId,
        constituencyId: pollingStationsTable.constituencyId,
        countyId: pollingStationsTable.countyId,
        registeredVoters: pollingStationsTable.registeredVoters,
        latitude: pollingStationsTable.latitude,
        longitude: pollingStationsTable.longitude,
      })
      .from(pollingStationsTable)
      .where(whereClause)
      .limit(1);

    if (!station) return res.status(404).json({ error: "Not found" });
    res.json(station);
  } catch (err: any) {
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/geography/stats
router.get("/stats", requireAuth, async (req: any, res: any) => {
  const filter = await scopeFilterFor(req);
  const [countyCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(countiesTable)
    .where(filter ? eq(countiesTable.id, filter.countyId!) : undefined);
  const [constCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(constituenciesTable)
    .where(constituencyScopeWhere(filter));
  const [wardCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(wardsTable)
    .where(wardScopeWhere(filter));
  const [centreCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(pollingCentresTable)
    .where(centreScopeWhere(filter));
  const [stationCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(pollingStationsTable)
    .where(stationScopeWhere(filter));
  // Voter totals come from the deepest scoped level's own registered_voters.
  const [voters] = filter?.wardId
    ? await db
        .select({ total: sql<number>`coalesce(cast(sum(registered_voters) as int), 0)` })
        .from(wardsTable)
        .where(eq(wardsTable.id, filter.wardId))
    : filter?.constituencyId
      ? await db
          .select({ total: sql<number>`coalesce(cast(sum(registered_voters) as int), 0)` })
          .from(constituenciesTable)
          .where(eq(constituenciesTable.id, filter.constituencyId))
      : await db
          .select({ total: sql<number>`coalesce(cast(sum(registered_voters) as int), 0)` })
          .from(countiesTable)
          .where(filter ? eq(countiesTable.id, filter.countyId!) : undefined);

  res.json({
    countyCount: countyCount?.count || 0,
    constituencyCount: constCount?.count || 0,
    wardCount: wardCount?.count || 0,
    pollingCentreCount: centreCount?.count || 0,
    pollingStationCount: stationCount?.count || 0,
    totalRegisteredVoters: voters?.total || 0,
  });
});

export default router;
