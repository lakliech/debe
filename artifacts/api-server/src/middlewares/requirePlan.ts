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
 *
 * Platform super admin override: every gate in this module passes for the
 * platform super admin (lib/platformOverride.ts). They support and repair
 * customer campaigns, and must never be forced to change a customer's
 * billing just to use a feature inside that customer's campaign.
 */

import type { Request, Response, NextFunction } from "express";
import {
  db,
  tenantsTable,
  pollingAgentsTable,
  campaignStationProfilesTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import { hasPlatformOverride } from "../lib/platformOverride";
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
  return async function planFeatureGate(req: Request, res: Response, next: NextFunction) {
    const tenant = (req as any).tenant;

    // No tenant context (e.g. platform-admin route) — nothing to gate.
    if (!tenant) return next();

    try {
      if (await hasPlatformOverride(req, res)) return next();
    } catch (err) {
      return next(err);
    }

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
 * Same gate, but only for the requests that actually use the paid feature.
 *
 * Some endpoints serve both a free and a paid variant of the same work — the
 * report exporter returns CSV to everyone and Excel only to paying campaigns.
 * Gating the whole route would take the free variant away too, so the caller
 * supplies a predicate that says whether this particular request needs the
 * feature.
 */
export function requirePlanFeatureWhen(
  feature: PlanFeature,
  applies: (req: Request) => boolean,
) {
  const gate = requirePlanFeature(feature);
  return function conditionalPlanFeatureGate(req: Request, res: Response, next: NextFunction) {
    let needed: boolean;
    try {
      needed = applies(req);
    } catch {
      needed = false;
    }
    if (!needed) return next();
    return gate(req, res, next);
  };
}

/**
 * Block the request unless the tenant's effective plan is at least `tier`.
 */
export function requirePlanTier(tier: PlanTier) {
  return async function planTierGate(req: Request, res: Response, next: NextFunction) {
    const tenant = (req as any).tenant;
    if (!tenant) return next();

    try {
      if (await hasPlatformOverride(req, res)) return next();
    } catch (err) {
      return next(err);
    }

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

    try {
      if (await hasPlatformOverride(req, res)) return next();
    } catch (err) {
      return next(err);
    }

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
    } catch (err) {
      // Fail closed. A gate that cannot count is a gate that isn't there: the
      // first version of this middleware allowed the request on a counting
      // error and the cap silently stopped existing for every campaign.
      // Refusing is recoverable (the operator retries); leaking the cap is not.
      logger.error({ err, limitKey, tenantId: tenant.id }, "capacity check failed — refusing request");
      res.status(503).json({
        error: `We couldn't check your plan's ${entityLabel} limit just now. Please try again in a moment.`,
        feature: limitKey,
        retryable: true,
      });
    }
  };
}

/**
 * Capacity check for bulk work, where the request adds many rows at once.
 *
 * requireCapacity only refuses once a campaign has already reached its cap,
 * which is the right answer for a one-row create but lets a 500-row import
 * sail past a 50-agent limit. Handlers that add `incoming` rows call this and
 * refuse the whole batch when it would not fit.
 *
 * Returns the 402 body to send, or null when the batch fits.
 */
export async function capacityViolation(
  tenantId: string,
  limitKey: "maxAgents" | "maxStations",
  countRows: (tenantId: string) => Promise<number>,
  entityLabel: string,
  incoming: number,
): Promise<Record<string, unknown> | null> {
  const effective = await loadEffectivePlan(tenantId);
  if (!effective) return null;

  const limit = PLANS[effective.plan][limitKey];
  if (limit === null) return null; // unlimited

  // No try/catch on purpose: the caller must not be able to treat a failed
  // count as "the batch fits". A thrown error surfaces as a 500 and the import
  // is refused, which is the safe direction for a paid limit.
  const current = await countRows(tenantId);
  if (current + incoming <= limit) return null;

  return {
    error: `Your ${PLANS[effective.plan].label} plan allows up to ${limit} ${entityLabel}. This import would take you to ${current + incoming}. Upgrade to add more.`,
    feature: limitKey,
    currentPlan: effective.plan,
    requiredPlan: effective.plan === "free" ? "pro" : "enterprise",
    current,
    incoming,
    limit,
    upgradeUrl: upgradeUrl(),
  };
}

/**
 * Current agent count for a tenant — used by requireCapacity.
 *
 * Counted through the query builder on purpose: db.execute() resolves to a
 * pg Result object, not an array, so destructuring its first row yields
 * undefined and every capacity check would read zero.
 */
export async function countAgents(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(pollingAgentsTable)
    .where(eq(pollingAgentsTable.tenantId, tenantId));
  return Number(row?.n ?? 0);
}

/** Current polling-station-profile count for a tenant. */
export async function countStations(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(campaignStationProfilesTable)
    .where(eq(campaignStationProfilesTable.tenantId, tenantId));
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
