/**
 * Plan enforcement middleware.
 *
 * Gates routes and capacity behind the tenant's *effective* plan (see
 * lib/plans.ts — trials and lapsed subscriptions are accounted for).
 *
 * Responds 402 Payment Required with a machine-readable body so the frontend
 * can show a targeted upgrade prompt rather than a generic error:
 *
 *   { error, feature, currentPlan, requiredPlan, upgradeUrl }
 *
 * Must run AFTER resolveTenant — it reads req.tenant.
 */

import type { Request, Response, NextFunction } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  PLANS,
  getEffectivePlan,
  minimumTierFor,
  planSatisfies,
  type PlanFeature,
  type PlanTier,
} from "../lib/plans";

/** Human-readable labels used in the 402 message. */
const FEATURE_LABELS: Record<PlanFeature, string> = {
  customDomain: "Custom domains",
  excelExport: "Excel exports",
  whiteLabelMobile: "White-labelled mobile app",
  advancedReporting: "Advanced reporting",
  prioritySupport: "Priority support",
};

function upgradeUrl(): string {
  const base = process.env.PLATFORM_URL ?? "";
  return `${base}/settings?tab=plan`;
}

/**
 * Block the request unless the tenant's effective plan grants `feature`.
 *
 * Usage:
 *   router.get("/export.xlsx", requireAuth, requirePlanFeature("excelExport"), handler)
 */
export function requirePlanFeature(feature: PlanFeature) {
  return function planFeatureGate(req: Request, res: Response, next: NextFunction) {
    const tenant = (req as any).tenant;

    // No tenant context (e.g. platform-admin route) — nothing to gate.
    if (!tenant) return next();

    const effective = getEffectivePlan(tenant);
    if (PLANS[effective.plan][feature]) return next();

    const required = minimumTierFor(feature);
    res.status(402).json({
      error: `${FEATURE_LABELS[feature]} ${required ? `require the ${PLANS[required].label} plan` : "are not available on your plan"}.`,
      feature,
      currentPlan: effective.plan,
      requiredPlan: required,
      upgradeUrl: upgradeUrl(),
    });
  };
}

/**
 * Block the request unless the tenant's effective plan is at least `tier`.
 */
export function requirePlanTier(tier: PlanTier) {
  return function planTierGate(req: Request, res: Response, next: NextFunction) {
    const tenant = (req as any).tenant;
    if (!tenant) return next();

    const effective = getEffectivePlan(tenant);
    if (planSatisfies(effective.plan, tier)) return next();

    res.status(402).json({
      error: `This feature requires the ${PLANS[tier].label} plan.`,
      feature: null,
      currentPlan: effective.plan,
      requiredPlan: tier,
      upgradeUrl: upgradeUrl(),
    });
  };
}

/**
 * Capacity gate — blocks creation when the tenant is at its plan's cap.
 *
 * `countRows` receives the tenant id and returns the current row count for
 * whatever is being capped. Only runs on mutating methods.
 */
export function requireCapacity(
  limitKey: "maxAgents" | "maxStations",
  countRows: (tenantId: string) => Promise<number>,
  entityLabel: string,
) {
  return async function capacityGate(req: Request, res: Response, next: NextFunction) {
    const tenant = (req as any).tenant;
    if (!tenant) return next();

    const effective = getEffectivePlan(tenant);
    const limit = PLANS[effective.plan][limitKey];
    if (limit === null) return next(); // unlimited

    try {
      const current = await countRows(tenant.id);
      if (current < limit) return next();

      const required = effective.plan === "free" ? "pro" : "enterprise";
      res.status(402).json({
        error: `Your ${PLANS[effective.plan].label} plan allows up to ${limit} ${entityLabel}. Upgrade to add more.`,
        feature: limitKey,
        currentPlan: effective.plan,
        requiredPlan: required,
        current,
        limit,
        upgradeUrl: upgradeUrl(),
      });
    } catch {
      // A counting failure must not block legitimate work.
      next();
    }
  };
}

/** Current agent count for a tenant — used by requireCapacity. */
export async function countAgents(tenantId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM polling_agents WHERE tenant_id = ${tenantId}`,
  ) as unknown as Array<{ n: number }>;
  return Number(row?.n ?? 0);
}

/** Current polling-station-profile count for a tenant. */
export async function countStations(tenantId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM campaign_station_profiles WHERE tenant_id = ${tenantId}`,
  ) as unknown as Array<{ n: number }>;
  return Number(row?.n ?? 0);
}

/**
 * Fetch a fresh tenant row and compute its effective plan.
 * Use in handlers that need plan info but don't sit behind a gate.
 */
export async function loadEffectivePlan(tenantId: string) {
  const [tenant] = await db
    .select({
      plan: tenantsTable.plan,
      planOverrideUntil: tenantsTable.planOverrideUntil,
      stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  return getEffectivePlan(tenant);
}
