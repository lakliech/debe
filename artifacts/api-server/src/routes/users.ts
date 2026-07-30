import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  userRolesTable,
  rolesTable,
  userSuspensionsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireRoles, requireLevel, bustActorCache } from "../middlewares/rbac";
import { resolveTenant } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

// Middleware: require authenticated Clerk session
function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Role guards for this router
// Any authenticated user may read; mutations require elevated roles.
const canManageUsers = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "national-organising-director",
  "security-admin",
]);
const canAssignRoles = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
]);
const canSuspendUsers = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "security-admin",
]);

// Resolve a Clerk user ID (text) to the local users.id (UUID).
// Returns null if no local record exists yet.
async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row?.id ?? null;
}

// Helper: verify that a user has at least one role in the given tenant.
// Used to gate mutations (PATCH, suspend) so a tenant admin cannot modify
// users who belong to a different campaign.
async function userBelongsToTenant(userId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userRolesTable.userId })
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

// Helper: get user with roles by local UUID.
// When tenantId is provided, only roles belonging to that tenant are returned
// (scopes role lookups to the active campaign). Without tenantId all roles are
// returned (used by /me and internal provisioning helpers where tenant may not
// yet be resolved).
async function getUserWithRoles(id: string, tenantId?: string | null) {
  const user = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!user[0]) return null;

  const roleWhere = tenantId
    ? and(eq(userRolesTable.userId, id), eq(userRolesTable.tenantId, tenantId))
    : eq(userRolesTable.userId, id);

  const roles = await db
    .select({
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      roleSlug: rolesTable.slug,
      tenantId: userRolesTable.tenantId,
      countyId: userRolesTable.countyId,
      constituencyId: userRolesTable.constituencyId,
      wardId: userRolesTable.wardId,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(roleWhere);

  return { ...user[0], roles };
}

// JIT-provision a local user from a Clerk ID
async function getOrCreateLocalUser(
  clerkId: string,
  defaultData?: { email?: string; fullName?: string }
) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  if (existing[0]) return getUserWithRoles(existing[0].id);

  const email = defaultData?.email ?? `${clerkId}@clerk.local`;
  const fullName = defaultData?.fullName ?? "New User";
  const [created] = await db
    .insert(usersTable)
    .values({ clerkId, email, fullName, status: "active" })
    .returning();
  return getUserWithRoles(created.id);
}

// GET /api/users/me — uses tenant from resolveTenant (applied globally via withTenant wrapper)
router.get("/me", requireAuth, async (req: any, res: any) => {
  const tenantId: string | undefined = req.tenant?.id;
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, req.clerkId))
    .limit(1);

  if (!existing[0]) {
    const newUser = await getOrCreateLocalUser(req.clerkId);
    // Return with tenant-scoped roles if available
    if (newUser && tenantId) {
      const tenantRoles = await db
        .select({ roleId: rolesTable.id, roleName: rolesTable.name, roleSlug: rolesTable.slug, tenantId: userRolesTable.tenantId, countyId: userRolesTable.countyId, constituencyId: userRolesTable.constituencyId, wardId: userRolesTable.wardId })
        .from(userRolesTable)
        .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
        .where(and(eq(userRolesTable.userId, newUser.id!), eq(userRolesTable.tenantId, tenantId)));
      return res.json({ ...newUser, roles: tenantRoles });
    }
    return res.json(newUser);
  }
  const full = await getUserWithRoles(existing[0].id, tenantId);
  res.json(full);
});

// GET /api/users — list users belonging to the current tenant (have at least one role in it)
router.get("/", requireAuth, async (req: any, res: any) => {
  const tenantId: string | undefined = req.tenant?.id;
  const { role, status, countyId, limit = "50", offset = "0" } = req.query as any;
  const lim = Math.min(Number(limit), 200);
  const off = Number(offset);

  const conditions: any[] = [];
  if (status) conditions.push(eq(usersTable.status, status));
  if (countyId) conditions.push(eq(usersTable.countyId as any, countyId));

  // When a tenant context exists, restrict to users who have a role in this tenant.
  // Use a subquery: SELECT DISTINCT user_id FROM user_roles WHERE tenant_id = ?
  let users: any[];
  if (tenantId) {
    // Fetch member IDs for this tenant first (avoids a complex Drizzle subquery)
    const memberRows = await db
      .selectDistinct({ userId: userRolesTable.userId })
      .from(userRolesTable)
      .where(eq(userRolesTable.tenantId, tenantId));
    const memberIds = memberRows.map((r) => r.userId);
    if (memberIds.length === 0) return res.json([]);

    const memberConditions: any[] = [inArray(usersTable.id, memberIds), ...conditions];
    users = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        fullName: usersTable.fullName,
        phoneNumber: usersTable.phoneNumber,
        photoUrl: usersTable.photoUrl,
        status: usersTable.status,
        countyId: usersTable.countyId,
        constituencyId: usersTable.constituencyId,
        wardId: usersTable.wardId,
        lastLoginAt: usersTable.lastLoginAt,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(and(...memberConditions))
      .orderBy(desc(usersTable.createdAt))
      .limit(lim)
      .offset(off);
  } else {
    users = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        fullName: usersTable.fullName,
        phoneNumber: usersTable.phoneNumber,
        photoUrl: usersTable.photoUrl,
        status: usersTable.status,
        countyId: usersTable.countyId,
        constituencyId: usersTable.constituencyId,
        wardId: usersTable.wardId,
        lastLoginAt: usersTable.lastLoginAt,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(usersTable.createdAt))
      .limit(lim)
      .offset(off);
  }

  // Batch-fetch roles — always scoped to the current tenant when available
  const userIds = users.map((u) => u.id);
  const roleMap: Record<string, any[]> = {};
  if (userIds.length > 0) {
    const roleWhere = tenantId
      ? and(inArray(userRolesTable.userId, userIds), eq(userRolesTable.tenantId, tenantId))
      : inArray(userRolesTable.userId, userIds);

    const allRoles = await db
      .select({
        userId: userRolesTable.userId,
        roleId: rolesTable.id,
        roleName: rolesTable.name,
        roleSlug: rolesTable.slug,
        tenantId: userRolesTable.tenantId,
        countyId: userRolesTable.countyId,
        constituencyId: userRolesTable.constituencyId,
        wardId: userRolesTable.wardId,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(roleWhere);

    for (const r of allRoles) {
      if (!roleMap[r.userId]) roleMap[r.userId] = [];
      roleMap[r.userId].push(r);
    }
  }

  const result = users.map((u) => ({ ...u, roles: roleMap[u.id] ?? [] }));

  // Filter by role slug if provided (post-fetch; role filter is on junction table)
  if (role) {
    return res.json(result.filter((u) => u.roles.some((r: any) => r.roleSlug === role)));
  }
  res.json(result);
});

// POST /api/users
router.post("/", requireAuth, canManageUsers, async (req: any, res: any) => {
  const { email, fullName, phoneNumber, roleId, countyId, constituencyId, wardId } = req.body;
  if (!email || !fullName) return res.status(400).json({ error: "email and fullName required" });

  // Resolve actor UUID before any write
  const actorUUID = await resolveActorUUID(req.clerkId);

  const [user] = await db
    .insert(usersTable)
    .values({
      clerkId: `manual_${Date.now()}`,
      email,
      fullName,
      phoneNumber: phoneNumber ?? null,
      status: "pending",
      countyId: countyId ?? null,
      constituencyId: constituencyId ?? null,
      wardId: wardId ?? null,
    })
    .returning();

  if (roleId) {
    const t = req.tenant as any;
    await db.insert(userRolesTable).values({
      userId: user.id,
      roleId,
      tenantId: t?.id ?? null,
      countyId: countyId ?? null,
      constituencyId: constituencyId ?? null,
      wardId: wardId ?? null,
      // Only write a UUID; skip if the actor has no local record yet
      assignedBy: actorUUID ?? undefined,
    });
  }

  const full = await getUserWithRoles(user.id);
  res.status(201).json(full);
});

// GET /api/users/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  const tenantId: string | undefined = (req as any).tenant?.id;
  // Verify target user belongs to this tenant before exposing their profile
  if (tenantId && !(await userBelongsToTenant(req.params.id, tenantId))) {
    return res.status(404).json({ error: "Not found" });
  }
  const full = await getUserWithRoles(req.params.id, tenantId);
  if (!full) return res.status(404).json({ error: "Not found" });
  res.json(full);
});

// PATCH /api/users/:id
router.patch("/:id", requireAuth, canManageUsers, async (req: any, res: any) => {
  const tenantId: string | undefined = (req as any).tenant?.id;
  // Verify target user belongs to this tenant before allowing mutation
  if (tenantId && !(await userBelongsToTenant(req.params.id, tenantId))) {
    return res.status(404).json({ error: "Not found" });
  }
  // NOTE: `status` is a global account field — tenant admins must not mutate it
  // (changing it would affect the user across all tenants). Suspension is handled
  // via the tenant-scoped userSuspensionsTable in POST /:id/suspend.
  const { fullName, phoneNumber, photoUrl, countyId, constituencyId, wardId } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;
  if (countyId !== undefined) updates.countyId = countyId;
  if (constituencyId !== undefined) updates.constituencyId = constituencyId;
  if (wardId !== undefined) updates.wardId = wardId;

  await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params.id));
  const full = await getUserWithRoles(req.params.id, tenantId);
  if (!full) return res.status(404).json({ error: "Not found" });
  res.json(full);
});

// POST /api/users/:id/roles
router.post("/:id/roles", requireAuth, canAssignRoles, async (req: any, res: any) => {
  const { roleId, countyId, constituencyId, wardId } = req.body;
  if (!roleId) return res.status(400).json({ error: "roleId required" });

  // Resolve actor to local UUID before writing
  const actorUUID = await resolveActorUUID(req.clerkId);

  const t = (req as any).tenant;
  await db.insert(userRolesTable).values({
    userId: req.params.id,
    roleId,
    tenantId: t?.id ?? null,
    countyId: countyId ?? null,
    constituencyId: constituencyId ?? null,
    wardId: wardId ?? null,
    assignedBy: actorUUID ?? undefined,
  });

  // Evict the actor cache for the affected user so the next request sees the
  // updated roles without waiting for the TTL to expire.
  const [targetUser] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.id, req.params.id))
    .limit(1);
  if (targetUser) bustActorCache(targetUser.clerkId);

  // Scope response to active tenant so caller only sees roles they can manage
  const full = await getUserWithRoles(req.params.id, t?.id);
  res.json(full);
});

// POST /api/users/:id/suspend
router.post("/:id/suspend", requireAuth, canSuspendUsers, async (req: any, res: any) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason required" });

  const t = (req as any).tenant;
  // Verify target user belongs to this tenant before allowing suspension
  if (t?.id && !(await userBelongsToTenant(req.params.id, t.id))) {
    return res.status(404).json({ error: "Not found" });
  }

  // Resolve actor to local UUID — suspendedBy is a UUID column
  const actorUUID = await resolveActorUUID(req.clerkId);
  if (!actorUUID) {
    return res.status(400).json({
      error: "Acting user has no local profile. Complete sign-up before suspending others.",
    });
  }

  // Record suspension in the tenant-scoped table ONLY — do NOT update the global
  // usersTable.status, which would affect the user's account in every other tenant.
  // Auth middleware should check userSuspensionsTable for active suspensions per tenant.
  await db.insert(userSuspensionsTable).values({
    userId: req.params.id,
    tenantId: t?.id ?? null,
    reason,
    suspendedBy: actorUUID,
    active: true,
  });

  const full = await getUserWithRoles(req.params.id, t?.id);
  res.json(full);
});

export default router;
