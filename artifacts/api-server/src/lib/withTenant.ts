/**
 * withTenant — tenant-scoped query helpers for Drizzle ORM.
 *
 * Usage in a route handler (req.tenant is attached by resolveTenant middleware):
 *
 *   import { tenantFilter, assertTenant } from "../lib/withTenant";
 *
 *   router.get("/", requireAuth, resolveTenant, async (req, res) => {
 *     const t = assertTenant(req);
 *     const rows = await db
 *       .select()
 *       .from(aspirantsTable)
 *       .where(and(tenantFilter(aspirantsTable, t.id), eq(aspirantsTable.status, "approved")));
 *     res.json(rows);
 *   });
 *
 * Why a helper instead of a Drizzle plugin?
 * Drizzle does not (yet) have a global query middleware layer, so we use a
 * lightweight function that returns the standard Drizzle `eq` expression.
 * This keeps every query explicit and type-safe without magic.
 */

import { eq, type SQL } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { TenantedRequest } from "../middlewares/resolveTenant";

/**
 * Machine-readable code returned when a caller reaches a campaign-scoped route
 * with no campaign context. The frontend keys off this to send platform
 * operators to the campaign picker instead of showing a generic error.
 */
export const NO_CAMPAIGN_SELECTED = "NO_CAMPAIGN_SELECTED";

/**
 * Guard for campaign-scoped routers: reject cleanly when no tenant context was
 * established.
 *
 * This exists because platform operators legitimately have no campaign until
 * they enter one. Without it, every downstream assertTenant() would throw and
 * surface as a 500 — an internal error for what is really "you haven't picked
 * a campaign yet".
 */
export function requireTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if ((req as TenantedRequest).tenant) {
    next();
    return;
  }
  res.status(409).json({
    code: NO_CAMPAIGN_SELECTED,
    error:
      "No campaign selected. Choose a campaign to work in before using campaign features.",
  });
}

/**
 * Returns a Drizzle `eq` expression that filters rows to the given tenant.
 * Compose it with `and(...)` alongside other query predicates.
 *
 * We use `any` here because Drizzle table column types are difficult to
 * parameterise uniformly across all tables — the runtime behaviour is correct.
 */
export function tenantFilter(table: any, tenantId: string): SQL {
  return eq(table.tenantId, tenantId);
}

/** Minimal Tenant shape as returned from the DB (avoids circular import of generated types) */
export interface TenantInfo {
  id: string;
  /** Legacy Clerk Organisation reference — no longer used for access control. */
  clerkOrgId: string | null;
  name: string;
  slug: string;
  plan: string;
  isSuspended: boolean;
  /** Campaign scope — which seat is contested and the geography it covers. */
  seatType: string | null;
  scopeCountyId: string | null;
  scopeConstituencyId: string | null;
  scopeWardId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Thrown by assertTenant when a campaign-scoped handler runs with no campaign
 * context. Typed so the global error handler can answer 409 "pick a campaign"
 * instead of a 500 — this is a legitimate state for a platform operator who
 * has not entered a campaign, not an internal failure.
 */
export class NoTenantContextError extends Error {
  readonly code = NO_CAMPAIGN_SELECTED;
  constructor() {
    super(
      "No campaign selected. Choose a campaign to work in before using campaign features.",
    );
    this.name = "NoTenantContextError";
  }
}

/**
 * Extracts the resolved tenant from the request.
 *
 * Most campaign routers sit behind requireTenantContext, which rejects earlier
 * and more clearly. This is the backstop for routers that call resolveTenant
 * inline per-route.
 */
export function assertTenant(req: Request): TenantInfo {
  const tenant = (req as TenantedRequest).tenant as unknown as TenantInfo | undefined;
  if (!tenant) {
    throw new NoTenantContextError();
  }
  return tenant;
}
