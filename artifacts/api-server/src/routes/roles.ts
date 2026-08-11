import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { rolesTable, permissionsTable, rolePermissionsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { sendSecurityAlert } from "../lib/securityAlerts";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Role definitions and their permission mappings are GLOBAL platform
// configuration — only platform operators (level 0) may mutate them.
// Campaign roles must never edit the catalogue every tenant shares.
const canMutatePermissions = requireLevel(0);

// GET /api/roles
router.get("/", requireAuth, async (req: any, res: any) => {
  const roles = await db
    .select({
      id: rolesTable.id,
      name: rolesTable.name,
      slug: rolesTable.slug,
      description: rolesTable.description,
      level: rolesTable.level,
      color: rolesTable.color,
    })
    .from(rolesTable)
    .orderBy(rolesTable.level);

  // Count users per role — scoped to the active tenant so no cross-tenant
  // disclosure. Platform operators without an active campaign see the
  // catalogue with zero counts instead of a 409.
  const t = (req as any).tenant ?? null;
  const countMap: Record<string, number> = {};
  if (t) {
    const { userRolesTable } = await import("@workspace/db");
    const counts = await db
      .select({
        roleId: userRolesTable.roleId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(userRolesTable)
      .where(eq(userRolesTable.tenantId, t.id))
      .groupBy(userRolesTable.roleId);
    for (const c of counts) countMap[c.roleId] = c.count;
  }

  res.json(roles.map((r) => ({ ...r, userCount: countMap[r.id] || 0 })));
});

// GET /api/roles/:id/permissions
router.get("/:id/permissions", requireAuth, async (req: any, res: any) => {
  const perms = await db
    .select({
      id: permissionsTable.id,
      resource: permissionsTable.resource,
      action: permissionsTable.action,
      scope: permissionsTable.scope,
    })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, req.params.id));

  res.json(perms);
});

// PUT /api/roles/:id/permissions
router.put("/:id/permissions", requireAuth, canMutatePermissions, async (req: any, res: any) => {
  const { permissionIds } = req.body;
  if (!Array.isArray(permissionIds)) return res.status(400).json({ error: "permissionIds must be an array" });

  // Snapshot the outgoing grant before it is replaced — the security digest
  // below is only meaningful if it can say what actually changed.
  const before = await db
    .select({ permissionId: rolePermissionsTable.permissionId })
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.roleId, req.params.id));

  // Replace all permissions for this role
  await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, req.params.id));

  if (permissionIds.length > 0) {
    await db.insert(rolePermissionsTable).values(
      permissionIds.map((pid: string) => ({ roleId: req.params.id, permissionId: pid }))
    );
  }

  // This rewrites the permission set for EVERY user holding this role, in every
  // campaign — the widest-blast-radius change the API allows. Tell the platform
  // team out of band, after the write, so a quiet privilege grab leaves a trace
  // outside the database. Only report real deltas; a no-op save is not news.
  const beforeIds = new Set(before.map((p) => p.permissionId));
  const afterIds = new Set<string>(permissionIds);
  const added = [...afterIds].filter((p) => !beforeIds.has(p));
  const removed = [...beforeIds].filter((p) => !afterIds.has(p));

  if (added.length > 0 || removed.length > 0) {
    const [role] = await db
      .select({ name: rolesTable.name, slug: rolesTable.slug, level: rolesTable.level })
      .from(rolesTable)
      .where(eq(rolesTable.id, req.params.id))
      .limit(1);

    const { userRolesTable } = await import("@workspace/db");
    const [holders] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(userRolesTable)
      .where(eq(userRolesTable.roleId, req.params.id));

    sendSecurityAlert({
      subjectLine: `Security: permissions changed for role "${role?.name ?? req.params.id}"`,
      summary:
        "A role's permission set was rewritten. Every user holding this role, across every campaign, is affected immediately.",
      details: [
        `Role: ${role?.name ?? "(unknown)"} (${role?.slug ?? req.params.id}), level ${role?.level ?? "?"}`,
        `Users affected: ${holders?.count ?? 0}`,
        `Permissions added: ${added.length}`,
        `Permissions removed: ${removed.length}`,
        `Total permissions after change: ${afterIds.size}`,
      ],
    });
  }

  const perms = await db
    .select({
      id: permissionsTable.id,
      resource: permissionsTable.resource,
      action: permissionsTable.action,
      scope: permissionsTable.scope,
    })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, req.params.id));

  res.json(perms);
});

export default router;
