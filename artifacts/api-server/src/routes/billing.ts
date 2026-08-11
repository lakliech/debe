/**
 * Billing routes — Stripe subscriptions for campaign tenants.
 *
 * Mounted at /api/billing behind resolveTenant (see routes/index.ts).
 *
 * IMPORTANT: the Stripe webhook is NOT part of this router. It needs the raw
 * request body for signature verification, which the global express.json()
 * parser destroys, so it is exported separately as `stripeWebhookHandler` and
 * mounted in app.ts BEFORE the JSON parser.
 */

import { Router } from "express";
import { sendRouteError } from "../lib/routeError";
import { getAuth } from "@clerk/express";
import { db, tenantsTable, brandingTable, processedWebhookEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { logger } from "../lib/logger";
import { sendEmailAsync } from "../lib/email";
import {
  PLANS,
  getEffectivePlan,
  isPlanTier,
  publicPlanCatalogue,
  PAST_DUE_GRACE_DAYS,
  type PlanTier,
} from "../lib/plans";
import { countAgents, countStations } from "../middlewares/requirePlan";
import {
  stripeConfigured,
  ensureCustomer,
  createCheckoutSession,
  createPortalSession,
  priceIdFor,
  platformUrl,
} from "../lib/stripe";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

function assertTenant(req: any, res: any): string | null {
  const id = req.tenant?.id;
  if (!id) {
    res.status(400).json({ error: "No campaign context for this request." });
    return null;
  }
  return id;
}

// ── GET /api/billing/plans ───────────────────────────────────────────────────
// Public plan catalogue — drives the pricing page. No auth required.
router.get("/plans", (_req: any, res: any) => {
  res.json({ plans: publicPlanCatalogue(), billingEnabled: stripeConfigured() });
});

// ── GET /api/billing/subscription ────────────────────────────────────────────
// Current plan state for the active campaign.
router.get("/subscription", requireAuth, async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const effective = getEffectivePlan(tenant);

    res.json({
      plan: effective.plan,
      storedPlan: effective.storedPlan,
      planLabel: PLANS[effective.plan].label,
      isTrial: effective.isTrial,
      trialDaysLeft: effective.trialDaysLeft,
      trialEndsAt: effective.trialEndsAt,
      trialUsed: tenant.trialUsed,
      subscriptionStatus: tenant.stripeSubscriptionStatus,
      hasActiveSubscription: effective.hasActiveSubscription,
      billingEmail: tenant.billingEmail,
      billingEnabled: stripeConfigured(),
      limits: {
        maxAgents: PLANS[effective.plan].maxAgents,
        maxStations: PLANS[effective.plan].maxStations,
      },
      catalogue: publicPlanCatalogue(),
    });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── GET /api/billing/usage ───────────────────────────────────────────────────
// Metered usage against the plan's caps. Any signed-in campaign member may
// read it: the command centre shows the upgrade banner to whoever is looking,
// and hiding the reason a create is about to fail helps nobody.
router.get("/usage", requireAuth, async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const [tenant] = await db
      .select({
        plan: tenantsTable.plan,
        planOverrideUntil: tenantsTable.planOverrideUntil,
        stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const effective = getEffectivePlan(tenant);
    const limits = PLANS[effective.plan];
    const [agents, stations] = await Promise.all([
      countAgents(tenantId),
      countStations(tenantId),
    ]);

    res.json({
      plan: effective.plan,
      planLabel: limits.label,
      isTrial: effective.isTrial,
      agents,
      stations,
      maxAgents: limits.maxAgents,
      maxStations: limits.maxStations,
    });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── POST /api/billing/checkout ───────────────────────────────────────────────
// Start a Stripe Checkout session to subscribe to a paid tier.
// Campaign admins only (level 1).
router.post("/checkout", requireAuth, requireLevel(1), async (req: any, res: any) => {
  try {
    if (!stripeConfigured()) {
      return res.status(503).json({
        error: "Online payments are not configured for this platform. Contact support to upgrade.",
      });
    }

    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const { tier, billingEmail } = req.body as { tier?: string; billingEmail?: string };
    if (!isPlanTier(tier) || tier === "free") {
      return res.status(400).json({ error: "tier must be 'pro' or 'enterprise'" });
    }

    const priceId = priceIdFor(tier as PlanTier);
    if (!priceId) {
      return res.status(503).json({
        error: `The ${PLANS[tier].label} plan is not available for self-serve purchase. Contact support.`,
      });
    }

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const email = billingEmail || tenant.billingEmail;
    if (!email) {
      return res.status(400).json({ error: "billingEmail is required" });
    }

    const customerId = await ensureCustomer({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      email,
      existingCustomerId: tenant.stripeCustomerId,
    });

    // Persist the customer id and billing email so we don't recreate them.
    if (customerId !== tenant.stripeCustomerId || email !== tenant.billingEmail) {
      await db
        .update(tenantsTable)
        .set({ stripeCustomerId: customerId, billingEmail: email })
        .where(eq(tenantsTable.id, tenant.id));
    }

    // Honour any trial time still remaining so upgrading early isn't penalised.
    const effective = getEffectivePlan(tenant);
    const trialDaysRemaining = effective.isTrial ? effective.trialDaysLeft : null;

    const url = await createCheckoutSession({
      customerId,
      priceId,
      tenantId: tenant.id,
      trialDaysRemaining,
    });

    res.json({ url });
  } catch (err: any) {
    logger.error({ err }, "[billing] checkout failed");
    sendRouteError(res, err);
  }
});

// ── POST /api/billing/portal ─────────────────────────────────────────────────
// Open the Stripe Billing Portal to manage payment method / cancel.
router.post("/portal", requireAuth, requireLevel(1), async (req: any, res: any) => {
  try {
    if (!stripeConfigured()) {
      return res.status(503).json({ error: "Billing is not configured for this platform." });
    }

    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const [tenant] = await db
      .select({ stripeCustomerId: tenantsTable.stripeCustomerId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant?.stripeCustomerId) {
      return res.status(400).json({
        error: "This campaign has no billing account yet. Subscribe to a paid plan first.",
      });
    }

    const url = await createPortalSession(tenant.stripeCustomerId);
    res.json({ url });
  } catch (err: any) {
    logger.error({ err }, "[billing] portal failed");
    sendRouteError(res, err);
  }
});

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — mounted separately in app.ts with express.raw()
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a tenant from webhook object metadata, falling back to customer id. */
async function tenantFromEvent(
  metadataTenantId: string | undefined | null,
  customerId: string | undefined | null,
) {
  if (metadataTenantId) {
    const [t] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, metadataTenantId))
      .limit(1);
    if (t) return t;
  }
  if (customerId) {
    const [t] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.stripeCustomerId, customerId))
      .limit(1);
    if (t) return t;
  }
  return null;
}

async function campaignDisplayName(tenantId: string, fallback: string): Promise<string> {
  const [b] = await db
    .select({ campaignName: brandingTable.campaignName })
    .from(brandingTable)
    .where(eq(brandingTable.tenantId, tenantId))
    .limit(1);
  return b?.campaignName || fallback;
}

/**
 * Stripe webhook handler.
 *
 * Requires `req.body` to be the raw Buffer — mount with express.raw({ type: "application/json" }).
 *
 * Handled events:
 *   checkout.session.completed      → link subscription, activate plan
 *   customer.subscription.updated   → sync tier + status
 *   customer.subscription.deleted   → downgrade to free
 *   invoice.paid                    → receipt email
 *   invoice.payment_failed          → dunning email + grace period
 */
export async function stripeWebhookHandler(req: any, res: any) {
  if (!stripeConfigured()) return res.status(503).send("Billing not configured");

  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).send("Missing stripe-signature header");

  // Imported lazily so the module stays loadable without Stripe configured.
  const { constructWebhookEvent, tierForPriceId } = await import("../lib/stripe");

  let event: any;
  try {
    event = constructWebhookEvent(req.body, signature as string);
  } catch (err: any) {
    logger.warn({ err: err.message }, "[billing] webhook signature verification failed");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ── Idempotency claim ──────────────────────────────────────────────────────
  // Stripe retries on any non-2xx and can redeliver an event even on success.
  // Without a claim, a retried invoice.paid re-sends the receipt and a retried
  // subscription update re-applies state. The primary key is the claim: if the
  // insert conflicts, another delivery already handled this event.
  const claimed = await db
    .insert(processedWebhookEventsTable)
    .values({ eventId: event.id, provider: "stripe", eventType: event.type })
    .onConflictDoNothing()
    .returning({ eventId: processedWebhookEventsTable.eventId });

  if (claimed.length === 0) {
    logger.info({ eventId: event.id, type: event.type }, "[billing] duplicate webhook ignored");
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const tenant = await tenantFromEvent(
          session.metadata?.tenant_id ?? session.client_reference_id,
          typeof session.customer === "string" ? session.customer : session.customer?.id,
        );
        if (!tenant) break;

        // The session itself doesn't carry the price; the subscription does.
        // customer.subscription.updated fires right after and sets the tier,
        // so here we only record the linkage.
        await db
          .update(tenantsTable)
          .set({
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id,
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : session.customer?.id,
            billingEmail: session.customer_details?.email ?? tenant.billingEmail,
          })
          .where(eq(tenantsTable.id, tenant.id));

        logger.info({ tenantId: tenant.id }, "[billing] checkout completed");
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const tenant = await tenantFromEvent(
          sub.metadata?.tenant_id,
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
        );
        if (!tenant) break;

        const priceId = sub.items?.data?.[0]?.price?.id;
        const tier = tierForPriceId(priceId);
        const status: string = sub.status;

        // While the subscription is healthy the paid tier applies. When it goes
        // past_due we keep access for a grace window via planOverrideUntil
        // rather than cutting the campaign off mid-election.
        const patch: Record<string, unknown> = {
          stripeSubscriptionId: sub.id,
          stripeSubscriptionStatus: status,
        };
        if (tier) patch.plan = tier;

        if (status === "past_due" || status === "unpaid") {
          const grace = new Date(Date.now() + PAST_DUE_GRACE_DAYS * 86_400_000);
          patch.planOverrideUntil = grace;
        } else if (status === "active") {
          // Paid and current — the subscription itself grants access, so the
          // trial override is no longer needed.
          patch.planOverrideUntil = null;
        }

        await db.update(tenantsTable).set(patch).where(eq(tenantsTable.id, tenant.id));
        logger.info({ tenantId: tenant.id, status, tier }, "[billing] subscription synced");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenant = await tenantFromEvent(
          sub.metadata?.tenant_id,
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
        );
        if (!tenant) break;

        await db
          .update(tenantsTable)
          .set({
            plan: "free",
            stripeSubscriptionStatus: "canceled",
            stripeSubscriptionId: null,
            planOverrideUntil: null,
          })
          .where(eq(tenantsTable.id, tenant.id));

        logger.info({ tenantId: tenant.id }, "[billing] subscription cancelled → free");
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const tenant = await tenantFromEvent(
          invoice.subscription_details?.metadata?.tenant_id,
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id,
        );
        if (!tenant) break;

        const to = invoice.customer_email || tenant.billingEmail;
        if (to && invoice.amount_paid > 0) {
          const name = await campaignDisplayName(tenant.id, tenant.name);
          sendEmailAsync({
            to,
            tenantId: tenant.id,
            template: "payment_receipt",
            data: {
              campaignName: name,
              planLabel: PLANS[isPlanTier(tenant.plan) ? tenant.plan : "free"].label,
              amountKes: Math.round(invoice.amount_paid / 100),
              invoiceUrl: invoice.hosted_invoice_url ?? undefined,
              periodEnd: invoice.period_end
                ? new Date(invoice.period_end * 1000).toLocaleDateString("en-KE", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : undefined,
            },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const tenant = await tenantFromEvent(
          invoice.subscription_details?.metadata?.tenant_id,
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id,
        );
        if (!tenant) break;

        const to = invoice.customer_email || tenant.billingEmail;
        if (to) {
          const name = await campaignDisplayName(tenant.id, tenant.name);
          sendEmailAsync({
            to,
            tenantId: tenant.id,
            template: "payment_failed",
            data: {
              campaignName: name,
              billingPortalUrl: `${platformUrl()}/settings?tab=plan`,
              graceDays: PAST_DUE_GRACE_DAYS,
            },
          });
        }
        logger.warn({ tenantId: tenant.id }, "[billing] payment failed");
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err: any) {
    logger.error({ err, type: event?.type }, "[billing] webhook handler failed");
    // Release the claim, otherwise the retry we are about to ask for would be
    // rejected as a duplicate and the event would never be processed.
    await db
      .delete(processedWebhookEventsTable)
      .where(eq(processedWebhookEventsTable.eventId, event.id))
      .catch(() => {});
    // 500 tells Stripe to retry — appropriate for transient DB failures.
    return res.status(500).send("Webhook handler failed");
  }

  res.json({ received: true });
}
