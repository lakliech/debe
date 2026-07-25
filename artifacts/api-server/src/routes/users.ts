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
import { requireRoles, requireLevel } from "../middlewares/rbac";

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

// Helper: get user with roles by local UUID
async function getUserWithRoles(id: string) {
  const user = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!user[0]) return null;

  const roles = await db
    .select({
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      roleSlug: rolesTable.slug,
      countyId: userRolesTable.countyId,
      constituencyId: userRolesTable.constituencyId,
      wardId: userRolesTable.wardId,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, id));

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

// GET /api/users/me
router.get("/me", requireAuth, async (req: any, res: any) => {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, req.clerkId))
    .limit(1);

  if (!existing[0]) {
    const newUser = await getOrCreateLocalUser(req.clerkId);
    return res.json(newUser);
  }
  const full = await getUserWithRoles(existing[0].id);
  res.json(full);
});

// GET /api/users
router.get("/", requireAuth, async (req: any, res: any) => {
  const { role, status, countyId, limit = "50", offset = "0" } = req.query as any;
  const lim = Math.min(Number(limit), 200);
  const off = Number(offset);

  const conditions: any[] = [];
  if (status) conditions.push(eq(usersTable.status, status));
  if (countyId) conditions.push(eq(usersTable.countyId as any, countyId));

  const users = await db
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

  // Batch-fetch roles for all returned users
  const userIds = users.map((u) => u.id);
  const roleMap: Record<string, any[]> = {};
  if (userIds.length > 0) {
    const allRoles = await db
      .select({
        userId: userRolesTable.userId,
        roleId: rolesTable.id,
        roleName: rolesTable.name,
        roleSlug: rolesTable.slug,
        countyId: userRolesTable.countyId,
        constituencyId: userRolesTable.constituencyId,
        wardId: userRolesTable.wardId,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(inArray(userRolesTable.userId, userIds));

    for (const r of allRoles) {
      if (!roleMap[r.userId]) roleMap[r.userId] = [];
      roleMap[r.userId].push(r);
    }
  }

  const result = users.map((u) => ({ ...u, roles: roleMap[u.id] ?? [] }));

  // Filter by role slug if provided (post-fetch; role filter is on junction table)
  if (role) {
    return res.json(result.filter((u) => u.roles.some((r) => r.roleSlug === role)));
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
    await db.insert(userRolesTable).values({
      userId: user.id,
      roleId,
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
  const full = await getUserWithRoles(req.params.id);
  if (!full) return res.status(404).json({ error: "Not found" });
  res.json(full);
});

// PATCH /api/users/:id
router.patch("/:id", requireAuth, canManageUsers, async (req: any, res: any) => {
  const { fullName, phoneNumber, photoUrl, status, countyId, constituencyId, wardId } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;
  if (status !== undefined) updates.status = status;
  if (countyId !== undefined) updates.countyId = countyId;
  if (constituencyId !== undefined) updates.constituencyId = constituencyId;
  if (wardId !== undefined) updates.wardId = wardId;

  await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params.id));
  const full = await getUserWithRoles(req.params.id);
  if (!full) return res.status(404).json({ error: "Not found" });
  res.json(full);
});

// POST /api/users/:id/roles
router.post("/:id/roles", requireAuth, canAssignRoles, async (req: any, res: any) => {
  const { roleId, countyId, constituencyId, wardId } = req.body;
  if (!roleId) return res.status(400).json({ error: "roleId required" });

  // Resolve actor to local UUID before writing
  const actorUUID = await resolveActorUUID(req.clerkId);

  await db.insert(userRolesTable).values({
    userId: req.params.id,
    roleId,
    countyId: countyId ?? null,
    constituencyId: constituencyId ?? null,
    wardId: wardId ?? null,
    assignedBy: actorUUID ?? undefined,
  });

  const full = await getUserWithRoles(req.params.id);
  res.json(full);
});

// POST /api/users/:id/suspend
router.post("/:id/suspend", requireAuth, canSuspendUsers, async (req: any, res: any) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason required" });

  // Resolve actor to local UUID — suspendedBy is a UUID column
  const actorUUID = await resolveActorUUID(req.clerkId);
  if (!actorUUID) {
    return res.status(400).json({
      error: "Acting user has no local profile. Complete sign-up before suspending others.",
    });
  }

  await db
    .update(usersTable)
    .set({ status: "suspended" })
    .where(eq(usersTable.id, req.params.id));

  await db.insert(userSuspensionsTable).values({
    userId: req.params.id,
    reason,
    suspendedBy: actorUUID,
    active: true,
  });

  const full = await getUserWithRoles(req.params.id);
  res.json(full);
});

export default router;
