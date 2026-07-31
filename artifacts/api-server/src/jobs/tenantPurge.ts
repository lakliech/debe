/**
 * tenantPurge — daily cron that permanently deletes campaigns whose grace
 * period has run out.
 *
 * A campaign reaches this job only after a platform admin schedules deletion,
 * which sets lifecycle_state='deletion_scheduled' and scheduled_deletion_at to
 * a future date. Until that date the data is untouched and the deletion can be
 * cancelled — this job is the point of no return.
 *
 * Order matters: external systems are detached BEFORE the database row goes,
 * because once the row is gone we no longer know the Stripe customer or Clerk
 * org to clean up. A failure detaching externals aborts that tenant's purge and
 * leaves it for the next run rather than orphaning billing or auth records.
 *
 * Campaign data itself is removed by ON DELETE CASCADE from tenants.id.
 */

import { schedule } from "node-cron";
import { db, tenantsTable } from "@workspace/db";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { stripeConfigured, cancelSubscription } from "../lib/stripe";
import { clerkDelete, clerkOrgsDisabled } from "../lib/clerkAdmin";

/** 03:00 UTC daily → 06:00 EAT, off-peak. */
const CRON_SCHEDULE = "0 3 * * *";

async function detachExternals(tenant: {
  id: string;
  clerkOrgId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  if (tenant.stripeSubscriptionId && stripeConfigured()) {
    await cancelSubscription(tenant.stripeSubscriptionId);
    logger.info({ tenantId: tenant.id }, "[tenantPurge] stripe subscription cancelled");
  }

  if (tenant.clerkOrgId && !clerkOrgsDisabled() && !tenant.clerkOrgId.startsWith("org_stub_")) {
    await clerkDelete(`/organizations/${tenant.clerkOrgId}`);
    logger.info({ tenantId: tenant.id }, "[tenantPurge] clerk organisation deleted");
  }
}

/** Purge a single tenant. Exported so the platform "purge now" route can reuse it. */
export async function purgeTenant(tenantId: string): Promise<void> {
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      clerkOrgId: tenantsTable.clerkOrgId,
      stripeSubscriptionId: tenantsTable.stripeSubscriptionId,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) throw new Error("Campaign not found");

  // If this throws, the tenant row survives and the next run retries.
  await detachExternals(tenant);

  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));

  logger.warn(
    { tenantId, slug: tenant.slug, name: tenant.name },
    "[tenantPurge] campaign permanently deleted",
  );
}

export async function runTenantPurge(): Promise<{ purged: number; failed: number }> {
  logger.info("[tenantPurge] starting daily pass");

  let purged = 0;
  let failed = 0;

  try {
    const due = await db
      .select({ id: tenantsTable.id, slug: tenantsTable.slug })
      .from(tenantsTable)
      .where(
        and(
          eq(tenantsTable.lifecycleState, "deletion_scheduled"),
          isNotNull(tenantsTable.scheduledDeletionAt),
          lte(tenantsTable.scheduledDeletionAt, sql`NOW()`),
        ),
      );

    for (const t of due) {
      try {
        await purgeTenant(t.id);
        purged++;
      } catch (err) {
        failed++;
        logger.error({ err, tenantId: t.id, slug: t.slug }, "[tenantPurge] purge failed — will retry");
      }
    }
  } catch (err) {
    logger.error({ err }, "[tenantPurge] pass failed");
  }

  logger.info({ purged, failed }, "[tenantPurge] done");
  return { purged, failed };
}

export function registerTenantPurgeJob(): void {
  schedule(CRON_SCHEDULE, () => {
    void runTenantPurge();
  });
  logger.info({ schedule: CRON_SCHEDULE }, "[tenantPurge] job registered");
}
