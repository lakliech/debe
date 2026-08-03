/**
 * userIdentity — shared helpers for reading and provisioning the local user
 * record behind a Clerk session.
 *
 * These live outside the /users router because identity is not campaign-scoped:
 * the identity router (/api/users/me) answers "who am I?" for every signed-in
 * caller, including platform operators who are in no campaign at all, while the
 * campaign user-management router answers "who is in this campaign?".
 */

import { db, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { promoteIfAllowlisted } from "./platformBootstrap";
import { clerkUserEmail } from "./clerkAdmin";

export interface UserRoleRow {
  roleId: string;
  roleName: string;
  roleSlug: string;
  roleLevel: number;
  tenantId: string | null;
  countyId: string | null;
  constituencyId: string | null;
  wardId: string | null;
}

/**
 * Fetch a user with their roles.
 *
 * When tenantId is provided, the result includes that campaign's roles plus
 * platform-level roles (tenant_id IS NULL) — a platform role must stay visible
 * no matter which campaign context is active. Without tenantId every role is
 * returned.
 */
export async function getUserWithRoles(id: string, tenantId?: string | null) {
  const user = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!user[0]) return null;

  const roleWhere = tenantId
    ? and(
        eq(userRolesTable.userId, id),
        or(eq(userRolesTable.tenantId, tenantId), isNull(userRolesTable.tenantId)),
      )
    : eq(userRolesTable.userId, id);

  const roles = await db
    .select({
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      roleSlug: rolesTable.slug,
      // roleLevel is the authoritative privilege number (lower = more
      // privileged). Clients MUST derive access from this rather than from a
      // hardcoded slug→level table, which silently drifts from the seeds.
      roleLevel: rolesTable.level,
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

/** JIT-provision a local user row for a Clerk ID the first time we see it. */
export async function getOrCreateLocalUser(
  clerkId: string,
  defaultData?: { email?: string; fullName?: string },
) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  if (existing[0]) return getUserWithRoles(existing[0].id);

  // Prefer the address Clerk holds for this account. The placeholder is only a
  // last resort for when Clerk cannot be reached, and it is never treated as
  // proof of identity anywhere.
  const email =
    defaultData?.email ?? (await clerkUserEmail(clerkId)) ?? `${clerkId}@clerk.local`;
  const fullName = defaultData?.fullName ?? "New User";
  const [created] = await db
    .insert(usersTable)
    .values({ clerkId, email, fullName, status: "active" })
    .returning();

  // A platform operator signing in for the first time in a fresh environment
  // has no row until this moment, so the startup bootstrap could not reach
  // them. Apply the allowlist here too, before their roles are read below.
  // Promotion re-checks the address against Clerk; the row's email is not
  // trusted for that decision.
  await promoteIfAllowlisted(created.id, clerkId);

  return getUserWithRoles(created.id);
}
