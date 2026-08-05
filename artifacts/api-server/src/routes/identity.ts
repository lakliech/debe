/**
 * identity — "who am I?" for the signed-in caller, plus campaign entry/exit.
 *
 * Mounted OUTSIDE the tenant boundary on purpose. Identity is not a property
 * of a campaign: campaign staff, users who belong to no campaign yet, and
 * platform operators who administer every campaign but belong to none must all
 * be able to load their own record. Putting this behind resolveTenant is what
 * forced the system to invent a campaign for anyone who did not have one.
 */

import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, userRolesTable, tenantsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { getUserWithRoles, getUserWithPlatformRoles, getOrCreateLocalUser } from "../lib/userIdentity";
import {
  resolveTenantOptional,
  type PlatformOperatorRequest,
} from "../middlewares/resolveTenant";
import { bustActorCache } from "../middlewares/rbac";
import { recordPlatformAction } from "../lib/platformAudit";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

/**
 * The campaigns a user belongs to (their memberships), with the details the
 * campaign switcher needs. Platform operators get an empty list — they belong
 * to no campaign; the platform tenants endpoint lists what they may enter.
 */
async function listMemberships(localUserId: string) {
  const rows = await db
    .selectDistinct({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      plan: tenantsTable.plan,
    })
    .from(userRolesTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, userRolesTable.tenantId))
    .where(and(eq(userRolesTable.userId, localUserId), isNotNull(userRolesTable.tenantId)));
  return rows;
}

/**
 * GET /api/users/me
 *
 * Returns the caller's record plus the context they are operating in:
 *   isPlatformOperator — true for global admins, who have no campaign of their own
 *   activeTenant       — the campaign currently in context, or null
 *   campaigns          — the campaigns the caller belongs to and may enter
 *
 * The roles reported are scoped exactly the way the request guards scope them:
 * with a campaign in context, that campaign's roles (plus platform roles);
 * without one, only platform-level roles — the interface must never advertise
 * a privilege the API would refuse in the current context.
 */
router.get("/me", requireAuth, resolveTenantOptional, async (req: any, res: any) => {
  const tenant = (req as PlatformOperatorRequest).tenant;
  const tenantId: string | undefined = tenant?.id;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, req.clerkId))
    .limit(1);

  if (!existing[0]) {
    const user = await getOrCreateLocalUser(req.clerkId);
    return res.json({
      ...user,
      isPlatformOperator: Boolean((req as PlatformOperatorRequest).isPlatformOperator),
      activeTenant: null,
      campaigns: [],
    });
  }

  const user = tenantId
    ? await getUserWithRoles(existing[0].id, tenantId)
    : await getUserWithPlatformRoles(existing[0].id);

  const campaigns = user?.isGlobalAdmin ? [] : await listMemberships(existing[0].id);

  res.json({
    ...user,
    isPlatformOperator: Boolean((req as PlatformOperatorRequest).isPlatformOperator),
    activeTenant: tenant
      ? { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan }
      : null,
    campaigns,
  });
});

/**
 * PUT /api/users/me/active-campaign — enter or leave a campaign.
 *
 * Body: { tenantId: string | null } — null exits the campaign.
 *
 * The two routes into a campaign stay separate here too:
 *   - a platform operator (global admin) may enter ANY campaign, and entering
 *     never creates a membership for them;
 *   - anyone else may only enter a campaign they belong to via user_roles.
 *
 * The choice is persisted on the user row and the cached actor is cleared so
 * the switch takes effect on the very next request, not after the cache TTL.
 */
router.put("/me/active-campaign", requireAuth, async (req: any, res: any) => {
  try {
    const { tenantId } = req.body ?? {};

    if (tenantId !== null && typeof tenantId !== "string") {
      return res
        .status(400)
        .json({ error: "tenantId must be a campaign id, or null to exit the campaign." });
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkId))
      .limit(1);

    if (!user) return res.status(404).json({ error: "No local profile for this account." });

    let activeTenant: any = null;

    if (tenantId) {
      const [tenant] = await db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.name,
          slug: tenantsTable.slug,
          plan: tenantsTable.plan,
          isSuspended: tenantsTable.isSuspended,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (!tenant) return res.status(404).json({ error: "Campaign not found." });
      if (tenant.isSuspended) {
        return res
          .status(409)
          .json({ error: "This campaign is suspended. Contact platform support." });
      }

      if (!user.isGlobalAdmin) {
        const [membership] = await db
          .select({ id: userRolesTable.id })
          .from(userRolesTable)
          .where(and(eq(userRolesTable.userId, user.id), eq(userRolesTable.tenantId, tenantId)))
          .limit(1);
        if (!membership) {
          return res.status(403).json({ error: "You are not a member of this campaign." });
        }
      }

      activeTenant = {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
      };
    }

    // The context change and its audit record commit in one transaction —
    // a platform operator entering or leaving a campaign is an auditable
    // platform event here too (same event as via the platform route).
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ activeTenantId: tenantId })
        .where(eq(usersTable.id, user.id));

      if (user.isGlobalAdmin) {
        if (tenantId) {
          await recordPlatformAction(
            req,
            {
              action: "platform.campaign.enter",
              resource: "tenant",
              tenantId,
              resourceId: tenantId,
              details: { slug: activeTenant.slug, name: activeTenant.name },
            },
            tx,
          );
        } else if (user.activeTenantId) {
          await recordPlatformAction(
            req,
            {
              action: "platform.campaign.exit",
              resource: "tenant",
              tenantId: user.activeTenantId,
              resourceId: user.activeTenantId,
            },
            tx,
          );
        }
      }
    });

    // Effective roles differ per campaign, so the cached actor snapshot is
    // stale the moment the context changes.
    bustActorCache(req.clerkId);

    res.json({ activeTenant });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
