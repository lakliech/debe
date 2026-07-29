import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Audit logs are sensitive — restrict to oversight roles
const canViewAudit = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "legal-officer",
  "auditor",
  "data-protection-officer",
  "security-admin",
]);

// GET /api/audit/logs
router.get("/logs", requireAuth, canViewAudit, async (req: any, res: any) => {
  const t = assertTenant(req);
  const { userId, action, resource, limit = "50", offset = "0" } = req.query as any;
  const lim = Math.min(Number(limit), 200);
  const off = Number(offset);

  const conditions: any[] = [tenantFilter(auditLogsTable, t.id)];
  if (userId) conditions.push(eq(auditLogsTable.userId as any, userId));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (resource) conditions.push(eq(auditLogsTable.resource, resource));

  const whereClause = and(...conditions);

  const logs = await db
    .select()
    .from(auditLogsTable)
    .where(whereClause)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(lim)
    .offset(off);

  res.json(logs.map((l) => ({
    ...l,
    createdAt: l.createdAt?.toISOString(),
  })));
});

export default router;
