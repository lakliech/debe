/**
 * Platform billing dashboard — revenue and subscription health across tenants.
 *
 * Mounted under /api/platform. Cross-tenant, requireLevel(0).
 *
 * MRR is derived from the plan catalogue rather than from Stripe invoices:
 * it's the committed recurring value of currently-paying campaigns, which is
 * what the platform owner is actually asking for. Trials contribute 0 to MRR
 * but are surfaced separately as pipeline.
 */

import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, pool, tenantsTable, brandingTable, userRolesTable, emailLogsTable } from "@workspace/db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { PLANS, PLAN_ORDER, getEffectivePlan, isPlanTier, type PlanTier } from "../lib/plans";
import { stripeConfigured, ensureCustomer, createCheckoutSession, expireOpenCheckoutSessions, priceIdFor, platformUrl } from "../lib/stripe";
import { recordPlatformAction } from "../lib/platformAudit";
import { z } from "zod";
import { validate } from "../lib/validate";

const router = Router();

const billingTenantsQuerySchema = z.object({
  filter: z.enum(["all", "paying", "trial", "at-risk", "free"]).default("all"),
  // Leading "-" = descending. Sorted in memory — the list is every tenant on
  // the platform, so the set is small by definition.
  sort: z
    .enum([
      "name", "-name",
      "mrr", "-mrr",
      "agents", "-agents",
      "activity", "-activity",
      "trial", "-trial",
      "created", "-created",
    ])
    .optional(),
});
const billingEmailsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
// A trial extension is measured in days, not months: the cap keeps "extend the
// trial" from quietly becoming an unbounded free plan.
const extendTrialSchema = z.object({
  days: z.coerce.number().int().min(1).max(90),
});

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

/** Statuses that mean revenue is at risk of churning. */
const AT_RISK_STATUSES = new Set(["past_due", "unpaid", "incomplete", "incomplete_expired"]);

/**
 * Nonterminal Stripe subscription states. A subscription in any of these is
 * still owned by Stripe: past_due/unpaid recover through Stripe's retry
 * schedule, incomplete completes when the customer pays. A manual plan grant
 * or a second Checkout session against one of these would be silently
 * overwritten by the next webhook — or double-bill the campaign. Only
 * terminal states (canceled, incomplete_expired, or no subscription at all)
 * are safe to override from the platform side.
 */
const STRIPE_OWNED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function isStripeOwned(status: string | null | undefined): boolean {
  return !!status && STRIPE_OWNED_STATUSES.has(status);
}

interface TenantBillingRow {
  id: string;
  name: string;
  slug: string;
  campaignName: string | null;
  storedPlan: string;
  effectivePlan: PlanTier;
  planLabel: string;
  isTrial: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  billingEmail: string | null;
  mrrKes: number;
  lifecycleState: string;
  isSuspended: boolean;
  userCount: number;
  agentCount: number;
  /** Most recent login by any user with a role in this campaign. */
  lastActivityAt: Date | null;
  createdAt: Date;
  atRisk: boolean;
  riskReason: string | null;
}

/** "Near the Free-tier agent limit" trips at 80% of the cap. */
const FREE_LIMIT_WARNING_RATIO = 0.8;
/** A campaign with no login this long is drifting toward churn. */
const INACTIVE_DAYS = 30;

async function buildRows(): Promise<TenantBillingRow[]> {
  const rows = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      plan: tenantsTable.plan,
      planOverrideUntil: tenantsTable.planOverrideUntil,
      stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus,
      billingEmail: tenantsTable.billingEmail,
      lifecycleState: tenantsTable.lifecycleState,
      isSuspended: tenantsTable.isSuspended,
      createdAt: tenantsTable.createdAt,
      campaignName: brandingTable.campaignName,
      userCount: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)`,
      // Correlated subqueries rather than more joins: joining polling_agents
      // or users here would multiply rows and corrupt the userCount aggregate.
      agentCount: sql<number>`(SELECT CAST(COUNT(*) AS INTEGER) FROM polling_agents pa WHERE pa.tenant_id = ${tenantsTable.id})`,
      lastActivityAt: sql<Date | null>`(SELECT MAX(u.last_login_at) FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.tenant_id = ${tenantsTable.id})`,
    })
    .from(tenantsTable)
    .leftJoin(brandingTable, eq(brandingTable.tenantId, tenantsTable.id))
    .leftJoin(userRolesTable, eq(userRolesTable.tenantId, tenantsTable.id))
    .groupBy(
      tenantsTable.id,
      tenantsTable.name,
      tenantsTable.slug,
      tenantsTable.plan,
      tenantsTable.planOverrideUntil,
      tenantsTable.stripeSubscriptionStatus,
      tenantsTable.billingEmail,
      tenantsTable.lifecycleState,
      tenantsTable.isSuspended,
      tenantsTable.createdAt,
      brandingTable.campaignName,
    )
    .orderBy(desc(tenantsTable.createdAt));

  return rows.map((r) => {
    const effective = getEffectivePlan(r);
    const status = r.stripeSubscriptionStatus;

    // Only actively-paying campaigns count toward MRR.
    const mrrKes =
      effective.hasActiveSubscription && !effective.isTrial
        ? (PLANS[effective.plan].priceMonthlyKes ?? 0)
        : 0;

    const agentCount = Number(r.agentCount ?? 0);
    const lastActivityAt = r.lastActivityAt ? new Date(r.lastActivityAt) : null;

    let riskReason: string | null = null;
    if (status && AT_RISK_STATUSES.has(status)) {
      riskReason = `Payment ${status.replace(/_/g, " ")}`;
    } else if (effective.isTrial && (effective.trialDaysLeft ?? 99) <= 3) {
      riskReason = `Trial ends in ${effective.trialDaysLeft} day${effective.trialDaysLeft === 1 ? "" : "s"}`;
    } else if (r.lifecycleState === "deletion_scheduled") {
      riskReason = "Deletion scheduled";
    } else if (r.isSuspended) {
      riskReason = "Suspended";
    } else if (
      // Silent campaigns churn. Only flag tenants old enough to have had a
      // fair chance — a campaign created yesterday hasn't had 30 days to log in.
      new Date(r.createdAt).getTime() < Date.now() - INACTIVE_DAYS * 86_400_000 &&
      (!lastActivityAt || lastActivityAt.getTime() < Date.now() - INACTIVE_DAYS * 86_400_000)
    ) {
      riskReason = `No user logins in ${INACTIVE_DAYS} days`;
    } else if (
      // A Free campaign pressing against its agent cap is the warmest upsell
      // lead the platform has — surface it before the limit blocks them.
      effective.plan === "free" &&
      PLANS.free.maxAgents != null &&
      agentCount >= PLANS.free.maxAgents * FREE_LIMIT_WARNING_RATIO
    ) {
      riskReason = `Near Free agent limit (${agentCount}/${PLANS.free.maxAgents})`;
    }

    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      campaignName: r.campaignName ?? null,
      storedPlan: r.plan,
      effectivePlan: effective.plan,
      planLabel: PLANS[effective.plan].label,
      isTrial: effective.isTrial,
      trialDaysLeft: effective.trialDaysLeft,
      trialEndsAt: effective.trialEndsAt,
      subscriptionStatus: status,
      billingEmail: r.billingEmail,
      mrrKes,
      lifecycleState: r.lifecycleState,
      isSuspended: r.isSuspended,
      userCount: Number(r.userCount ?? 0),
      agentCount,
      lastActivityAt,
      createdAt: r.createdAt,
      atRisk: riskReason !== null,
      riskReason,
    };
  });
}

const SORT_COMPARATORS: Record<string, (a: TenantBillingRow, b: TenantBillingRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  mrr: (a, b) => a.mrrKes - b.mrrKes,
  agents: (a, b) => a.agentCount - b.agentCount,
  // Never-active campaigns sort oldest-first so they surface at the top.
  activity: (a, b) =>
    (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0),
  trial: (a, b) => (a.trialDaysLeft ?? 9999) - (b.trialDaysLeft ?? 9999),
  created: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
};

function sortRows(rows: TenantBillingRow[], sort: string | undefined): TenantBillingRow[] {
  if (!sort) return rows;
  const descending = sort.startsWith("-");
  const cmp = SORT_COMPARATORS[descending ? sort.slice(1) : sort];
  if (!cmp) return rows;
  return [...rows].sort((a, b) => (descending ? cmp(b, a) : cmp(a, b)));
}

// ── GET /api/platform/billing/summary ────────────────────────────────────────
router.get("/billing/summary", requireAuth, requireLevel(0), async (_req: any, res: any) => {
  try {
    const rows = await buildRows();

    const mrrKes = rows.reduce((sum, r) => sum + r.mrrKes, 0);
    const paying = rows.filter((r) => r.mrrKes > 0);
    const trials = rows.filter((r) => r.isTrial);
    const atRisk = rows.filter((r) => r.atRisk);

    // Plan mix by effective tier, with the MRR each tier contributes — the
    // chart needs both, because "most campaigns" and "most revenue" are
    // usually different tiers.
    const byPlan: Record<string, number> = { free: 0, pro: 0, enterprise: 0 };
    for (const r of rows) byPlan[r.effectivePlan] = (byPlan[r.effectivePlan] ?? 0) + 1;
    const planDistribution = PLAN_ORDER.map((tier) => ({
      tier,
      label: PLANS[tier].label,
      count: byPlan[tier] ?? 0,
      mrrKes: rows
        .filter((r) => r.effectivePlan === tier)
        .reduce((sum, r) => sum + r.mrrKes, 0),
    }));

    // Pipeline: what trials would be worth if they all converted at their tier.
    const trialPipelineKes = trials.reduce((sum, r) => {
      const tier = isPlanTier(r.storedPlan) ? r.storedPlan : "free";
      return sum + (PLANS[tier].priceMonthlyKes ?? 0);
    }, 0);

    // Monthly growth: signups in the last 30 days against the 30 before that.
    // Creation date is the only acquisition timestamp we store, so this is a
    // campaigns-growth signal, not a revenue-recognition one.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
    const newThisMonth = rows.filter((r) => new Date(r.createdAt) >= thirtyDaysAgo).length;
    const newPriorMonth = rows.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= sixtyDaysAgo.getTime() && t < thirtyDaysAgo.getTime();
    }).length;
    const growthPct =
      newPriorMonth === 0
        ? (newThisMonth > 0 ? 100 : 0)
        : Math.round(((newThisMonth - newPriorMonth) / newPriorMonth) * 100);

    res.json({
      billingEnabled: stripeConfigured(),
      mrrKes,
      arrKes: mrrKes * 12,
      totalCampaigns: rows.length,
      payingCampaigns: paying.length,
      trialCampaigns: trials.length,
      trialPipelineKes,
      atRiskCampaigns: atRisk.length,
      atRiskMrrKes: atRisk.reduce((sum, r) => sum + r.mrrKes, 0),
      newCampaignsLast30Days: newThisMonth,
      growthPct,
      averageRevenuePerPayingKes: paying.length ? Math.round(mrrKes / paying.length) : 0,
      // Conversion of ended trials → paying, as a rough funnel signal.
      byPlan,
      planDistribution,
      atRisk: atRisk.slice(0, 20),
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── GET /api/platform/billing/tenants ────────────────────────────────────────
// Full per-campaign billing table.
router.get("/billing/tenants", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const rows = await buildRows();
    const q = validate(billingTenantsQuerySchema, req.query, res);
    if (!q) return;
    const filter = q.filter;

    const filtered =
      filter === "paying"
        ? rows.filter((r) => r.mrrKes > 0)
        : filter === "trial"
          ? rows.filter((r) => r.isTrial)
          : filter === "at-risk"
            ? rows.filter((r) => r.atRisk)
            : filter === "free"
              ? rows.filter((r) => r.effectivePlan === "free")
              : rows;

    const sorted = sortRows(filtered, q.sort);
    res.json({ tenants: sorted, total: sorted.length });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── GET /api/platform/billing/emails ─────────────────────────────────────────
// Recent transactional email attempts — lets the owner confirm lifecycle mail
// is actually going out without opening the provider dashboard.
router.get("/billing/emails", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const q = validate(billingEmailsQuerySchema, req.query, res);
    if (!q) return;
    const limit = q.limit;
    const rows = await db
      .select({
        id: emailLogsTable.id,
        tenantId: emailLogsTable.tenantId,
        tenantName: tenantsTable.name,
        recipient: emailLogsTable.recipient,
        template: emailLogsTable.template,
        subject: emailLogsTable.subject,
        status: emailLogsTable.status,
        error: emailLogsTable.error,
        sentAt: emailLogsTable.sentAt,
      })
      .from(emailLogsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, emailLogsTable.tenantId))
      .orderBy(desc(emailLogsTable.sentAt))
      .limit(limit);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const [counts] = (await db
      .select({
        sent: sql<number>`CAST(COUNT(*) FILTER (WHERE ${emailLogsTable.status} = 'sent') AS INTEGER)`,
        failed: sql<number>`CAST(COUNT(*) FILTER (WHERE ${emailLogsTable.status} = 'failed') AS INTEGER)`,
        skipped: sql<number>`CAST(COUNT(*) FILTER (WHERE ${emailLogsTable.status} = 'skipped') AS INTEGER)`,
      })
      .from(emailLogsTable)
      .where(gte(emailLogsTable.sentAt, sevenDaysAgo))) as Array<{
      sent: number;
      failed: number;
      skipped: number;
    }>;

    res.json({ emails: rows, last7Days: counts ?? { sent: 0, failed: 0, skipped: 0 } });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── PATCH /api/platform/tenants/:id/plan ─────────────────────────────────────
// Manual plan grant — for enterprise deals closed offline, or comping a campaign.
router.patch("/tenants/:id/plan", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { plan, months } = req.body as { plan?: string; months?: number };

    if (!isPlanTier(plan)) {
      return res.status(400).json({ error: "plan must be 'free', 'pro' or 'enterprise'" });
    }

    // A live Stripe subscription owns the plan state via webhooks — a manual
    // grant underneath it would drift (webhook events would silently undo it).
    const [existing] = await db
      .select({ stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (isStripeOwned(existing.stripeSubscriptionStatus)) {
      return res.status(409).json({
        error:
          `This campaign has a live Stripe subscription (${existing.stripeSubscriptionStatus}). ` +
          `Resolve or cancel it via the Stripe customer portal before granting a plan manually — ` +
          `a grant underneath it would be overwritten by the next webhook.`,
      });
    }

    const patch: Record<string, unknown> = { plan };

    if (plan === "free") {
      patch.planOverrideUntil = null;
    } else {
      // A manual grant is expressed as an override so it expires predictably
      // and never silently outlives the deal it was granted for.
      const m = typeof months === "number" && months > 0 && months <= 60 ? months : 12;
      patch.planOverrideUntil = new Date(Date.now() + m * 30 * 86_400_000);
    }

    // The plan change and its audit record commit in one transaction.
    let updated: any;
    await db.transaction(async (tx) => {
      [updated] = await tx
        .update(tenantsTable)
        .set(patch)
        .where(eq(tenantsTable.id, id))
        .returning();

      if (!updated) return; // nothing written — falls through to the 404

      await recordPlatformAction(
        req,
        {
          action: "platform.tenant.plan-change",
          resource: "tenant",
          tenantId: id,
          resourceId: id,
          details: {
            slug: updated.slug,
            name: updated.name,
            plan,
            planOverrideUntil: patch.planOverrideUntil
              ? (patch.planOverrideUntil as Date).toISOString()
              : null,
          },
        },
        tx,
      );
    });

    if (!updated) return res.status(404).json({ error: "Campaign not found" });

    res.json({
      tenant: updated,
      message:
        plan === "free"
          ? "Campaign moved to the Free plan."
          : `Granted ${PLANS[plan].label} until ${new Date(patch.planOverrideUntil as Date).toLocaleDateString("en-KE")}.`,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /api/platform/tenants/:id/checkout-link ─────────────────────────────
// Generate a Stripe Checkout link on a campaign's behalf: sales confirms the
// billing email, sends the link, and the campaign completes payment itself.
// The webhook activates the subscription exactly like self-serve checkout.
const checkoutLinkSchema = z.object({ tier: z.enum(["pro", "enterprise"]) });

router.post("/tenants/:id/checkout-link", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    if (!stripeConfigured()) {
      return res.status(503).json({ error: "Online payments are not configured on this platform." });
    }
    const parsed = validate(checkoutLinkSchema, req.body, res);
    if (!parsed) return;

    const priceId = priceIdFor(parsed.tier);
    if (!priceId) {
      return res.status(503).json({ error: `The ${PLANS[parsed.tier].label} plan has no Stripe price configured yet.` });
    }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.params.id)).limit(1);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    if (isStripeOwned(tenant.stripeSubscriptionStatus)) {
      return res.status(409).json({
        error:
          `This campaign already has a live Stripe subscription (${tenant.stripeSubscriptionStatus}). ` +
          `Past-due and incomplete subscriptions can still recover — resolve them in Stripe instead of opening a second checkout.`,
      });
    }
    // Stripe requires a customer email for the receipt; we can't guess it
    // platform-side the way self-serve checkout falls back to the signed-in
    // admin, because the person paying is the campaign, not the operator.
    if (!tenant.billingEmail) {
      return res.status(400).json({ error: "This campaign has no billing email on file. Ask them to set one under Settings → Plan & Billing, then retry." });
    }

    // Serialize the WHOLE customer+session sequence per campaign, not just
    // expire+create. Two concurrent first-time requests (no stripeCustomerId
    // yet) would otherwise each create a DIFFERENT Stripe customer and
    // overwrite each other's id; the loser can then neither see nor expire
    // the winner's still-open session — both links stay payable and the
    // campaign double-subscribes. The lock must come before ensureCustomer.
    const lockKey = tenant.id;
    const lockClient = await pool.connect();
    try {
      const { rows: lockRows } = await lockClient.query<{ got: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1), 7177) AS got",
        [`checkout-link:${lockKey}`],
      );
      if (!lockRows[0]?.got) {
        return res.status(409).json({ error: "A payment link is already being generated for this campaign. Try again in a moment." });
      }

      // Reload under the lock: the request that held it just before us may
      // have written stripeCustomerId, and a webhook may have flipped the
      // subscription status while we waited — decide on the fresh row, never
      // the pre-lock snapshot.
      const [locked] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenant.id)).limit(1);
      if (!locked) return res.status(404).json({ error: "Campaign not found" });
      if (isStripeOwned(locked.stripeSubscriptionStatus)) {
        return res.status(409).json({
          error:
            `This campaign already has a live Stripe subscription (${locked.stripeSubscriptionStatus}). ` +
            `Past-due and incomplete subscriptions can still recover — resolve them in Stripe instead of opening a second checkout.`,
        });
      }
      if (!locked.billingEmail) {
        return res.status(400).json({ error: "This campaign has no billing email on file. Ask them to set one under Settings → Plan & Billing, then retry." });
      }

      // Preserve remaining trial days in the checkout window — same courtesy as
      // self-serve upgrades, so an early payer isn't penalised.
      const effective = getEffectivePlan(locked);
      const customerId = await ensureCustomer({
        tenantId: locked.id,
        tenantName: locked.name,
        tenantSlug: locked.slug,
        email: locked.billingEmail,
        existingCustomerId: locked.stripeCustomerId,
        trialEndsAt: effective.isTrial ? effective.trialEndsAt : null,
      });
      if (customerId !== locked.stripeCustomerId) {
        await db.update(tenantsTable).set({ stripeCustomerId: customerId }).where(eq(tenantsTable.id, locked.id));
      }

      // One payable link at a time: an earlier link stays open until Stripe
      // expires it, and a payer completing BOTH would double-subscribe the
      // customer. Expire any open sessions for this customer before issuing
      // the replacement.
      const expiredCount = await expireOpenCheckoutSessions(customerId);

      const base = platformUrl();
      const session = await createCheckoutSession({
        customerId,
        priceId,
        tenantId: locked.id,
        trialDaysRemaining: effective.isTrial ? effective.trialDaysLeft : null,
        // The payer is the campaign, not a signed-in operator. Tenant portals
        // are domain-based (no /:slug path route), so land on the public app
        // root — HomeRedirect takes signed-in users to their dashboard and
        // everyone else to the marketing home. Never a 404.
        successUrl: `${base}/?checkout=success`,
        cancelUrl: `${base}/?checkout=cancelled`,
        // Explicit 24 h expiry so "the link dies tomorrow" is a contract,
        // not a Stripe default.
        expiresAt: Math.floor(Date.now() / 1000) + 86_400,
      });

      await recordPlatformAction(req, {
        action: "platform.tenant.checkout-link",
        resource: "tenant",
        tenantId: locked.id,
        resourceId: locked.id,
        details: {
          slug: locked.slug,
          name: locked.name,
          tier: parsed.tier,
          sessionId: session.id,
          expiredPrevious: expiredCount,
        },
      });

      return res.json({ url: session.url, tier: parsed.tier, planLabel: PLANS[parsed.tier].label, expiresAt: new Date((Math.floor(Date.now() / 1000) + 86_400) * 1000).toISOString() });
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext($1), 7177)", [`checkout-link:${lockKey}`]).catch(() => {});
      lockClient.release();
    }
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── PATCH /api/platform/tenants/:id/trial ────────────────────────────────────
// Extend a Pro trial. Sales asks for this constantly ("they lost a week to the
// IEBC roll") and the alternative — granting a plan by the month — overshoots
// by weeks and reads as a comp rather than a trial in every billing view.
router.patch("/tenants/:id/trial", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const body = validate(extendTrialSchema, req.body, res);
    if (!body) return;

    const [tenant] = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        plan: tenantsTable.plan,
        planOverrideUntil: tenantsTable.planOverrideUntil,
        stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id))
      .limit(1);

    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const effective = getEffectivePlan(tenant);

    // A paying campaign's access comes from Stripe, not from the override, so
    // writing a new expiry here would change nothing while looking like it had.
    // Refuse loudly instead of silently no-opping.
    if (effective.hasActiveSubscription) {
      return res.status(409).json({
        error:
          `This campaign has a Stripe subscription (${tenant.stripeSubscriptionStatus}). ` +
          `Its access is governed by Stripe, not by a trial — change the subscription there instead.`,
      });
    }

    // Extend from whichever is later: an unexpired trial keeps the days it has
    // left (extending from "now" would quietly shorten it), while a trial that
    // already lapsed restarts from today.
    const now = Date.now();
    const currentEnd = tenant.planOverrideUntil
      ? new Date(tenant.planOverrideUntil).getTime()
      : 0;
    const base = currentEnd > now ? currentEnd : now;
    const trialEndsAt = new Date(base + body.days * 86_400_000);

    // A campaign whose trial already expired was downgraded to Free by the
    // cron, so extending has to put the trial tier back — an override alone
    // would just extend Free.
    const plan: PlanTier = isPlanTier(tenant.plan) && tenant.plan !== "free" ? tenant.plan : "pro";

    let updated: any;
    await db.transaction(async (tx) => {
      [updated] = await tx
        .update(tenantsTable)
        .set({ plan, planOverrideUntil: trialEndsAt, trialUsed: true })
        .where(eq(tenantsTable.id, id))
        .returning();

      if (!updated) return; // nothing written — falls through to the 404

      await recordPlatformAction(
        req,
        {
          action: "platform.tenant.trial-extend",
          resource: "tenant",
          tenantId: id,
          resourceId: id,
          details: {
            slug: updated.slug,
            name: updated.name,
            days: body.days,
            plan,
            previousTrialEndsAt: tenant.planOverrideUntil
              ? new Date(tenant.planOverrideUntil).toISOString()
              : null,
            trialEndsAt: trialEndsAt.toISOString(),
          },
        },
        tx,
      );
    });

    if (!updated) return res.status(404).json({ error: "Campaign not found" });

    res.json({
      tenant: updated,
      trialEndsAt: trialEndsAt.toISOString(),
      message: `Trial extended by ${body.days} day${body.days === 1 ? "" : "s"} — ${PLANS[plan].label} now runs until ${trialEndsAt.toLocaleDateString("en-KE")}.`,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
