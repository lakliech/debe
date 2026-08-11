/**
 * Platform bootstrap — makes an empty environment usable without hand-editing
 * the database.
 *
 * A fresh deployment starts with its own database: no campaigns, an incomplete
 * role catalogue, and every user row defaulting to is_global_admin = false. In
 * that state the platform operator is locked out of their own product — every
 * request answers 403 — and there is no in-app way back in, because granting
 * access is itself an operator-only action.
 *
 * This module closes that hole:
 *   1. Roles missing from the catalogue are inserted, so a guard naming a role
 *      can actually match somebody.
 *   2. Accounts on the PLATFORM_ADMIN_EMAILS allowlist are granted
 *      platform-operator standing (is_global_admin plus the platform_admin
 *      role at NULL tenant).
 *
 * ## Trust model
 *
 * The allowlist is matched against **Clerk's verified primary email**, never
 * against the local users.email column. That column is writable from request
 * data — campaign registration accepts a contact email — so matching on it
 * would let any signed-in caller claim the owner's address and be promoted on
 * the next boot. Clerk owns identity; the local row is just a cache of it.
 *
 * Promotion is driven only by an environment variable, which only the
 * deployment owner can set. It is not reachable from any request.
 */

import { db, usersTable, userRolesTable, rolesTable, ROLES } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { clerkVerifiedPrimaryEmail, clerkUserIdsByEmail } from "./clerkAdmin";
import { bustActorCache } from "../middlewares/rbac";

export const PLATFORM_ADMIN_ROLE_SLUG = "platform_admin";

/**
 * Parse a comma-separated allowlist into normalised lowercase emails.
 *
 * Takes the raw string explicitly rather than defaulting to the environment,
 * so an absent value genuinely means "nobody" instead of silently falling back
 * to whatever the process happens to have set.
 */
export function parsePlatformAdminEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The configured allowlist for this environment. */
export function platformAdminEmails(): string[] {
  return parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS);
}

/** True when `email` is on the allowlist, comparing normalised forms. */
export function isAllowlisted(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  // Placeholder addresses are minted locally for Clerk users whose email we
  // could not read. They prove nothing about identity and must never match.
  if (normalised.endsWith("@clerk.local") || normalised.endsWith("@placeholder.invalid")) {
    return false;
  }
  return platformAdminEmails().includes(normalised);
}

/**
 * Insert any role the catalogue defines that the database is missing.
 *
 * Deliberately insert-only for descriptive fields: an environment seeded from
 * an older catalogue gains the roles it lacks without a deploy silently
 * rewriting names or colours. `level` is the exception — it decides privilege,
 * so code stays authoritative for it.
 */
export async function ensureRoleCatalogue(): Promise<void> {
  for (const role of ROLES) {
    await db
      .insert(rolesTable)
      .values(role)
      .onConflictDoUpdate({
        target: rolesTable.slug,
        set: { level: role.level },
      });
  }
}

/**
 * Grant platform-operator standing to a local user row.
 *
 * `clerkId` is re-verified against Clerk before anything is granted, so this is
 * safe to call from any path. The platform role is held at tenant_id NULL — an
 * operator's authority does not live inside any campaign.
 *
 * Returns true when something changed.
 */
export async function promoteToPlatformOperator(
  userId: string,
  clerkId: string,
): Promise<boolean> {
  const verifiedEmail = await clerkVerifiedPrimaryEmail(clerkId);
  if (!isAllowlisted(verifiedEmail)) {
    logger.warn(
      { clerkId },
      "Platform bootstrap: refusing to promote — no verified allowlisted email for this account.",
    );
    return false;
  }

  let changed = false;

  const [updated] = await db
    .update(usersTable)
    .set({ isGlobalAdmin: true })
    .where(and(eq(usersTable.id, userId), eq(usersTable.isGlobalAdmin, false)))
    .returning({ id: usersTable.id });
  if (updated) changed = true;

  // Alert on the flag flip only, never on the role top-up below: this function
  // re-runs for every allowlisted account on every boot, and the UPDATE's
  // is_global_admin = false predicate is what makes "someone gained global
  // admin" a genuinely new event rather than a restart.
  if (updated) {
    // Imported lazily — platformBootstrap runs during startup, and a static
    // import would drag the email stack into the boot path.
    void import("./securityAlerts")
      .then(({ sendSecurityAlert }) =>
        sendSecurityAlert({
          subjectLine: "Security: a new global administrator was granted",
          summary:
            "An account was granted platform-operator standing (global admin). This bypasses every campaign-scoped access check.",
          details: [
            `Account: ${verifiedEmail ?? "(email unavailable)"}`,
            `User id: ${userId}`,
            "Granted via: PLATFORM_ADMIN_EMAILS allowlist",
            "If this was not expected, remove the address from PLATFORM_ADMIN_EMAILS and revoke the account immediately.",
          ],
        }),
      )
      .catch((err) =>
        logger.error({ err }, "Platform bootstrap: failed to dispatch global-admin security alert"),
      );
  }

  const [role] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(eq(rolesTable.slug, PLATFORM_ADMIN_ROLE_SLUG))
    .limit(1);

  if (!role) {
    logger.error(
      "Platform bootstrap: platform_admin role is missing from the catalogue — cannot grant the platform role.",
    );
    return changed;
  }

  // A partial unique index on (user_id, role_id) WHERE tenant_id IS NULL backs
  // this, so two instances booting at once cannot create duplicate grants.
  const inserted = await db
    .insert(userRolesTable)
    .values({ userId, roleId: role.id, tenantId: null })
    .onConflictDoNothing()
    .returning({ id: userRolesTable.id });
  if (inserted.length > 0) changed = true;

  if (changed) {
    // The RBAC middleware caches each actor's resolved privileges for 30s. The
    // server starts listening before this runs, so a request that arrived
    // first may have cached "no roles" — without this the freshly promoted
    // operator keeps getting 403 for the rest of that window.
    bustActorCache(clerkId);
    logger.info({ userId }, "Platform bootstrap: granted platform-operator access.");
  }
  return changed;
}

/**
 * Promote a user if Clerk says they own an allowlisted address.
 *
 * Called when a local user row is created just-in-time, so an operator signing
 * in for the first time after boot is not left waiting for the next restart.
 */
export async function promoteIfAllowlisted(
  userId: string,
  clerkId: string,
): Promise<void> {
  if (platformAdminEmails().length === 0) return;
  const verifiedEmail = await clerkVerifiedPrimaryEmail(clerkId);
  if (!isAllowlisted(verifiedEmail)) return;
  await promoteToPlatformOperator(userId, clerkId);
}

/**
 * Startup pass: fill in missing roles, then promote every allowlisted account
 * that already has a local row.
 *
 * Each allowlisted address is resolved through Clerk to the account that
 * actually owns it, and the local row is matched by Clerk ID — so a row whose
 * email column was written from request data cannot be promoted.
 *
 * Never throws: a bootstrap failure must not stop the server serving traffic.
 */
export async function runPlatformBootstrap(): Promise<void> {
  try {
    await ensureRoleCatalogue();
  } catch (err) {
    logger.error({ err }, "Platform bootstrap: role catalogue sync failed (non-fatal).");
  }

  const emails = platformAdminEmails();
  if (emails.length === 0) {
    logger.warn(
      "Platform bootstrap: PLATFORM_ADMIN_EMAILS is not set — no account will be granted platform-operator access in this environment.",
    );
    return;
  }

  for (const email of emails) {
    try {
      const clerkIds = await clerkUserIdsByEmail(email);

      if (clerkIds.length === 0) {
        logger.info(
          { email },
          "Platform bootstrap: no Clerk account with this email yet — it will be granted platform-operator access on first sign-in.",
        );
        continue;
      }

      for (const clerkId of clerkIds) {
        const [user] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.clerkId, clerkId))
          .limit(1);

        if (!user) {
          logger.info(
            { email },
            "Platform bootstrap: account has not signed in here yet — it will be granted access on first sign-in.",
          );
          continue;
        }

        await promoteToPlatformOperator(user.id, clerkId);
      }
    } catch (err) {
      logger.error({ err, email }, "Platform bootstrap: promotion failed (non-fatal).");
    }
  }
}

/** Exposed for the "already an operator" check in tests and diagnostics. */
export async function hasPlatformRole(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(
      and(
        eq(userRolesTable.userId, userId),
        eq(rolesTable.slug, PLATFORM_ADMIN_ROLE_SLUG),
        isNull(userRolesTable.tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
