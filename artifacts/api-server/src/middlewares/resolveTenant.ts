/**
 * resolveTenant — multi-tenant boundary middleware.
 *
 * Reads the active Clerk organisation from req.auth.orgId, looks up the
 * matching tenant row in the DB, and attaches it to req.tenant.
 *
 * Fallback order (for backward-compatibility during the seed period):
 *   1. req.auth.orgId from the Clerk JWT
 *   2. SEED_CLERK_ORG_ID env-var (lets the legacy single-org setup keep working)
 *
 * Returns:
 *   401 — no Clerk session at all (requireAuth should have caught this first)
 *   403 — org not in JWT and no fallback configured
 *   403 — org ID found but no tenant row exists for it (unregistered org)
 *   403 — tenant exists but is suspended
 */

import { getAuth } from "@clerk/express";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { Tenant } from "@workspace/db";

/**
 * Return true if the given Clerk user ID belongs to a global admin.
 * Used to bypass tenant requirements for platform owners.
 */
async function isGlobalAdmin(clerkUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ isGlobalAdmin: usersTable.isGlobalAdmin })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);
  return !!row?.isGlobalAdmin;
}

/**
 * Return the first non-suspended tenant in the DB (oldest by creation date).
 * Used as a fallback context for global admins who have no active Clerk org.
 */
async function firstAvailableTenant(): Promise<Tenant | null> {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.isSuspended, false))
    .orderBy(asc(tenantsTable.createdAt))
    .limit(1);
  return tenant ?? null;
}

/** HTTP methods that mutate state — blocked on the read-only demo tenant. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface TenantedRequest extends Request {
  tenant: Tenant;
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
    // Global admins can operate without an active org — fall back to the first
    // available tenant so campaign-scoped routes work.  Platform-only routes
    // (which skip resolveTenant entirely) always work regardless.
    if (await isGlobalAdmin(auth.userId)) {
      const fallback = await firstAvailableTenant();
      if (fallback) (req as TenantedRequest).tenant = fallback;
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
    // Same fallback for global admins whose Clerk org isn't registered yet.
    if (await isGlobalAdmin(auth.userId)) {
      const fallback = await firstAvailableTenant();
      if (fallback) (req as TenantedRequest).tenant = fallback;
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
