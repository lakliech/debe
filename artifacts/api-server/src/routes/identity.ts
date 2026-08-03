/**
 * identity — "who am I?" for the signed-in caller.
 *
 * Mounted OUTSIDE the tenant boundary on purpose. Identity is not a property
 * of a campaign: campaign staff, users whose org is not yet registered, and
 * platform operators who administer every campaign but belong to none must all
 * be able to load their own record. Putting this behind resolveTenant is what
 * forced the system to invent a campaign for anyone who did not have one.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserWithRoles, getOrCreateLocalUser } from "../lib/userIdentity";
import {
  resolveTenantOptional,
  type PlatformOperatorRequest,
} from "../middlewares/resolveTenant";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

/**
 * GET /api/users/me
 *
 * Returns the caller's record plus the context they are operating in:
 *   isPlatformOperator — true for global admins, who have no campaign of their own
 *   activeTenant       — the campaign currently in context, or null
 *
 * The frontend uses these to decide where to land the user: a platform
 * operator with no activeTenant belongs on the platform surface, not on a
 * campaign dashboard.
 */
router.get("/me", requireAuth, resolveTenantOptional, async (req: any, res: any) => {
  const tenant = (req as PlatformOperatorRequest).tenant;
  const tenantId: string | undefined = tenant?.id;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, req.clerkId))
    .limit(1);

  const user = existing[0]
    ? await getUserWithRoles(existing[0].id, tenantId)
    : await getOrCreateLocalUser(req.clerkId);

  res.json({
    ...user,
    isPlatformOperator: Boolean((req as PlatformOperatorRequest).isPlatformOperator),
    activeTenant: tenant
      ? { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan }
      : null,
  });
});

export default router;
