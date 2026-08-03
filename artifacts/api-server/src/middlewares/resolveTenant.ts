/**
 * resolveTenant — multi-tenant boundary middleware.
 *
 * Identity (who you are) and context (which campaign you are working in) are
 * two different things. This middleware only establishes *context*.
 *
 * Resolution order:
 *   1. req.auth.orgId from the Clerk JWT — the authoritative source for
 *      campaign staff, who are members of exactly one campaign org.
 *   2. SEED_CLERK_ORG_ID env-var (lets the legacy single-org setup keep working)
 *   3. For platform operators (global admins) only: users.active_tenant_id —
 *      the campaign they have explicitly entered from the platform surface.
 *
 * Platform operators deliberately have NO default campaign. If they have not
 * entered one, the request continues with req.tenant undefined and
 * req.isPlatformOperator true; campaign-scoped routes then reject it via
 * requireTenantContext rather than the middleware inventing a tenant. Picking
 * a tenant for them (e.g. "the oldest one") makes their effective privileges
 * depend on unrelated DB state, which silently changes what they can do.
 *
 * Returns:
 *   401 — no Clerk session at all (requireAuth should have caught this first)
 *   403 — org not in JWT and the caller is not a platform operator
 *   403 — org ID found but no tenant row exists for it (unregistered org)
 *   403 — tenant exists but is suspended
 */

import { getAuth } from "@clerk/express";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { Tenant } from "@workspace/db";

/**
 * Look up the platform-operator facts for a Clerk user in one query:
 * whether they are a global admin, and which campaign (if any) they have
 * explicitly entered.
 */
async function loadOperator(
  clerkUserId: string,
): Promise<{ isGlobalAdmin: boolean; activeTenantId: string | null }> {
  const [row] = await db
    .select({
      isGlobalAdmin: usersTable.isGlobalAdmin,
      activeTenantId: usersTable.activeTenantId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);
  return {
    isGlobalAdmin: !!row?.isGlobalAdmin,
    activeTenantId: row?.activeTenantId ?? null,
  };
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

  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, activeTenantId))
    .limit(1);

  if (tenant && !tenant.isSuspended) {
    (req as TenantedRequest).tenant = tenant;
  }
}

/** HTTP methods that mutate state — blocked on the read-only demo tenant. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface TenantedRequest extends Request {
  tenant: Tenant;
}

/**
 * Set on requests from a global admin operating outside any campaign org.
 * `tenant` is present only when they have explicitly entered a campaign.
 */
export interface PlatformOperatorRequest extends Request {
  isPlatformOperator?: boolean;
  tenant?: Tenant;
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

  // Prefer the active org from the JWT; fall back to the seed env-var.
  const clerkOrgId: string | null =
    (auth as any).orgId ?? process.env.SEED_CLERK_ORG_ID ?? null;

  if (!clerkOrgId) {
    // Platform operators have no campaign org by design. They get whichever
    // campaign they explicitly entered — or no context at all.
    const operator = await loadOperator(auth.userId);
    if (operator.isGlobalAdmin) {
      await attachEnteredCampaign(req, operator.activeTenantId);
      return next();
    }
    res.status(403).json({
      error: "No active organisation in session. Please activate a campaign organisation.",
    });
    return;
  }

  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.clerkOrgId, clerkOrgId))
    .limit(1);

  if (!tenant) {
    // A platform operator whose Clerk org isn't registered as a campaign is
    // still an operator — they fall back to the campaign they entered, if any.
    const operator = await loadOperator(auth.userId);
    if (operator.isGlobalAdmin) {
      await attachEnteredCampaign(req, operator.activeTenantId);
      return next();
    }
    res.status(403).json({
      error: `Organisation '${clerkOrgId}' is not registered as a tenant.`,
    });
    return;
  }

  if (tenant.isSuspended) {
    res.status(403).json({ error: "This campaign account has been suspended." });
    return;
  }

  (req as TenantedRequest).tenant = tenant;

  // Demo guard — block all mutating requests on the shared read-only demo tenant.
  // Enforced here (inside resolveTenant) so it applies universally: via withTenant(),
  // via withTenantMixed() for authenticated paths, and in routers (e.g. /config) that
  // call resolveTenant inline per-route rather than through the helper wrappers.
  if (tenant.slug === "demo" && MUTATING_METHODS.has(req.method)) {
    res.status(403).json({
      error: "Read-only demo — sign up for a real campaign to make changes.",
    });
    return;
  }

  next();
}

/**
 * resolveTenantOptional — for identity routes (who am I?) rather than
 * campaign routes (what is in this campaign?).
 *
 * Identity is not tenant-scoped: a signed-in user must be able to learn who
 * they are even when they belong to no campaign, their org is unregistered, or
 * they are a platform operator who has not entered a campaign yet. Attaching
 * campaign context is best-effort; nothing here ever rejects the request.
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

  const clerkOrgId: string | null =
    (auth as any).orgId ?? process.env.SEED_CLERK_ORG_ID ?? null;

  if (clerkOrgId) {
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.clerkOrgId, clerkOrgId))
      .limit(1);
    if (tenant && !tenant.isSuspended) {
      (req as TenantedRequest).tenant = tenant;
      next();
      return;
    }
  }

  const operator = await loadOperator(auth.userId);
  if (operator.isGlobalAdmin) {
    await attachEnteredCampaign(req, operator.activeTenantId);
  }
  next();
}

/**
 * resolveTenantMixed — for routers that contain BOTH authenticated and
 * unauthenticated (public) endpoints.
 *
 * - If the request carries an active Clerk session → delegate to resolveTenant
 *   (derives tenant from orgId in the JWT, the authoritative source).
 * - If the request is unauthenticated → delegate to resolveTenantPublic
 *   (derives tenant from X-Tenant-Slug / ?tenant query param).
 *
 * This ensures authenticated callers always use their JWT org as the tenant
 * source (no request-header spoofing), while public callers can still identify
 * the campaign they are submitting to.
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
