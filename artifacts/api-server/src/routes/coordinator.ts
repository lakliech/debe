/**
 * Coordinator dashboards — ward, constituency, county, national.
 * Filtered views of volunteer KPIs, coverage, and gap alerts.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  volunteersTable,
  supportersTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  eventsTable,
  pollingStationsTable,
  campaignStationProfilesTable,
  systemConfigTable,
} from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from '../lib/withTenant';
import { scopeGeoCondition, resolveScopeGeoFilter, type ScopeGeoFilter } from "../lib/campaignScope";
import { z } from "zod";
import { validate } from "../lib/validate";

const router = Router();

const dashboardQuerySchema = z.object({
  scope: z.enum(["national", "county", "constituency", "ward"]).default("national"),
  id: z.string().uuid().optional(),
});
const coordinatorVolunteersQuerySchema = z.object({
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  status: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canViewCoordinator = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "national-organising-director",
  "county-coordinator",
  "constituency-coordinator",
  "ward-coordinator",
  "data-analyst",
  "security-admin",
]);

// GET /api/coordinator/dashboard
// Query params: scope=national|county|constituency|ward, id=<uuid>
router.get("/dashboard", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(dashboardQuerySchema, req.query, res);
    if (!q) return;
    const { scope, id } = q;

    // Campaign scope is ALWAYS applied — the scope/id params can only narrow
    // further, never widen beyond the campaign's own geography.
    const volScope = await scopeGeoCondition(t, volunteersTable);
    const supScope = await scopeGeoCondition(t, supportersTable);

    const whereClause = (table: any, scopeCond?: any) => {
      const conditions: any[] = [tenantFilter(table, t.id)];
      if (scopeCond) conditions.push(scopeCond);
      if (id) {
        if (scope === "county") conditions.push(eq(table.countyId, id as string));
        else if (scope === "constituency") conditions.push(eq(table.constituencyId, id as string));
        else if (scope === "ward") conditions.push(eq(table.wardId, id as string));
      }
      return and(...conditions);
    };

    const [volunteerTotal] = await db.select({ total: count() }).from(volunteersTable)
      .where(whereClause(volunteersTable, volScope));
    const [activeVolunteers] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(eq(volunteersTable.status, "active"), whereClause(volunteersTable, volScope)));
    const [pendingVolunteers] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(eq(volunteersTable.status, "pending"), whereClause(volunteersTable, volScope)));
    const [supporterTotal] = await db.select({ total: count() }).from(supportersTable)
      .where(whereClause(supportersTable, supScope));

    const statusBreakdown = await db
      .select({ status: volunteersTable.status, count: count() })
      .from(volunteersTable)
      .where(whereClause(volunteersTable, volScope))
      .groupBy(volunteersTable.status);

    const roleBreakdown = await db
      .select({ role: volunteersTable.preferredRole, count: count() })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.status, "active"), whereClause(volunteersTable, volScope)))
      .groupBy(volunteersTable.preferredRole)
      .limit(10);

    const recentVolunteers = await db
      .select({
        id: volunteersTable.id,
        fullName: volunteersTable.fullName,
        status: volunteersTable.status,
        preferredRole: volunteersTable.preferredRole,
        createdAt: volunteersTable.createdAt,
      })
      .from(volunteersTable)
      .where(whereClause(volunteersTable, volScope))
      .orderBy(desc(volunteersTable.createdAt))
      .limit(5);

    res.json({
      scope,
      scopeId: id || null,
      volunteers: {
        total: Number(volunteerTotal?.total ?? 0),
        active: Number(activeVolunteers?.total ?? 0),
        pending: Number(pendingVolunteers?.total ?? 0),
        byStatus: Object.fromEntries(statusBreakdown.map((r) => [r.status, Number(r.count)])),
        byRole: Object.fromEntries(roleBreakdown.map((r) => [r.role ?? "unassigned", Number(r.count)])),
      },
      supporters: {
        total: Number(supporterTotal?.total ?? 0),
      },
      recentVolunteers,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/coordinator/coverage
// Returns per-county volunteer counts for heatmap
router.get("/coverage", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const scopeCond = await scopeGeoCondition(t, volunteersTable);
    const geoFilter = await resolveScopeGeoFilter(t);
    const countyCounts = await db
      .select({
        countyId: volunteersTable.countyId,
        countyName: countiesTable.name,
        countyCode: countiesTable.code,
        lat: countiesTable.latitude,
        lng: countiesTable.longitude,
        total: count(),
        active: sql<number>`COUNT(*) FILTER (WHERE ${volunteersTable.status} = 'active')`.mapWith(Number),
      })
      .from(volunteersTable)
      .leftJoin(countiesTable, eq(volunteersTable.countyId, countiesTable.id))
      .where(and(tenantFilter(volunteersTable, t.id), sql`${volunteersTable.countyId} IS NOT NULL`, scopeCond))
      .groupBy(volunteersTable.countyId, countiesTable.name, countiesTable.code, countiesTable.latitude, countiesTable.longitude)
      .orderBy(desc(count()));

    // Only the campaign's scope county (or parent county for MP/MCA seats) is shown.
    const allCounties = await db
      .select({ id: countiesTable.id, name: countiesTable.name, code: countiesTable.code, lat: countiesTable.latitude, lng: countiesTable.longitude })
      .from(countiesTable)
      .where(geoFilter?.countyId ? eq(countiesTable.id, geoFilter.countyId) : undefined)
      .orderBy(countiesTable.name);

    // Merge: counties with no volunteers show as 0
    const coverageMap = new Map(countyCounts.map((r) => [r.countyId, r]));
    const coverage = allCounties.map((c) => ({
      countyId: c.id,
      countyName: c.name,
      countyCode: c.code,
      lat: c.lat,
      lng: c.lng,
      total: Number(coverageMap.get(c.id)?.total ?? 0),
      active: Number(coverageMap.get(c.id)?.active ?? 0),
    }));

    res.json(coverage);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * Shared stations are filtered to the campaign's scope. resolveScopeGeoFilter
 * returns null for presidential / legacy scope-less tenants (no filtering).
 */
function stationScopeCondition(filter: ScopeGeoFilter | null) {
  if (!filter) return undefined;
  if (filter.wardId) return eq(pollingStationsTable.wardId, filter.wardId);
  if (filter.constituencyId) return eq(pollingStationsTable.constituencyId, filter.constituencyId);
  return eq(pollingStationsTable.countyId, filter.countyId!);
}

// GET /api/coordinator/gap-alerts
router.get("/gap-alerts", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const scopeCond = await scopeGeoCondition(t, volunteersTable);
    // Counties with fewer than 5 active volunteers (scoped to tenant + campaign scope)
    const lowCoverageCounties = await db
      .select({
        countyId: volunteersTable.countyId,
        countyName: countiesTable.name,
        activeCount: sql<number>`COUNT(*) FILTER (WHERE ${volunteersTable.status} = 'active')`.mapWith(Number),
      })
      .from(volunteersTable)
      .leftJoin(countiesTable, eq(volunteersTable.countyId, countiesTable.id))
      .where(and(tenantFilter(volunteersTable, t.id), sql`${volunteersTable.countyId} IS NOT NULL`, scopeCond))
      .groupBy(volunteersTable.countyId, countiesTable.name)
      .having(sql`COUNT(*) FILTER (WHERE ${volunteersTable.status} = 'active') < 5`)
      .orderBy(sql`COUNT(*) FILTER (WHERE ${volunteersTable.status} = 'active') ASC`)
      .limit(20);

    // Pending volunteers older than 7 days (need follow-up)
    const stalePending = await db
      .select({ total: count() })
      .from(volunteersTable)
      .where(
        and(
          tenantFilter(volunteersTable, t.id),
          eq(volunteersTable.status, "pending"),
          sql`${volunteersTable.createdAt} < NOW() - INTERVAL '7 days'`,
          scopeCond,
        )
      );

    // Station-level gaps: constituencies whose polling-station agent coverage
    // is below the tenant's configurable minimum threshold (default 80%).
    const [thresholdRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(and(tenantFilter(systemConfigTable, t.id), eq(systemConfigTable.key, "min_coverage_threshold_pct")))
      .limit(1);
    const parsedThreshold = Number(thresholdRow?.value);
    const coverageThresholdPct =
      Number.isFinite(parsedThreshold) && parsedThreshold >= 0 && parsedThreshold <= 100
        ? parsedThreshold
        : 80;

    const geoFilter = await resolveScopeGeoFilter(t);
    const stationCoverage = await db
      .select({
        constituencyId: constituenciesTable.id,
        constituencyName: constituenciesTable.name,
        countyName: countiesTable.name,
        totalStations: count(pollingStationsTable.id),
        // count() ignores NULLs — stations with no profile row for this tenant
        // return NULL from the left-join and are not counted as assigned.
        assignedStations: sql<number>`count(${campaignStationProfilesTable.primaryAgentId})::int`,
      })
      .from(pollingStationsTable)
      .innerJoin(constituenciesTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
      .innerJoin(countiesTable, eq(pollingStationsTable.countyId, countiesTable.id))
      .leftJoin(
        campaignStationProfilesTable,
        and(
          eq(campaignStationProfilesTable.stationId, pollingStationsTable.id),
          eq(campaignStationProfilesTable.tenantId, t.id),
        ),
      )
      .where(stationScopeCondition(geoFilter))
      .groupBy(constituenciesTable.id, constituenciesTable.name, countiesTable.name)
      .having(
        sql`count(${campaignStationProfilesTable.primaryAgentId})::numeric * 100 < ${coverageThresholdPct} * count(${pollingStationsTable.id})::numeric`,
      )
      .orderBy(
        sql`count(${campaignStationProfilesTable.primaryAgentId})::numeric / NULLIF(count(${pollingStationsTable.id}), 0) ASC`,
      )
      .limit(50);

    const lowCoverageConstituencies = stationCoverage.map((r) => {
      const total = Number(r.totalStations);
      const assigned = Number(r.assignedStations);
      return {
        constituencyId: r.constituencyId,
        constituencyName: r.constituencyName,
        countyName: r.countyName,
        totalStations: total,
        assignedStations: assigned,
        coveragePct: total > 0 ? Math.round((assigned / total) * 100) : 0,
      };
    });

    res.json({
      lowCoverageCounties,
      stalePendingCount: Number(stalePending[0]?.total ?? 0),
      coverageThresholdPct,
      lowCoverageConstituencies,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/coordinator/volunteers
// Paginated, filtered to coordinator's area
router.get("/volunteers", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(coordinatorVolunteersQuerySchema, req.query, res);
    if (!q) return;
    const { countyId, constituencyId, wardId, status } = q;
    const pageNum = q.page;
    const limit = 20;
    const offset = (pageNum - 1) * limit;

    // Query params can only narrow within the campaign's scope, never widen it.
    const scopeCond = await scopeGeoCondition(t, volunteersTable);

    const rows = await db
      .select({
        id: volunteersTable.id,
        fullName: volunteersTable.fullName,
        phoneNumber: volunteersTable.phoneNumber,
        preferredRole: volunteersTable.preferredRole,
        status: volunteersTable.status,
        createdAt: volunteersTable.createdAt,
        countyName: countiesTable.name,
        constituencyName: constituenciesTable.name,
      })
      .from(volunteersTable)
      .leftJoin(countiesTable, eq(volunteersTable.countyId, countiesTable.id))
      .leftJoin(constituenciesTable, eq(volunteersTable.constituencyId, constituenciesTable.id))
      .where(
        and(
          tenantFilter(volunteersTable, t.id),
          countyId ? eq(volunteersTable.countyId, countyId as string) : undefined,
          constituencyId ? eq(volunteersTable.constituencyId, constituencyId as string) : undefined,
          wardId ? eq(volunteersTable.wardId, wardId as string) : undefined,
          status ? eq(volunteersTable.status, status as string) : undefined,
          scopeCond,
        )
      )
      .orderBy(desc(volunteersTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(
        tenantFilter(volunteersTable, t.id),
        countyId ? eq(volunteersTable.countyId, countyId as string) : undefined,
        constituencyId ? eq(volunteersTable.constituencyId, constituencyId as string) : undefined,
        wardId ? eq(volunteersTable.wardId, wardId as string) : undefined,
        status ? eq(volunteersTable.status, status as string) : undefined,
        scopeCond,
      ));

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
