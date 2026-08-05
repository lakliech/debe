/**
 * grantCampaignAdmin — give a campaign an administrator by email, without
 * involving the identity provider's membership features.
 *
 * Membership is owned by this app: granting access is a user_roles row, not a
 * Clerk organisation invitation. The invitee must already have an account —
 * Clerk is the source of truth for who owns an email address, and a grant
 * written against an address nobody holds would be an impersonation vector.
 * When no account exists yet the caller is told so plainly instead of a
 * pending grant being invented silently.
 */

import { db, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { clerkUserIdsByEmail } from "./clerkAdmin";
import { getOrCreateLocalUser } from "./userIdentity";
import { bustActorCache } from "../middlewares/rbac";

const ADMIN_ROLE = "Super Administrator";

export type GrantResult =
  | { granted: true; userId: string }
  | { granted: false; reason: "no_account" | "role_missing" };

export async function grantCampaignAdminByEmail(
  tenantId: string,
  email: string,
): Promise<GrantResult> {
  const clerkIds = await clerkUserIdsByEmail(email);
  if (clerkIds.length === 0) return { granted: false, reason: "no_account" };

  const clerkId = clerkIds[0];
  const user = await getOrCreateLocalUser(clerkId, { email });
  if (!user) return { granted: false, reason: "no_account" };

  const [role] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(eq(rolesTable.name, ADMIN_ROLE))
    .limit(1);
  if (!role) return { granted: false, reason: "role_missing" };

  // Idempotent — re-inviting someone already granted is a no-op.
  const [existing] = await db
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .where(
      and(
        eq(userRolesTable.userId, user.id),
        eq(userRolesTable.roleId, role.id),
        eq(userRolesTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(userRolesTable).values({ userId: user.id, roleId: role.id, tenantId });
  }

  // The grant must be visible on the invitee's very next request.
  bustActorCache(clerkId);

  return { granted: true, userId: user.id };
}
