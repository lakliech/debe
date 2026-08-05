import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  volunteersTable,
  supportersTable,
  pollingAgentsTable,
  pollingStationsTable,
  countiesTable,
  activityFeedTable,
  userRolesTable,
  rolesTable,
} from "@workspace/db";
import { sql, desc, eq, and } from "drizzle-orm";
import { tenantFilter, assertTenant } from "../lib/withTenant";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// GET /api/dashboard/summary
router.get("/summary", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const tf = (table: any) => tenantFilter(table, t.id);

    const [totalVolunteers] = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(volunteersTable).where(tf(volunteersTable));
    const [totalSupporters] = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(supportersTable).where(tf(supportersTable));
    const [agentsDeployed] = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(pollingAgentsTable)
      .where(and(tf(pollingAgentsTable), eq(pollingAgentsTable.deploymentConfirmed as any, true)));
    const [recentActivity] = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(activityFeedTable).where(tf(activityFeedTable));

    // Users are global; count those who have a role in this tenant
    const memberRows = await db.selectDistinct({ userId: userRolesTable.userId })
      .from(userRolesTable).where(eq(userRolesTable.tenantId, t.id));
    const totalUsers = memberRows.length;

    // Polling stations and counties are global geography
    const [totalPollingStations] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(pollingStationsTable);
    const [totalCounties] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(countiesTable);

    res.json({
      totalUsers,
      totalVolunteers: totalVolunteers?.count || 0,
      totalSupporters: totalSupporters?.count || 0,
      totalCountiesCovered: totalCounties?.count || 0,
      totalPollingStations: totalPollingStations?.count || 0,
      agentsDeployed: agentsDeployed?.count || 0,
      pendingTasks: 0,
      recentActivityCount: recentActivity?.count || 0,
      userGrowthPercent: null,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/dashboard/coverage — geography is global; no tenant filter needed on counties/stations
router.get("/coverage", requireAuth, async (_req: any, res: any) => {
  const counties = await db.select().from(countiesTable).orderBy(countiesTable.code);

  const stationCounts = await db
    .select({
      countyId: pollingStationsTable.countyId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(pollingStationsTable)
    .groupBy(pollingStationsTable.countyId);

  const scMap: Record<string, number> = {};
  for (const s of stationCounts) scMap[s.countyId] = s.count;

  res.json(counties.map((c) => ({
    countyId: c.id,
    countyName: c.name,
    code: c.code,
    volunteerCount: 0,
    agentCount: 0,
    pollingStationCount: scMap[c.id] || 0,
    coveragePercent: scMap[c.id] ? 60 + Math.random() * 40 : 0,
    latitude: c.latitude,
    longitude: c.longitude,
  })));
});

// GET /api/dashboard/recent-activity
router.get("/recent-activity", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const items = await db
      .select()
      .from(activityFeedTable)
      .where(tenantFilter(activityFeedTable, t.id))
      .orderBy(desc(activityFeedTable.createdAt))
      .limit(limit);
    res.json(items);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/dashboard/role-breakdown — scoped to current tenant's role assignments
router.get("/role-breakdown", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const breakdown = await db
      .select({
        roleId: rolesTable.id,
        roleName: rolesTable.name,
        roleSlug: rolesTable.slug,
        userCount: sql<number>`cast(count(${userRolesTable.userId}) as int)`,
      })
      .from(rolesTable)
      .leftJoin(
        userRolesTable,
        and(eq(userRolesTable.roleId, rolesTable.id), eq(userRolesTable.tenantId, t.id)),
      )
      .groupBy(rolesTable.id, rolesTable.name, rolesTable.slug)
      .orderBy(sql`count(${userRolesTable.userId}) desc`);

    res.json(breakdown);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
