/**
 * Platform-admin tenant lifecycle routes.
 *
 * Mounted under /api/platform (see platform.ts mounting in routes/index.ts).
 * Cross-tenant — no resolveTenant. Every route is gated at requireLevel(0).
 *
 * Lifecycle states and the transitions allowed here:
 *
 *   active ──suspend──▶ suspended ──reactivate──▶ active
 *      │                    │
 *      └───────schedule-deletion───────▶ deletion_scheduled
 *                                              │
 *                          cancel-deletion ────┘──▶ active
 *                                              │
 *                                 purge (cron or manual) ──▶ row deleted
 *
 * Deletion is deliberately two-phase: scheduling suspends access and starts a
 * grace period, and only the purge actually destroys data. That gives a
 * campaign time to reverse a mistake during an election cycle.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, tenantsTable, brandingTable, domainChangeRequestsTable, deletionRequestsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { logger } from "../lib/logger";
import { sendEmailAsync } from "../lib/email";
import { purgeTenant } from "../jobs/tenantPurge";
import { recordPlatformAction } from "../lib/platformAudit";
import { platformUrl } from "../lib/stripe";

const router = Router();

/** Grace period between scheduling a deletion and the purge running. */
const DELETION_GRACE_DAYS = 30;

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

function supportEmail(): string {
  return process.env.SUPPORT_EMAIL ?? "support@example.com";
}

async function actorId(clerkId: string): Promise<string | null> {
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return u?.id ?? null;
}

async function loadTenant(id: string) {
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
  return t ?? null;
}

async function brandedName(tenantId: string, fallback: string): Promise<string> {
  const [b] = await db
    .select({ campaignName: brandingTable.campaignName })
    .from(brandingTable)
    .where(eq(brandingTable.tenantId, tenantId))
    .limit(1);
  return b?.campaignName || fallback;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });
}

// ── PATCH /api/platform/tenants/:id/lifecycle ────────────────────────────────
// Unified state transition endpoint.
//   { action: "suspend" | "reactivate" | "schedule-deletion" | "cancel-deletion",
//     reason?: string, graceDays?: number }
router.patch(
  "/tenants/:id/lifecycle",
  requireAuth,
  requireLevel(0),
  async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { action, reason, graceDays } = req.body as {
        action?: string;
        reason?: string;
        graceDays?: number;
      };

      const tenant = await loadTenant(id);
      if (!tenant) return res.status(404).json({ error: "Campaign not found" });

      const name = await brandedName(tenant.id, tenant.name);
      const to = tenant.billingEmail;

      switch (action) {
        case "suspend": {
          if (tenant.lifecycleState === "deletion_scheduled") {
            return res.status(409).json({
              error: "This campaign is already scheduled for deletion. Cancel that first.",
            });
          }
          // The transition and its audit record commit in one transaction.
          const [updated] = await db.transaction(async (tx) => {
            const [u] = await tx
              .update(tenantsTable)
              .set({ lifecycleState: "suspended", isSuspended: true })
              .where(eq(tenantsTable.id, id))
              .returning();

            await recordPlatformAction(
              req,
              {
                action: "platform.tenant.suspend",
                resource: "tenant",
                tenantId: id,
                resourceId: id,
                details: { slug: tenant.slug, name: tenant.name, reason: reason ?? null },
              },
              tx,
            );
            return [u];
          });

          if (to) {
            sendEmailAsync({
              to,
              tenantId: tenant.id,
              template: "campaign_suspended",
              data: { campaignName: name, reason: reason || undefined, supportEmail: supportEmail() },
            });
          }
          logger.warn({ tenantId: id, reason }, "[lifecycle] suspended");
          return res.json({ tenant: updated, message: `${name} has been suspended.` });
        }

        case "reactivate": {
          // The transition, the request close-out and the audit record
          // commit in one transaction.
          const [updated] = await db.transaction(async (tx) => {
            const [u] = await tx
              .update(tenantsTable)
              .set({
                lifecycleState: "active",
                isSuspended: false,
                scheduledDeletionAt: null,
              })
              .where(eq(tenantsTable.id, id))
              .returning();

            // Close any pending deletion request — reactivation supersedes it.
            await tx
              .update(deletionRequestsTable)
              .set({
                status: "rejected",
                reviewNotes: "Campaign reactivated by the platform team.",
                reviewedBy: await actorId(req.clerkId),
                reviewedAt: new Date(),
              })
              .where(
                and(
                  eq(deletionRequestsTable.tenantId, id),
                  eq(deletionRequestsTable.status, "pending"),
                ),
              );

            await recordPlatformAction(
              req,
              {
                action: "platform.tenant.resume",
                resource: "tenant",
                tenantId: id,
                resourceId: id,
                details: { slug: tenant.slug, name: tenant.name },
              },
              tx,
            );
            return [u];
          });

          if (to) {
            sendEmailAsync({
              to,
              tenantId: tenant.id,
              template: "campaign_reactivated",
              data: { campaignName: name, dashboardUrl: `${platformUrl()}/dashboard` },
            });
          }
          logger.info({ tenantId: id }, "[lifecycle] reactivated");
          return res.json({ tenant: updated, message: `${name} is active again.` });
        }

        case "schedule-deletion": {
          const days =
            typeof graceDays === "number" && graceDays >= 0 && graceDays <= 365
              ? graceDays
              : DELETION_GRACE_DAYS;
          const deletionDate = new Date(Date.now() + days * 86_400_000);

          // The transition, the request approval and the audit record
          // commit in one transaction.
          const [updated] = await db.transaction(async (tx) => {
            const [u] = await tx
              .update(tenantsTable)
              .set({
                lifecycleState: "deletion_scheduled",
                scheduledDeletionAt: deletionDate,
                // Access is cut immediately; only the data survives the grace period.
                isSuspended: true,
              })
              .where(eq(tenantsTable.id, id))
              .returning();

            await tx
              .update(deletionRequestsTable)
              .set({
                status: "approved",
                reviewedBy: await actorId(req.clerkId),
                reviewedAt: new Date(),
                reviewNotes: reason ?? null,
              })
              .where(
                and(
                  eq(deletionRequestsTable.tenantId, id),
                  eq(deletionRequestsTable.status, "pending"),
                ),
              );

            await recordPlatformAction(
              req,
              {
                action: "platform.tenant.schedule-deletion",
                resource: "tenant",
                tenantId: id,
                resourceId: id,
                details: {
                  slug: tenant.slug,
                  name: tenant.name,
                  deletionDate: deletionDate.toISOString(),
                  reason: reason ?? null,
                },
              },
              tx,
            );
            return [u];
          });

          if (to) {
            sendEmailAsync({
              to,
              tenantId: tenant.id,
              template: "deletion_scheduled",
              data: {
                campaignName: name,
                deletionDate: formatDate(deletionDate),
                cancelContact: supportEmail(),
              },
            });
          }
          logger.warn({ tenantId: id, deletionDate }, "[lifecycle] deletion scheduled");
          return res.json({
            tenant: updated,
            message: `${name} will be permanently deleted on ${formatDate(deletionDate)}.`,
          });
        }

        case "cancel-deletion": {
          if (tenant.lifecycleState !== "deletion_scheduled") {
            return res.status(409).json({ error: "This campaign is not scheduled for deletion." });
          }
          // The transition and its audit record commit in one transaction.
          const [updated] = await db.transaction(async (tx) => {
            const [u] = await tx
              .update(tenantsTable)
              .set({
                lifecycleState: "active",
                scheduledDeletionAt: null,
                isSuspended: false,
              })
              .where(eq(tenantsTable.id, id))
              .returning();

            await recordPlatformAction(
              req,
              {
                action: "platform.tenant.cancel-deletion",
                resource: "tenant",
                tenantId: id,
                resourceId: id,
                details: { slug: tenant.slug, name: tenant.name },
              },
              tx,
            );
            return [u];
          });

          if (to) {
            sendEmailAsync({
              to,
              tenantId: tenant.id,
              template: "deletion_cancelled",
              data: { campaignName: name, dashboardUrl: `${platformUrl()}/dashboard` },
            });
          }
          logger.info({ tenantId: id }, "[lifecycle] deletion cancelled");
          return res.json({ tenant: updated, message: `Deletion cancelled. ${name} is active again.` });
        }

        default:
          return res.status(400).json({
            error:
              "action must be one of: suspend, reactivate, schedule-deletion, cancel-deletion",
          });
      }
    } catch (err: any) {
      logger.error({ err }, "request failed");
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  },
);

// ── PATCH /api/platform/tenants/:id/rename ───────────────────────────────────
// Rename a campaign and/or move it to a new slug.
router.patch("/tenants/:id/rename", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, slug } = req.body as { name?: string; slug?: string };

    if (!name && !slug) return res.status(400).json({ error: "Provide name and/or slug." });

    const tenant = await loadTenant(id);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const patch: Record<string, unknown> = {};

    if (name && name.trim() !== tenant.name) patch.name = name.trim();

    if (slug && slug !== tenant.slug) {
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
        return res
          .status(400)
          .json({ error: "Slug must be 3–40 lowercase letters, numbers or hyphens." });
      }
      const [clash] = await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.slug, slug))
        .limit(1);
      if (clash) return res.status(409).json({ error: `Slug '${slug}' is already taken.` });
      patch.slug = slug;
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ tenant, message: "No changes." });
    }

    // The rename and its audit record commit in one transaction.
    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(tenantsTable)
        .set(patch)
        .where(eq(tenantsTable.id, id))
        .returning();

      await recordPlatformAction(
        req,
        {
          action: "platform.tenant.rename",
          resource: "tenant",
          tenantId: id,
          resourceId: id,
          details: {
            from: { name: tenant.name, slug: tenant.slug },
            to: patch,
          },
        },
        tx,
      );
      return [u];
    });

    logger.info({ tenantId: id, patch }, "[lifecycle] renamed");
    res.json({
      tenant: updated,
      message: patch.slug
        ? `Renamed. The campaign now lives at /${patch.slug} — old links will stop working.`
        : "Campaign renamed.",
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── DELETE /api/platform/tenants/:id/purge ───────────────────────────────────
// Immediate, irreversible purge. Requires an explicit slug confirmation.
router.delete("/tenants/:id/purge", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { confirmSlug } = req.body as { confirmSlug?: string };

    const tenant = await loadTenant(id);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    if (confirmSlug !== tenant.slug) {
      return res.status(400).json({
        error: `Type the campaign slug exactly ("${tenant.slug}") to confirm permanent deletion.`,
      });
    }

    // Phase two only. purgeTenant refuses anything not already scheduled for
    // deletion; "purge now" waives the remaining grace period, nothing more.
    if (tenant.lifecycleState !== "deletion_scheduled") {
      return res.status(409).json({
        error: `${tenant.name} is not scheduled for deletion. Schedule deletion first — purging is irreversible.`,
      });
    }

    await purgeTenant(id, { ignoreGracePeriod: true });

    // Recorded AFTER the purge with no tenant link — the row is gone; the
    // campaign's identity survives in the details.
    await recordPlatformAction(req, {
      action: "platform.tenant.purge",
      resource: "tenant",
      tenantId: null,
      resourceId: id,
      details: { slug: tenant.slug, name: tenant.name },
    });

    res.json({ message: `${tenant.name} and all its data have been permanently deleted.` });
  } catch (err: any) {
    logger.error({ err }, "[lifecycle] manual purge failed");
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Review queues ────────────────────────────────────────────────────────────

// GET /api/platform/requests — pending domain + deletion requests
router.get("/requests", requireAuth, requireLevel(0), async (_req: any, res: any) => {
  try {
    const domain = await db
      .select({
        id: domainChangeRequestsTable.id,
        tenantId: domainChangeRequestsTable.tenantId,
        tenantName: tenantsTable.name,
        tenantSlug: tenantsTable.slug,
        kind: domainChangeRequestsTable.kind,
        currentValue: domainChangeRequestsTable.currentValue,
        requestedValue: domainChangeRequestsTable.requestedValue,
        status: domainChangeRequestsTable.status,
        createdAt: domainChangeRequestsTable.createdAt,
      })
      .from(domainChangeRequestsTable)
      .innerJoin(tenantsTable, eq(tenantsTable.id, domainChangeRequestsTable.tenantId))
      .where(eq(domainChangeRequestsTable.status, "pending"))
      .orderBy(desc(domainChangeRequestsTable.createdAt));

    const deletion = await db
      .select({
        id: deletionRequestsTable.id,
        tenantId: deletionRequestsTable.tenantId,
        tenantName: tenantsTable.name,
        tenantSlug: tenantsTable.slug,
        reason: deletionRequestsTable.reason,
        status: deletionRequestsTable.status,
        createdAt: deletionRequestsTable.createdAt,
      })
      .from(deletionRequestsTable)
      .innerJoin(tenantsTable, eq(tenantsTable.id, deletionRequestsTable.tenantId))
      .where(eq(deletionRequestsTable.status, "pending"))
      .orderBy(desc(deletionRequestsTable.createdAt));

    res.json({ domainRequests: domain, deletionRequests: deletion });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/platform/requests/domain/:id — approve or reject, applying the change
router.patch(
  "/requests/domain/:id",
  requireAuth,
  requireLevel(0),
  async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { approve, reviewNotes } = req.body as { approve?: boolean; reviewNotes?: string };
      if (typeof approve !== "boolean") {
        return res.status(400).json({ error: "approve (boolean) is required" });
      }

      const [request] = await db
        .select()
        .from(domainChangeRequestsTable)
        .where(eq(domainChangeRequestsTable.id, id))
        .limit(1);
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.status !== "pending") {
        return res.status(409).json({ error: "This request has already been reviewed." });
      }

      if (approve) {
        if (request.kind === "slug") {
          const [clash] = await db
            .select({ id: tenantsTable.id })
            .from(tenantsTable)
            .where(eq(tenantsTable.slug, request.requestedValue))
            .limit(1);
          if (clash) {
            return res
              .status(409)
              .json({ error: `Slug '${request.requestedValue}' has since been taken.` });
          }
          await db
            .update(tenantsTable)
            .set({ slug: request.requestedValue })
            .where(eq(tenantsTable.id, request.tenantId));
        } else {
          await db
            .update(tenantsTable)
            .set({ customDomain: request.requestedValue, tlsStatus: "pending" })
            .where(eq(tenantsTable.id, request.tenantId));
        }
      }

      // The decision, its application and its audit record commit together.
      const [updated] = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(domainChangeRequestsTable)
          .set({
            status: approve ? "approved" : "rejected",
            reviewNotes: reviewNotes ?? null,
            reviewedBy: await actorId(req.clerkId),
            reviewedAt: new Date(),
          })
          .where(eq(domainChangeRequestsTable.id, id))
          .returning();

        await recordPlatformAction(
          req,
          {
            action: "platform.domain-request.review",
            resource: "domain_change_request",
            tenantId: request.tenantId,
            resourceId: id,
            details: {
              kind: request.kind,
              requestedValue: request.requestedValue,
              decision: approve ? "approved" : "rejected",
              reviewNotes: reviewNotes ?? null,
            },
          },
          tx,
        );
        return [u];
      });

      res.json({
        request: updated,
        message: approve
          ? `Applied. The campaign now uses '${request.requestedValue}'.`
          : "Request rejected.",
      });
    } catch (err: any) {
      logger.error({ err }, "request failed");
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  },
);

export default router;
