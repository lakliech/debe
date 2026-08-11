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
import { db, tenantsTable, brandingTable, userRolesTable, emailLogsTable } from "@workspace/db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { PLANS, getEffectivePlan, isPlanTier, type PlanTier } from "../lib/plans";
import { stripeConfigured } from "../lib/stripe";
import { recordPlatformAction } from "../lib/platformAudit";
import { z } from "zod";
import { validate } from "../lib/validate";

const router = Router();

const billingTenantsQuerySchema = z.object({
  filter: z.enum(["all", "paying", "trial", "at-risk", "free"]).default("all"),
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
  createdAt: Date;
  atRisk: boolean;
  riskReason: string | null;
}

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

    let riskReason: string | null = null;
    if (status && AT_RISK_STATUSES.has(status)) {
      riskReason = `Payment ${status.replace(/_/g, " ")}`;
    } else if (effective.isTrial && (effective.trialDaysLeft ?? 99) <= 3) {
      riskReason = `Trial ends in ${effective.trialDaysLeft} day${effective.trialDaysLeft === 1 ? "" : "s"}`;
    } else if (r.lifecycleState === "deletion_scheduled") {
      riskReason = "Deletion scheduled";
    } else if (r.isSuspended) {
      riskReason = "Suspended";
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
      createdAt: r.createdAt,
      atRisk: riskReason !== null,
      riskReason,
    };
  });
}

// ── GET /api/platform/billing/summary ────────────────────────────────────────
router.get("/billing/summary", requireAuth, requireLevel(0), async (_req: any, res: any) => {
  try {
    const rows = await buildRows();

    const mrrKes = rows.reduce((sum, r) => sum + r.mrrKes, 0);
    const paying = rows.filter((r) => r.mrrKes > 0);
    const trials = rows.filter((r) => r.isTrial);
    const atRisk = rows.filter((r) => r.atRisk);

    // Plan mix by effective tier.
    const byPlan: Record<string, number> = { free: 0, pro: 0, enterprise: 0 };
    for (const r of rows) byPlan[r.effectivePlan] = (byPlan[r.effectivePlan] ?? 0) + 1;

    // Pipeline: what trials would be worth if they all converted at their tier.
    const trialPipelineKes = trials.reduce((sum, r) => {
      const tier = isPlanTier(r.storedPlan) ? r.storedPlan : "free";
      return sum + (PLANS[tier].priceMonthlyKes ?? 0);
    }, 0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const newThisMonth = rows.filter((r) => new Date(r.createdAt) >= thirtyDaysAgo).length;

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
      averageRevenuePerPayingKes: paying.length ? Math.round(mrrKes / paying.length) : 0,
      // Conversion of ended trials → paying, as a rough funnel signal.
      byPlan,
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

    res.json({ tenants: filtered, total: filtered.length });
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
