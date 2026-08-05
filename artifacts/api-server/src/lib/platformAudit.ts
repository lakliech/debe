/**
 * Platform audit trail — the one way platform-level actions get recorded.
 *
 * An override power that cannot be reviewed is a liability: every
 * platform-level operation (creating, suspending or deleting a campaign,
 * granting or revoking access, entering or leaving a customer's campaign)
 * must leave a record of who did what, to which campaign, and when.
 *
 * All platform routes write through THIS helper so a new platform endpoint
 * cannot quietly skip auditing, and the records surface in the platform-wide
 * activity log (GET /api/platform/activity), which only platform standing
 * can read — campaign administrators never see another campaign's rows.
 *
 * Records live in audit_logs with tenant_id set to the AFFECTED campaign
 * (null when the action touches no single campaign), so they also appear in
 * that campaign's own audit view where relevant.
 *
 * DURABILITY POLICY — fail closed, and atomic where it matters. Recording
 * throws on ANY failure (insert error, missing actor identity): a platform
 * action without its audit record is a breach of the accountability
 * contract, so the request fails loudly (500 + error log) instead of
 * leaving a silent gap in the trail.
 *
 * Callers performing a mutation pass their transaction as `tx` so the
 * mutation and its record COMMIT OR ROLL BACK TOGETHER — a recording
 * failure then also undoes the mutation. The only post-commit records are
 * for actions whose mutation cannot share a transaction (the irreversible
 * purge; the best-effort invite grant), and those say so at the call site.
 */

import type { Request } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface PlatformActionEntry {
  /** Machine-readable action, e.g. "platform.tenant.create". */
  action: string;
  /** What was acted on, e.g. "tenant", "user_role". */
  resource: string;
  /** The affected campaign, when there is one. */
  tenantId?: string | null;
  resourceId?: string | null;
  /** Structured context — stored as the entry's new_value JSON. */
  details?: Record<string, unknown>;
  /** Prior state for removals/revocations — stored as old_value JSON. */
  prior?: Record<string, unknown>;
}

export async function recordPlatformAction(
  req: Request,
  entry: PlatformActionEntry,
  /** Caller transaction — the mutation and its record commit together. */
  tx?: unknown,
): Promise<void> {
  try {
    const clerkId = (req as any).clerkId as string | undefined;
    if (!clerkId) {
      throw new Error(
        `[platformAudit] no authenticated actor — refusing to record ${entry.action}`,
      );
    }

    const q = (tx ?? db) as typeof db;
    const [actor] = await q
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    if (!actor) {
      throw new Error(
        `[platformAudit] no local user for ${clerkId} — refusing to record ${entry.action} anonymously`,
      );
    }

    await q.insert(auditLogsTable).values({
      tenantId: entry.tenantId ?? null,
      userId: actor.id,
      userEmail: actor.email,
      userFullName: actor.fullName,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      newValue: entry.details ? JSON.stringify(entry.details) : null,
      oldValue: entry.prior ? JSON.stringify(entry.prior) : null,
      ipAddress: (req as any).ip ?? null,
      userAgent: (req.headers?.["user-agent"] as string | undefined) ?? null,
    });
  } catch (err) {
    console.error(`[platformAudit] FAILED to record ${entry.action}:`, err);
    throw err;
  }
}
