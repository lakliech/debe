/**
 * Plan tier definitions and limits.
 *
 * Single source of truth for what each subscription tier allows. Imported by
 * both the enforcement middleware (requirePlanFeature) and the API responses
 * that drive the pricing page and upgrade prompts in the UI.
 *
 * A tenant's *effective* plan is not simply `tenants.plan` — see
 * getEffectivePlan() which accounts for trial overrides and lapsed
 * subscriptions.
 */

export type PlanTier = "free" | "pro" | "enterprise";

/**
 * The writable tiers, in ascending order. Mirrors the `plan_tier` DB enum —
 * use it to validate anything arriving from a request body before it reaches
 * an insert, so a bad tier fails as a 400 and not as a driver error.
 */
export const PLAN_TIERS: readonly PlanTier[] = ["free", "pro", "enterprise"];

/** Feature keys that can be gated. Keep in sync with PlanLimits booleans. */
export type PlanFeature =
  | "customDomain"
  | "excelExport"
  | "whiteLabelMobile"
  | "advancedReporting"
  | "prioritySupport";

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  /** Monthly price in KES. null = "contact us" pricing. */
  priceMonthlyKes: number | null;
  /** null = unlimited */
  maxAgents: number | null;
  /** null = unlimited */
  maxStations: number | null;
  customDomain: boolean;
  excelExport: boolean;
  whiteLabelMobile: boolean;
  advancedReporting: boolean;
  prioritySupport: boolean;
  description: string;
  /** Bullet points shown on the pricing page. */
  features: string[];
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: "free",
    label: "Free",
    priceMonthlyKes: 0,
    maxAgents: 50,
    maxStations: 100,
    customDomain: false,
    excelExport: false,
    whiteLabelMobile: false,
    advancedReporting: false,
    prioritySupport: false,
    description: "Get your campaign organised — ideal for ward and constituency races.",
    features: [
      "1 campaign",
      "Up to 50 polling agents",
      "Up to 100 polling stations",
      "Volunteer & supporter management",
      "Form 34A submission and verification",
      "Public campaign portal",
      "CSV report downloads",
    ],
  },
  pro: {
    tier: "pro",
    label: "Pro",
    priceMonthlyKes: 25_000,
    maxAgents: null,
    maxStations: null,
    customDomain: true,
    excelExport: true,
    whiteLabelMobile: false,
    advancedReporting: true,
    prioritySupport: false,
    description: "For county and national campaigns running full election-day operations.",
    features: [
      "Unlimited polling agents",
      "Unlimited polling stations",
      "Custom domain with HTTPS",
      "Excel exports with formatting",
      "Advanced reporting & tally analytics",
      "Transparency portal",
      "Compliance register (DPIA, vendors, breaches)",
    ],
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    priceMonthlyKes: null,
    maxAgents: null,
    maxStations: null,
    customDomain: true,
    excelExport: true,
    whiteLabelMobile: true,
    advancedReporting: true,
    prioritySupport: true,
    description: "Presidential campaigns and multi-campaign operators.",
    features: [
      "Everything in Pro",
      "White-labelled mobile app (your branding, your app store listing)",
      "Dedicated support with election-day SLA",
      "Multi-campaign consultant access",
      "Custom onboarding & agent training",
    ],
  },
};

/** Ordered weakest → strongest, for comparison. */
export const PLAN_ORDER: PlanTier[] = ["free", "pro", "enterprise"];

export function planRank(tier: PlanTier): number {
  return PLAN_ORDER.indexOf(tier);
}

/** True if `have` meets or exceeds `need`. */
export function planSatisfies(have: PlanTier, need: PlanTier): boolean {
  return planRank(have) >= planRank(need);
}

/** Lowest tier that grants the given feature, or null if no tier does. */
export function minimumTierFor(feature: PlanFeature): PlanTier | null {
  for (const tier of PLAN_ORDER) {
    if (PLANS[tier][feature]) return tier;
  }
  return null;
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && value in PLANS;
}

/** Number of days a new campaign gets Pro for free. */
export const TRIAL_DAYS = 14;

/** Show the trial countdown banner when this many days or fewer remain. */
export const TRIAL_WARNING_DAYS = 7;

/** Grace period after a subscription goes past_due before access is revoked. */
export const PAST_DUE_GRACE_DAYS = 7;

export interface EffectivePlan {
  /** The tier actually in force right now. */
  plan: PlanTier;
  /** The tier stored on the tenant row (may be higher than effective if lapsed). */
  storedPlan: PlanTier;
  isTrial: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: Date | null;
  /** True when a paid subscription is active or trialing in Stripe. */
  hasActiveSubscription: boolean;
}

/** Minimal shape needed to compute the effective plan — matches the tenants row. */
export interface PlanBearingTenant {
  plan: string;
  planOverrideUntil: Date | null;
  stripeSubscriptionStatus: string | null;
}

/**
 * Resolve what a tenant is actually entitled to right now.
 *
 * Rules, in order:
 *  1. An active/trialing Stripe subscription grants the stored plan.
 *  2. Otherwise, an unexpired planOverrideUntil grants the stored plan
 *     (this is the trial path, and the manual platform-admin grant path).
 *  3. Otherwise the tenant falls back to Free.
 *
 * Always use this instead of reading `tenants.plan` directly.
 */
export function getEffectivePlan(
  tenant: PlanBearingTenant,
  now: Date = new Date(),
): EffectivePlan {
  const storedPlan: PlanTier = isPlanTier(tenant.plan) ? tenant.plan : "free";
  const overrideUntil = tenant.planOverrideUntil
    ? new Date(tenant.planOverrideUntil)
    : null;
  const overrideActive = !!overrideUntil && overrideUntil.getTime() > now.getTime();

  const status = tenant.stripeSubscriptionStatus;
  const hasActiveSubscription = status === "active" || status === "trialing";

  const trialDaysLeft = overrideActive
    ? Math.max(
        0,
        Math.ceil((overrideUntil!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      )
    : null;

  // A tenant is "on trial" when the override is what is granting them their
  // plan — i.e. there is no paid subscription behind it.
  const isTrial = overrideActive && !hasActiveSubscription && storedPlan !== "free";

  let plan: PlanTier = "free";
  if (hasActiveSubscription || overrideActive) plan = storedPlan;

  return {
    plan,
    storedPlan,
    isTrial,
    trialDaysLeft,
    trialEndsAt: overrideActive ? overrideUntil : null,
    hasActiveSubscription,
  };
}

/** Public-facing plan catalogue for the pricing page (no internal fields). */
export function publicPlanCatalogue() {
  return PLAN_ORDER.map((tier) => {
    const p = PLANS[tier];
    return {
      tier: p.tier,
      label: p.label,
      priceMonthlyKes: p.priceMonthlyKes,
      description: p.description,
      features: p.features,
      maxAgents: p.maxAgents,
      maxStations: p.maxStations,
    };
  });
}
