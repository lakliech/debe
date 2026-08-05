/**
 * resolveTenant — multi-tenant boundary middleware.
 *
 * Identity (who you are) and context (which campaign you are working in) are
 * two different things. This middleware only establishes *context*.
 *
 * Campaign context is owned by THIS APP, not by the identity provider. Clerk
 * proves who the caller is; the user_roles table says which campaigns they
 * belong to. (Clerk Organisations previously played that role, but the feature
 * is not enabled on this instance, so no token will ever carry an org id.)
 *
 * There are exactly two routes into a campaign:
 *
 *   1. MEMBERSHIP — campaign users. Context comes from their user_roles rows:
 *      - exactly one membership → that campaign, automatically
 *      - several memberships   → the one they explicitly entered
 *        (users.active_tenant_id); if they have not entered one, the request
 *        proceeds WITHOUT a tenant and requireTenantContext answers 409
 *      - no memberships        → 403; there is no campaign to resolve
 *
 *   2. PLATFORM STANDING — global admins. They belong to no campaign and
 *      their access never consults membership. They get whichever campaign
 *      they explicitly entered, or no context at all. Picking a campaign for
 *      them would make their privileges depend on unrelated DB state.
 *
 * Returns:
 *   401 — no Clerk session at all (requireAuth should have caught this first)
 *   403 — the caller belongs to no campaign
 *   403 — the resolved campaign is suspended
 */

import { getAuth } from "@clerk/express";
import { db, tenantsTable, usersTable, userRolesTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { Tenant } from "@workspace/db";

/** HTTP methods that mutate state — blocked on the read-only demo tenant. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface TenantedRequest extends Request {
  tenant: Tenant;
}

/**
 * Set on requests from a global admin operating outside any campaign.
 * `tenant` is present only when they have explicitly entered a campaign.
 */
export interface PlatformOperatorRequest extends Request {
  isPlatformOperator?: boolean;
  tenant?: Tenant;
}

interface CallerContext {
  /** Local users.id — null when the Clerk account has no local row yet. */
  userId: string | null;
  isGlobalAdmin: boolean;
  activeTenantId: string | null;
  /** Distinct campaign ids the caller belongs to via user_roles. */
  membershipTenantIds: string[];
}

/**
 * Load everything the middleware needs to know about the caller in two
 * queries: their user row (standing + entered campaign) and, for
 * non-operators, their campaign memberships.
 *
 * Membership is deliberately NOT loaded for global admins: platform authority
 * must never depend on, or be polluted by, belonging somewhere.
 */
async function loadCallerContext(clerkUserId: string): Promise<CallerContext> {
  const [row] = await db
    .select({
      id: usersTable.id,
      isGlobalAdmin: usersTable.isGlobalAdmin,
      activeTenantId: usersTable.activeTenantId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);

  if (!row) {
    return { userId: null, isGlobalAdmin: false, activeTenantId: null, membershipTenantIds: [] };
  }

  if (row.isGlobalAdmin) {
    return {
      userId: row.id,
      isGlobalAdmin: true,
      activeTenantId: row.activeTenantId ?? null,
      membershipTenantIds: [],
    };
  }

  const membershipRows = await db
    .select({ tenantId: userRolesTable.tenantId })
    .from(userRolesTable)
    .where(
      and(eq(userRolesTable.userId, row.id), isNotNull(userRolesTable.tenantId)),
    );

  const membershipTenantIds = [
    ...new Set(
      membershipRows
        .map((r) => r.tenantId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  return {
    userId: row.id,
    isGlobalAdmin: false,
    activeTenantId: row.activeTenantId ?? null,
    membershipTenantIds,
  };
}

/**
 * The campaign id a member is currently working in, or null when they must
 * choose one first. An entered campaign that is no longer among the caller's
 * memberships (role revoked, campaign purged) is ignored rather than trusted.
 */
function memberTenantId(ctx: CallerContext): string | null {
  if (ctx.activeTenantId && ctx.membershipTenantIds.includes(ctx.activeTenantId)) {
    return ctx.activeTenantId;
  }
  if (ctx.membershipTenantIds.length === 1) return ctx.membershipTenantIds[0];
  return null;
}

async function loadTenantById(tenantId: string): Promise<Tenant | undefined> {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return tenant;
}

/**
 * Attach the campaign a platform operator has explicitly entered, if any.
 * A suspended or deleted campaign yields no context rather than an error —
 * the operator simply lands back on the platform surface.
 */
async function attachEnteredCampaign(
  req: Request,
  activeTenantId: string | null,
): Promise<void> {
  (req as PlatformOperatorRequest).isPlatformOperator = true;
  if (!activeTenantId) return;

  const tenant = await loadTenantById(activeTenantId);
  if (tenant && !tenant.isSuspended) {
    (req as TenantedRequest).tenant = tenant;
  }
}

/** Attach the member's campaign, enforcing suspension and the demo guard. */
async function attachMemberCampaign(
  req: Request,
  res: Response,
  tenantId: string,
): Promise<boolean> {
  const tenant = await loadTenantById(tenantId);
  if (!tenant) return false; // stale membership — treat as "no context"

  if (tenant.isSuspended) {
    res.status(403).json({ error: "This campaign account has been suspended." });
    return true;
  }

  (req as TenantedRequest).tenant = tenant;

  // Demo guard — block all mutating requests on the shared read-only demo
  // tenant. Enforced here so it applies universally: via withTenant(), via
  // withTenantMixed() for authenticated paths, and in routers (e.g. /config)
  // that call resolveTenant inline per-route rather than through the helpers.
  if (tenant.slug === "demo" && MUTATING_METHODS.has(req.method)) {
    res.status(403).json({
      error: "Read-only demo — sign up for a real campaign to make changes.",
    });
    return true;
  }

  return false;
}

export async function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ctx = await loadCallerContext(auth.userId);

  // Platform operators have no campaign by design. They get whichever
  // campaign they explicitly entered — or no context at all.
  if (ctx.isGlobalAdmin) {
    await attachEnteredCampaign(req, ctx.activeTenantId);
    return next();
  }

  if (ctx.membershipTenantIds.length === 0) {
    res.status(403).json({
      error:
        "You don't belong to a campaign yet. Register your campaign or ask your campaign administrator for access.",
    });
    return;
  }

  const tenantId = memberTenantId(ctx);
  if (!tenantId) {
    // Member of several campaigns who has not entered one — an explicit
    // "choose a campaign" state, answered by requireTenantContext downstream.
    return next();
  }

  const handled = await attachMemberCampaign(req, res, tenantId);
  if (handled) return;
  next();
}

/**
 * resolveTenantOptional — for identity routes (who am I?) rather than
 * campaign routes (what is in this campaign?).
 *
 * Identity is not tenant-scoped: a signed-in user must be able to learn who
 * they are even when they belong to no campaign or have not entered one.
 * Attaching campaign context is best-effort; nothing here ever rejects the
 * request beyond the 401 for a missing session.
 */
export async function resolveTenantOptional(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ctx = await loadCallerContext(auth.userId);

  if (ctx.isGlobalAdmin) {
    await attachEnteredCampaign(req, ctx.activeTenantId);
    return next();
  }

  const tenantId = memberTenantId(ctx);
  if (tenantId) {
    const tenant = await loadTenantById(tenantId);
    if (tenant && !tenant.isSuspended) {
      (req as TenantedRequest).tenant = tenant;
    }
  }
  next();
}

/**
 * resolveTenantMixed — for routers that contain BOTH authenticated and
 * unauthenticated (public) endpoints.
 *
 * - If the request carries an active Clerk session → delegate to resolveTenant
 *   (derives tenant from the caller's own memberships — never from headers).
 * - If the request is unauthenticated → delegate to resolveTenantPublic
 *   (derives tenant from X-Tenant-Slug / ?tenant query param).
 *
 * This ensures authenticated callers always use their app-owned membership as
 * the tenant source (no request-header spoofing), while public callers can
 * still identify the campaign they are submitting to.
 */
export async function resolveTenantMixed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (auth?.userId) {
    return resolveTenant(req, res, next);
  }
  return resolveTenantPublic(req, res, next);
}

/**
 * resolveTenantPublic — used on unauthenticated public routes.
 *
 * Resolution order:
 *   1. X-Tenant-Slug request header (set by the reverse proxy from the subdomain)
 *   2. ?tenant= query parameter (dev convenience only)
 *
 * Returns 400 if no slug provided, 404 if slug not found, 403 if suspended.
 */
export async function resolveTenantPublic(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const slug =
    (req.headers["x-tenant-slug"] as string | undefined) ??
    (req.query["tenant"] as string | undefined);

  if (!slug) {
    // No tenant context — proceed without one (some public endpoints may be
    // tenant-agnostic, e.g. health checks).
    next();
    return;
  }

  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);

  if (!tenant) {
    res.status(404).json({ error: `Campaign '${slug}' not found.` });
    return;
  }

  if (tenant.isSuspended) {
    res.status(403).json({ error: "This campaign account has been suspended." });
    return;
  }

  (req as TenantedRequest).tenant = tenant;

  // Demo guard — also applied here so that unauthenticated public routes
  // (volunteer registration, supporter sign-up, policy submissions, etc.)
  // cannot mutate the shared read-only demo tenant.
  if (tenant.slug === "demo" && MUTATING_METHODS.has(req.method)) {
    res.status(403).json({
      error: "Read-only demo — sign up for a real campaign to make changes.",
    });
    return;
  }

  next();
}
