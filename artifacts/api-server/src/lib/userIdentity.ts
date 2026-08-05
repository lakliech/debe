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
import { clerkUserEmail, clerkVerifiedPrimaryEmail } from "./clerkAdmin";

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

/**
 * Fetch a user with ONLY their platform-level roles (tenant_id IS NULL).
 *
 * Used by the identity endpoint when no campaign is in context: the caller
 * cannot act inside any campaign right now, so the endpoint must not
 * advertise campaign roles the guards would refuse. What they can legitimately
 * exercise without a campaign context is exactly their platform standing.
 */
export async function getUserWithPlatformRoles(id: string) {
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
      roleLevel: rolesTable.level,
      tenantId: userRolesTable.tenantId,
      countyId: userRolesTable.countyId,
      constituencyId: userRolesTable.constituencyId,
      wardId: userRolesTable.wardId,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(and(eq(userRolesTable.userId, id), isNull(userRolesTable.tenantId)));

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

  // Same person, new Clerk identity (re-registered, or a new sign-in method
  // issued a fresh Clerk account for the same address): re-link the new
  // Clerk ID to the existing local row instead of crashing on the email
  // unique constraint. Linking is an identity decision, so only a VERIFIED
  // primary address fetched from Clerk at this moment may drive it — never
  // caller-supplied data and never the non-verifying email helper. Without
  // that, a sign-in bearing an unverified matching address would inherit
  // the existing account's roles.
  const verifiedEmail = await clerkVerifiedPrimaryEmail(clerkId);
  if (verifiedEmail) {
    const byEmail = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, verifiedEmail))
      .limit(1);
    if (byEmail[0]) {
      await db
        .update(usersTable)
        .set({ clerkId, updatedAt: new Date() })
        .where(eq(usersTable.id, byEmail[0].id));
      return getUserWithRoles(byEmail[0].id);
    }
  }

  let created: any;
  try {
    [created] = await db
      .insert(usersTable)
      .values({ clerkId, email, fullName, status: "active" })
      .returning();
  } catch (err: any) {
    // A concurrent first-sign-in request may have won the insert race —
    // re-read rather than fail. The conflict can be on clerk_id (the same
    // identity provisioned twice) or on email (the linking lookup above
    // lost a race with another provisioning insert). Drizzle wraps the pg
    // error, so the constraint detail sits on the cause, not the message.
    const errText = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
    if (/duplicate key/i.test(errText)) {
      const [winner] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId))
        .limit(1);
      if (winner) return getUserWithRoles(winner.id);
      if (verifiedEmail) {
        const [emailWinner] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, verifiedEmail))
          .limit(1);
        if (emailWinner) {
          await db
            .update(usersTable)
            .set({ clerkId, updatedAt: new Date() })
            .where(eq(usersTable.id, emailWinner.id));
          return getUserWithRoles(emailWinner.id);
        }
      }
    }
    throw err;
  }

  // A platform operator signing in for the first time in a fresh environment
  // has no row until this moment, so the startup bootstrap could not reach
  // them. Apply the allowlist here too, before their roles are read below.
  // Promotion re-checks the address against Clerk; the row's email is not
  // trusted for that decision.
  await promoteIfAllowlisted(created.id, clerkId);

  return getUserWithRoles(created.id);
}
