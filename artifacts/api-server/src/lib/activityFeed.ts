/**
 * Activity feed writer — powers the dashboard "Live Feed".
 *
 * Fire-and-forget by design: a feed write must never break or slow the
 * mutation it describes, so failures are logged, never thrown. Callers should
 * NOT await this inside a transaction — the feed is a read-optimised log,
 * not part of the mutation's atomic state.
 */
import { logger } from "./logger";
import { db } from "@workspace/db";
import { activityFeedTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function logActivity(opts: {
  tenantId: string;
  /** Internal users.id of the actor, if already resolved. */
  actorUserId?: string | null;
  /** Clerk id of the actor — resolved to users.id/fullName when no actorUserId. */
  actorClerkId?: string | null;
  /** Machine type, e.g. "result_submitted", "agent_created". */
  type: string;
  /** Human sentence shown in the feed, e.g. "Jane verified a Form 34A result". */
  description: string;
  resource?: string;
  resourceId?: string;
}): Promise<void> {
  try {
    let userId = opts.actorUserId ?? null;
    let userName = "System";

    if (userId) {
      const [u] = await db.select({ fullName: usersTable.fullName })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (u) userName = u.fullName;
    } else if (opts.actorClerkId) {
      const [u] = await db.select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable).where(eq(usersTable.clerkId, opts.actorClerkId)).limit(1);
      userId = u?.id ?? null;
      if (u) userName = u.fullName;
    }

    // userId is NOT NULL in the schema — anonymous writes are skipped.
    if (!userId) {
      logger.warn({ type: opts.type }, "activity feed write skipped: actor unresolved");
      return;
    }

    await db.insert(activityFeedTable).values({
      tenantId: opts.tenantId,
      type: opts.type,
      description: opts.description,
      userId,
      userName,
      resource: opts.resource,
      resourceId: opts.resourceId,
    });
  } catch (err) {
    logger.warn({ err, type: opts.type }, "activity feed write failed");
  }
}
