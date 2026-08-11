/**
 * Stripe billing integration.
 *
 * Credential resolution (in priority order):
 *   1. Replit Stripe connector  — used in the Replit workspace and deployments.
 *      Credentials are fetched at runtime from the connector API so rotated
 *      keys are always picked up without a redeploy.
 *   2. Environment variables     — for self-hosted / CI environments without
 *      the Replit connector:
 *        STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *        STRIPE_WEBHOOK_SECRET        whsec_… (from the webhook endpoint config)
 *
 * Price IDs must always be supplied via env vars (the connector doesn't carry them):
 *   STRIPE_PRO_PRICE_ID          price_…  monthly Pro price
 *   STRIPE_ENTERPRISE_PRICE_ID   price_…  monthly Enterprise price (optional)
 *   PLATFORM_URL                 used to build success/cancel/return URLs
 *
 * Billing is optional infrastructure: when neither the connector nor env vars
 * are present the module reports itself unconfigured and routes return 503
 * rather than crashing the server.
 */

import Stripe from "stripe";
import type { PlanTier } from "./plans";

// ── Credential resolution ─────────────────────────────────────────────────────

interface StripeCredentials {
  secretKey: string;
  webhookSecret?: string;
}

/**
 * Fetch Stripe credentials from the Replit connector API, falling back to
 * environment variables for self-hosted deployments.
 *
 * Not cached — tokens can rotate, so each call fetches a fresh copy.
 * The Stripe client itself is cached separately after the first successful
 * credential fetch.
 */
async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (hostname && token) {
    try {
      const resp = await fetch(
        `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
        {
          headers: { Accept: "application/json", X_REPLIT_TOKEN: token },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const settings = data.items?.[0]?.settings;
        if (settings?.secret_key) {
          return {
            secretKey: settings.secret_key,
            webhookSecret: settings.webhook_secret ?? undefined,
          };
        }
      }
    } catch {
      // Connector unavailable — fall through to env var fallback.
    }
  }

  // Env var fallback (self-hosted / CI).
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey) {
    return { secretKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
  }

  throw new Error(
    "Stripe is not configured. Connect via the Replit Stripe integration or set STRIPE_SECRET_KEY.",
  );
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Whether billing is available.
 *
 * Returns true when the Replit connector is present OR when STRIPE_SECRET_KEY
 * is set in the environment. A false result means the billing routes should
 * return 503 rather than attempting Stripe API calls.
 */
export function stripeConfigured(): boolean {
  return !!(
    process.env.REPLIT_CONNECTORS_HOSTNAME || process.env.STRIPE_SECRET_KEY
  );
}

/**
 * Return an authenticated Stripe client.
 *
 * Credentials are fetched fresh on the first call. The client instance is
 * cached for subsequent calls within the same process lifetime — this is safe
 * because the Stripe SDK uses the key at construction time, and the connector
 * provides short-lived tokens that remain valid for the process lifetime.
 */
let _client: Stripe | null = null;

export async function getStripe(): Promise<Stripe> {
  if (_client) return _client;
  const { secretKey } = await getStripeCredentials();
  _client = new Stripe(secretKey, {
    // Pin so a Stripe-side default bump can't change response shapes.
    apiVersion: "2025-10-29.clover" as Stripe.LatestApiVersion,
    typescript: true,
  });
  return _client;
}

/** Reset cached client (useful in tests). */
export function _resetStripeClient() {
  _client = null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

export function platformUrl(): string {
  return (process.env.PLATFORM_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

// ── Price / tier mapping ──────────────────────────────────────────────────────

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

// ── Customer management ───────────────────────────────────────────────────────

export interface EnsureCustomerArgs {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  existingCustomerId?: string | null;
  /** Trial expiry at the moment the customer is created, when one is running. */
  trialEndsAt?: Date | null;
}

/**
 * Return an existing Stripe customer id, or create one for this tenant.
 * The tenant id is stored in customer metadata so webhooks can map back
 * without a database lookup on the customer email.
 *
 * A customer created while the campaign is still on its platform trial is
 * tagged as such: in the Stripe dashboard a trial conversion and a cold
 * signup otherwise look identical, and that difference is the whole question
 * anyone asks of this data.
 */
export async function ensureCustomer(args: EnsureCustomerArgs): Promise<string> {
  const stripe = await getStripe();

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
      ...(args.trialEndsAt
        ? {
            signup_state: "trialing",
            trial_ends_at: args.trialEndsAt.toISOString(),
          }
        : {}),
    },
  });
  return customer.id;
}

// ── Checkout / portal ─────────────────────────────────────────────────────────

export interface CheckoutArgs {
  customerId: string;
  priceId: string;
  tenantId: string;
  /** Remaining trial days to honour, so upgrading mid-trial isn't charged early. */
  trialDaysRemaining?: number | null;
}

/** Create a Checkout session and return its hosted URL. */
export async function createCheckoutSession(args: CheckoutArgs): Promise<string> {
  const stripe = await getStripe();
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
  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${platformUrl()}/settings?tab=plan`,
  });
  return session.url;
}

/** Cancel a subscription immediately — used when a tenant is purged. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = await getStripe();
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err: any) {
    // Already cancelled or missing — not an error for our purposes.
    if (err?.code !== "resource_missing") throw err;
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────────

/**
 * Verify and parse a webhook payload.
 *
 * The webhook secret is fetched from the Replit connector when available, with
 * a fallback to the STRIPE_WEBHOOK_SECRET environment variable. Throws when the
 * signature is invalid or the secret is not configured.
 */
export async function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
): Promise<Stripe.Event> {
  let webhookSecret: string | undefined;

  try {
    const creds = await getStripeCredentials();
    webhookSecret = creds.webhookSecret;
  } catch {
    // getStripeCredentials throws when completely unconfigured; let the guard
    // below produce the clearer "not set" error message.
  }

  // Fallback: explicit env var always wins if set, handles cases where the
  // connector provides the secret key but a separate webhook endpoint uses a
  // different signing secret.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  if (!webhookSecret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Configure it in the Stripe dashboard or set the env var.",
    );
  }

  const stripe = await getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Monthly amount in KES for a subscription, derived from its first item. */
export function monthlyAmountKes(subscription: Stripe.Subscription): number {
  const item = subscription.items?.data?.[0];
  const unit = item?.price?.unit_amount ?? 0;
  // Stripe amounts are in the currency's minor unit. KES has 2 decimal places.
  return Math.round(unit / 100);
}
