/**
 * Stripe billing integration.
 *
 * Environment:
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET        whsec_…  (from the webhook endpoint config)
 *   STRIPE_PRO_PRICE_ID          price_…  monthly Pro price
 *   STRIPE_ENTERPRISE_PRICE_ID   price_…  monthly Enterprise price (optional)
 *   PLATFORM_URL                 used to build success/cancel/return URLs
 *
 * Billing is optional infrastructure: when STRIPE_SECRET_KEY is absent the
 * module reports itself unconfigured and the routes return 503 rather than
 * crashing the server. This keeps development and self-hosted deployments
 * working without a Stripe account.
 */

import Stripe from "stripe";
import type { PlanTier } from "./plans";

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set — billing is not configured.");
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pin so a Stripe-side default bump can't change response shapes.
      apiVersion: "2025-10-29.clover" as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return client;
}

export function platformUrl(): string {
  return (process.env.PLATFORM_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

/** Stripe price id for a paid tier, or null when not configured. */
export function priceIdFor(tier: PlanTier): string | null {
  if (tier === "pro") return process.env.STRIPE_PRO_PRICE_ID ?? null;
  if (tier === "enterprise") return process.env.STRIPE_ENTERPRISE_PRICE_ID ?? null;
  return null; // free has no price
}

/** Reverse lookup: which tier does this Stripe price belong to? */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  return null;
}

export interface EnsureCustomerArgs {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  existingCustomerId?: string | null;
}

/**
 * Return an existing Stripe customer id, or create one for this tenant.
 * The tenant id is stored in customer metadata so webhooks can map back
 * without a database lookup on the customer email.
 */
export async function ensureCustomer(args: EnsureCustomerArgs): Promise<string> {
  const stripe = getStripe();

  if (args.existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(args.existingCustomerId);
      if (existing && !existing.deleted) return args.existingCustomerId;
    } catch {
      // Fall through and create a fresh customer.
    }
  }

  const customer = await stripe.customers.create({
    name: args.tenantName,
    email: args.email,
    metadata: {
      tenant_id: args.tenantId,
      tenant_slug: args.tenantSlug,
    },
  });
  return customer.id;
}

export interface CheckoutArgs {
  customerId: string;
  priceId: string;
  tenantId: string;
  /** Remaining trial days to honour, so upgrading mid-trial isn't charged early. */
  trialDaysRemaining?: number | null;
}

/** Create a Checkout session and return its hosted URL. */
export async function createCheckoutSession(args: CheckoutArgs): Promise<string> {
  const stripe = getStripe();
  const base = platformUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: args.customerId,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: `${base}/settings?tab=plan&checkout=success`,
    cancel_url: `${base}/settings?tab=plan&checkout=cancelled`,
    client_reference_id: args.tenantId,
    metadata: { tenant_id: args.tenantId },
    subscription_data: {
      metadata: { tenant_id: args.tenantId },
      ...(args.trialDaysRemaining && args.trialDaysRemaining > 0
        ? { trial_period_days: Math.min(args.trialDaysRemaining, 365) }
        : {}),
    },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

/** Create a Billing Portal session and return its hosted URL. */
export async function createPortalSession(customerId: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${platformUrl()}/settings?tab=plan`,
  });
  return session.url;
}

/** Cancel a subscription immediately — used when a tenant is purged. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err: any) {
    // Already cancelled or missing — not an error for our purposes.
    if (err?.code !== "resource_missing") throw err;
  }
}

/** Verify and parse a webhook payload. Throws if the signature is invalid. */
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** Monthly amount in KES for a subscription, derived from its first item. */
export function monthlyAmountKes(subscription: Stripe.Subscription): number {
  const item = subscription.items?.data?.[0];
  const unit = item?.price?.unit_amount ?? 0;
  // Stripe amounts are in the currency's minor unit. KES has 2 decimal places.
  return Math.round(unit / 100);
}
