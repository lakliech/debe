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
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { Tenant } from "@workspace/db";

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
  next();
}
