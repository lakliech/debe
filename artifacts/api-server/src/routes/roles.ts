import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { rolesTable, permissionsTable, rolePermissionsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Only super-admins and senior security/legal roles may mutate permissions
const canMutatePermissions = requireRoles([
  "legal-officer",
  "security-admin",
  "data-protection-officer",
]);

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

  // Count users per role — scoped to the active tenant so no cross-tenant disclosure
  const t = assertTenant(req);
  const { userRolesTable } = await import("@workspace/db");
  const counts = await db
    .select({
      roleId: userRolesTable.roleId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(userRolesTable)
    .where(eq(userRolesTable.tenantId, t.id))
    .groupBy(userRolesTable.roleId);

  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.roleId] = c.count;

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

  // Replace all permissions for this role
  await db.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, req.params.id));

  if (permissionIds.length > 0) {
    await db.insert(rolePermissionsTable).values(
      permissionIds.map((pid: string) => ({ roleId: req.params.id, permissionId: pid }))
    );
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
