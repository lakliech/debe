/**
 * Coordinator dashboards — ward, constituency, county, national.
 * Filtered views of volunteer KPIs, coverage, and gap alerts.
 */
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
} from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";

const router = Router();

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
    const { scope = "national", id } = req.query;

    const whereClause = (table: any) => {
      if (!id) return undefined;
      if (scope === "county") return eq(table.countyId, id as string);
      if (scope === "constituency") return eq(table.constituencyId, id as string);
      if (scope === "ward") return eq(table.wardId, id as string);
      return undefined;
    };

    const [volunteerTotal] = await db.select({ total: count() }).from(volunteersTable)
      .where(whereClause(volunteersTable));
    const [activeVolunteers] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(eq(volunteersTable.status, "active"), whereClause(volunteersTable)));
    const [pendingVolunteers] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(eq(volunteersTable.status, "pending"), whereClause(volunteersTable)));
    const [supporterTotal] = await db.select({ total: count() }).from(supportersTable)
      .where(whereClause(supportersTable));

    const statusBreakdown = await db
      .select({ status: volunteersTable.status, count: count() })
      .from(volunteersTable)
      .where(whereClause(volunteersTable))
      .groupBy(volunteersTable.status);

    const roleBreakdown = await db
      .select({ role: volunteersTable.preferredRole, count: count() })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.status, "active"), whereClause(volunteersTable)))
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
      .where(whereClause(volunteersTable))
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coordinator/coverage
// Returns per-county volunteer counts for heatmap
router.get("/coverage", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
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
      .where(sql`${volunteersTable.countyId} IS NOT NULL`)
      .groupBy(volunteersTable.countyId, countiesTable.name, countiesTable.code, countiesTable.latitude, countiesTable.longitude)
      .orderBy(desc(count()));

    const allCounties = await db
      .select({ id: countiesTable.id, name: countiesTable.name, code: countiesTable.code, lat: countiesTable.latitude, lng: countiesTable.longitude })
      .from(countiesTable)
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coordinator/gap-alerts
router.get("/gap-alerts", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    // Counties with fewer than 5 active volunteers
    const lowCoverageCounties = await db
      .select({
        countyId: volunteersTable.countyId,
        countyName: countiesTable.name,
        activeCount: sql<number>`COUNT(*) FILTER (WHERE ${volunteersTable.status} = 'active')`.mapWith(Number),
      })
      .from(volunteersTable)
      .leftJoin(countiesTable, eq(volunteersTable.countyId, countiesTable.id))
      .where(sql`${volunteersTable.countyId} IS NOT NULL`)
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
          eq(volunteersTable.status, "pending"),
          sql`${volunteersTable.createdAt} < NOW() - INTERVAL '7 days'`
        )
      );

    res.json({
      lowCoverageCounties,
      stalePendingCount: Number(stalePending[0]?.total ?? 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coordinator/volunteers
// Paginated, filtered to coordinator's area
router.get("/volunteers", requireAuth, canViewCoordinator, async (req: any, res: any) => {
  try {
    const { countyId, constituencyId, wardId, status, page = "1" } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limit = 20;
    const offset = (pageNum - 1) * limit;

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
          countyId ? eq(volunteersTable.countyId, countyId as string) : undefined,
          constituencyId ? eq(volunteersTable.constituencyId, constituencyId as string) : undefined,
          wardId ? eq(volunteersTable.wardId, wardId as string) : undefined,
          status ? eq(volunteersTable.status, status as string) : undefined,
        )
      )
      .orderBy(desc(volunteersTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(
        countyId ? eq(volunteersTable.countyId, countyId as string) : undefined,
        constituencyId ? eq(volunteersTable.constituencyId, constituencyId as string) : undefined,
        status ? eq(volunteersTable.status, status as string) : undefined,
      ));

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
