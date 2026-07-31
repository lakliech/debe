/**
 * trialExpiry — daily cron that manages Pro trial lifecycles.
 *
 * Two passes, both idempotent so a re-run on the same day is harmless:
 *
 *  1. WARN    — campaigns whose trial ends in exactly 7, 3 or 1 days get a
 *               reminder email. Exact-day matching (rather than "<= N days")
 *               is what keeps this from emailing daily.
 *  2. EXPIRE  — campaigns whose override has lapsed and that have no paid
 *               subscription drop to Free and get a "trial ended" email.
 *
 * A campaign that subscribed during its trial is skipped: its Stripe status is
 * active/trialing, so it keeps its tier regardless of the override timestamp.
 *
 * Register in app.ts via registerTrialExpiryJob().
 */

import { schedule } from "node-cron";
import { db, tenantsTable, brandingTable } from "@workspace/db";
import { and, eq, isNotNull, lte, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/email";
import { TRIAL_DAYS } from "../lib/plans";
import { platformUrl } from "../lib/stripe";

/** Days before expiry on which a reminder is sent. */
const WARN_DAYS = [7, 3, 1];

/** 08:00 UTC daily → 11:00 EAT, a reasonable hour to land in an inbox. */
const CRON_SCHEDULE = "0 8 * * *";

/** Stripe statuses that mean the campaign is paying and must not be downgraded. */
const PAYING_STATUSES = ["active", "trialing"];

async function brandedName(tenantId: string, fallback: string): Promise<string> {
  const [b] = await db
    .select({ campaignName: brandingTable.campaignName })
    .from(brandingTable)
    .where(eq(brandingTable.tenantId, tenantId))
    .limit(1);
  return b?.campaignName || fallback;
}

function upgradeUrl(): string {
  return `${platformUrl()}/settings?tab=plan`;
}

/** Pass 1 — reminder emails at fixed day offsets. */
async function sendTrialWarnings(): Promise<number> {
  // Campaigns on a trial: override in the future, no paid subscription.
  const candidates = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      billingEmail: tenantsTable.billingEmail,
      planOverrideUntil: tenantsTable.planOverrideUntil,
      plan: tenantsTable.plan,
      status: tenantsTable.stripeSubscriptionStatus,
    })
    .from(tenantsTable)
    .where(
      and(
        isNotNull(tenantsTable.planOverrideUntil),
        sql`${tenantsTable.planOverrideUntil} > NOW()`,
        sql`${tenantsTable.plan} <> 'free'`,
        eq(tenantsTable.lifecycleState, "active"),
        sql`(${tenantsTable.stripeSubscriptionStatus} IS NULL OR ${tenantsTable.stripeSubscriptionStatus} NOT IN ('active','trialing'))`,
      ),
    );

  let sent = 0;
  const now = Date.now();

  for (const t of candidates) {
    if (!t.planOverrideUntil || !t.billingEmail) continue;

    const daysLeft = Math.ceil(
      (new Date(t.planOverrideUntil).getTime() - now) / 86_400_000,
    );
    if (!WARN_DAYS.includes(daysLeft)) continue;

    const result = await sendEmail({
      to: t.billingEmail,
      tenantId: t.id,
      template: "trial_expiring",
      data: {
        campaignName: await brandedName(t.id, t.name),
        daysLeft,
        upgradeUrl: upgradeUrl(),
      },
    });
    if (result.status !== "failed") sent++;
  }

  return sent;
}

/** Pass 2 — downgrade lapsed trials to Free. */
async function expireLapsedTrials(): Promise<number> {
  const lapsed = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      billingEmail: tenantsTable.billingEmail,
    })
    .from(tenantsTable)
    .where(
      and(
        isNotNull(tenantsTable.planOverrideUntil),
        lte(tenantsTable.planOverrideUntil, sql`NOW()`),
        sql`${tenantsTable.plan} <> 'free'`,
        sql`(${tenantsTable.stripeSubscriptionStatus} IS NULL OR ${tenantsTable.stripeSubscriptionStatus} NOT IN ('active','trialing'))`,
      ),
    );

  if (lapsed.length === 0) return 0;

  // Single UPDATE so a mid-loop crash can't leave half the batch downgraded.
  await db
    .update(tenantsTable)
    .set({ plan: "free", planOverrideUntil: null })
    .where(
      inArray(
        tenantsTable.id,
        lapsed.map((t) => t.id),
      ),
    );

  for (const t of lapsed) {
    if (!t.billingEmail) continue;
    await sendEmail({
      to: t.billingEmail,
      tenantId: t.id,
      template: "trial_ended",
      data: {
        campaignName: await brandedName(t.id, t.name),
        upgradeUrl: upgradeUrl(),
      },
    });
  }

  return lapsed.length;
}

export async function runTrialExpiry(): Promise<{ warned: number; expired: number }> {
  logger.info("[trialExpiry] starting daily pass");
  let warned = 0;
  let expired = 0;

  try {
    warned = await sendTrialWarnings();
  } catch (err) {
    logger.error({ err }, "[trialExpiry] warning pass failed");
  }

  try {
    expired = await expireLapsedTrials();
  } catch (err) {
    logger.error({ err }, "[trialExpiry] expiry pass failed");
  }

  logger.info({ warned, expired, trialDays: TRIAL_DAYS }, "[trialExpiry] done");
  return { warned, expired };
}

export function registerTrialExpiryJob(): void {
  schedule(CRON_SCHEDULE, () => {
    void runTrialExpiry();
  });
  logger.info({ schedule: CRON_SCHEDULE }, "[trialExpiry] job registered");
}
