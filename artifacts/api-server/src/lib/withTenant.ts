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
import type { Request } from "express";
import type { TenantedRequest } from "../middlewares/resolveTenant";

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
  clerkOrgId: string;
  name: string;
  slug: string;
  plan: string;
  isSuspended: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Extracts the resolved tenant from the request and throws if it is missing
 * (which would be a programming error — resolveTenant middleware must run first).
 */
export function assertTenant(req: Request): TenantInfo {
  const tenant = (req as TenantedRequest).tenant as unknown as TenantInfo | undefined;
  if (!tenant) {
    throw new Error(
      "assertTenant: req.tenant is not set. Did you forget to apply resolveTenant middleware?",
    );
  }
  return tenant;
}
