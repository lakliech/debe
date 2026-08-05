/**
 * Platform override — the single place guards learn that platform standing
 * outranks tenant-scoped restrictions.
 *
 * The platform super admin (users.is_global_admin) exists to support and
 * repair ANY customer's campaign. Tenant-scoped guards — plan gating, the
 * read-only demo rule — would otherwise refuse them inside a campaign on a
 * lower plan or lock them out of the demo campaign they curate. Every such
 * guard consults THIS helper rather than growing its own notion of "admin",
 * so future guards inherit the override instead of having to remember it.
 *
 * Architectural constraint (mirrors rbac.ts): platform standing is decided
 * ONLY by the global-admin flag. A campaign-level role slug — even
 * "super-admin", which every campaign founder holds — must never satisfy a
 * platform override.
 *
 * Every use of this override is auditable: actions taken inside a campaign
 * are recorded through lib/platformAudit.ts.
 */

import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { resolveActor } from "../middlewares/rbac";

/**
 * True when the caller is the platform super admin.
 *
 * Guards can run before any route-level requireLevel/resolveActor (e.g.
 * demoGuard sits in the withTenant chain), so the actor snapshot may not
 * exist yet — resolve it on demand. resolveActor caches per request and
 * in-process, so this is at most one extra lookup.
 */
export async function hasPlatformOverride(req: Request, res: Response): Promise<boolean> {
  const r = req as any;
  if (r.isGlobalAdmin === true) return true;

  if (!r.clerkId) {
    const auth = getAuth(req);
    if (!auth?.userId) return false;
    r.clerkId = auth.userId;
  }

  await new Promise<void>((resolvePromise, reject) =>
    resolveActor(req, res, (err?: any) => (err ? reject(err) : resolvePromise())),
  );
  return r.isGlobalAdmin === true;
}
