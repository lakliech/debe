/**
 * Platform administration routes — cross-tenant, super-operator only.
 *
 * These routes are NOT wrapped in resolveTenant so they can see all tenants.
 * Access is gated behind requireLevel(0) — only the platform_admin role (level 0)
 * passes. All other campaign roles start at level 1.
 *
 * Endpoints:
 *   GET    /api/platform/tenants          — list all tenants with user counts
 *   POST   /api/platform/tenants          — create tenant row + grant its first admin
 *   GET    /api/platform/tenants/:id      — single tenant detail
 *   PATCH  /api/platform/tenants/:id/suspend — toggle suspension
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  userRolesTable,
  rolesTable,
  usersTable,
  brandingTable,
  campaignStationProfilesTable,
  resultSubmissionsTable,
  pollingAgentsTable,
  agentSyncStatusTable,
  pollingStationsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, sql, and, or, isNull, isNotNull, notExists, lt, gt, ne, ilike, desc, inArray } from "drizzle-orm";
import { bustActorCache } from "../middlewares/rbac";
import { requireLevel } from "../middlewares/rbac";
import { grantCampaignAdminByEmail } from "../lib/grantCampaignAdmin";
import { recordPlatformAction } from "../lib/platformAudit";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// ── Shared: all-tenant query with user counts ─────────────────────────────────
async function listTenantsWithCounts() {
  return db
    .select({
      id: tenantsTable.id,
      clerkOrgId: tenantsTable.clerkOrgId,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      plan: tenantsTable.plan,
      isSuspended: tenantsTable.isSuspended,
      customDomain: tenantsTable.customDomain,
      tlsStatus: tenantsTable.tlsStatus,
      createdAt: tenantsTable.createdAt,
      userCount: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)`,
    })
    .from(tenantsTable)
    .leftJoin(userRolesTable, eq(userRolesTable.tenantId, tenantsTable.id))
    .groupBy(
      tenantsTable.id,
      tenantsTable.clerkOrgId,
      tenantsTable.name,
      tenantsTable.slug,
      tenantsTable.plan,
      tenantsTable.isSuspended,
      tenantsTable.customDomain,
      tenantsTable.tlsStatus,
      tenantsTable.createdAt,
    )
    .orderBy(tenantsTable.createdAt);
}

// ── GET /api/platform/tenants ─────────────────────────────────────────────────
router.get("/tenants", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const tenants = await listTenantsWithCounts();
    res.json(tenants);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Active campaign context for platform operators ────────────────────────────
//
// A platform operator has no campaign of their own. To make config changes
// inside a campaign they must explicitly enter it; leaving sets the context
// back to null and returns them to the platform surface. The choice is stored
// on the user row so it survives reloads and server restarts.

// ── GET /api/platform/active-campaign ─────────────────────────────────────────
router.get("/active-campaign", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const [row] = await db
      .select({ activeTenantId: usersTable.activeTenantId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkId))
      .limit(1);

    if (!row?.activeTenantId) return res.json({ activeCampaign: null });

    const [tenant] = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        plan: tenantsTable.plan,
        isSuspended: tenantsTable.isSuspended,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, row.activeTenantId))
      .limit(1);

    res.json({ activeCampaign: tenant ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/platform/active-campaign ─────────────────────────────────────────
// Body: { tenantId: string | null } — null exits the campaign.
router.put("/active-campaign", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { tenantId } = req.body ?? {};

    if (tenantId !== null && typeof tenantId !== "string") {
      return res
        .status(400)
        .json({ error: "tenantId must be a campaign id, or null to exit the campaign." });
    }

    let activeCampaign: any = null;

    if (tenantId) {
      const [tenant] = await db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.name,
          slug: tenantsTable.slug,
          plan: tenantsTable.plan,
          isSuspended: tenantsTable.isSuspended,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);

      if (!tenant) return res.status(404).json({ error: "Campaign not found." });
      if (tenant.isSuspended) {
        return res
          .status(409)
          .json({ error: "This campaign is suspended. Unsuspend it before entering." });
      }
      activeCampaign = tenant;
    }

    const [previous] = await db
      .select({ activeTenantId: usersTable.activeTenantId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkId))
      .limit(1);

    // The context change and its audit record commit in one transaction —
    // entering or leaving a customer's campaign is an auditable platform
    // event in its own right, and it must never happen unrecorded.
    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(usersTable)
        .set({ activeTenantId: tenantId })
        .where(eq(usersTable.clerkId, req.clerkId))
        .returning({ id: usersTable.id });

      if (!u) return [undefined];

      if (tenantId) {
        await recordPlatformAction(
          req,
          {
            action: "platform.campaign.enter",
            resource: "tenant",
            tenantId,
            resourceId: tenantId,
            details: { slug: activeCampaign.slug, name: activeCampaign.name },
          },
          tx,
        );
      } else if (previous?.activeTenantId) {
        await recordPlatformAction(
          req,
          {
            action: "platform.campaign.exit",
            resource: "tenant",
            tenantId: previous.activeTenantId,
            resourceId: previous.activeTenantId,
          },
          tx,
        );
      }
      return [u];
    });

    if (!updated) return res.status(404).json({ error: "No local profile for this account." });

    // Effective roles differ per campaign, so the cached actor snapshot for
    // this operator is stale the moment the context changes.
    bustActorCache(req.clerkId);

    res.json({ activeCampaign });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/platform/tenants ────────────────────────────────────────────────
router.post("/tenants", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { name, slug, adminEmail, plan = "free" } = req.body as {
      name?: string;
      slug?: string;
      adminEmail?: string;
      plan?: string;
    };

    if (!name || !slug) {
      return res.status(400).json({ error: "name and slug are required" });
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: "slug must be lowercase alphanumeric and hyphens only" });
    }

    // Check slug uniqueness before hitting Clerk
    const [existing] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1);
    if (existing) {
      return res.status(409).json({ error: `Tenant slug '${slug}' is already taken` });
    }

    // The tenant row and its audit record commit in one transaction — the
    // campaign never exists without the record of who created it.
    const [tenant] = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tenantsTable)
        .values({ name, slug, plan })
        .returning();

      await recordPlatformAction(
        req,
        {
          action: "platform.tenant.create",
          resource: "tenant",
          tenantId: t.id,
          resourceId: t.id,
          details: { name, slug, plan },
        },
        tx,
      );
      return [t];
    });

    // Grant the designated admin access (best-effort — don't block tenant
    // creation). The invitee must already have an account; if they don't,
    // say so plainly rather than inventing a pending grant. The grant runs
    // post-commit through the shared helper and is recorded only on success.
    let invitationWarning: string | null = null;
    if (adminEmail) {
      const grant = await grantCampaignAdminByEmail(tenant.id, adminEmail);
      if (!grant.granted) {
        invitationWarning =
          grant.reason === "no_account"
            ? `Campaign created, but no account exists for ${adminEmail} yet. Ask them to sign up, then resend the invite.`
            : "Campaign created, but the Super Administrator role is missing from the roles table.";
      } else {
        await recordPlatformAction(req, {
          action: "platform.membership.grant",
          resource: "user_role",
          tenantId: tenant.id,
          details: { email: adminEmail, role: "super-admin", via: "tenant-create" },
        });
      }
    }

    res.status(201).json({
      tenant,
      invitationWarning,
      message: invitationWarning
        ? invitationWarning
        : adminEmail
          ? `Tenant created and invitation sent to ${adminEmail}`
          : "Tenant created. No admin email provided — invite from the tenant detail page.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/tenants/:id ────────────────────────────────────────────
router.get("/tenants/:id", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const [row] = await db
      .select({
        id: tenantsTable.id,
        clerkOrgId: tenantsTable.clerkOrgId,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        plan: tenantsTable.plan,
        isSuspended: tenantsTable.isSuspended,
        customDomain: tenantsTable.customDomain,
        tlsStatus: tenantsTable.tlsStatus,
        createdAt: tenantsTable.createdAt,
        userCount: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)`,
      })
      .from(tenantsTable)
      .leftJoin(userRolesTable, eq(userRolesTable.tenantId, tenantsTable.id))
      .where(eq(tenantsTable.id, id))
      .groupBy(
        tenantsTable.id,
        tenantsTable.clerkOrgId,
        tenantsTable.name,
        tenantsTable.slug,
        tenantsTable.plan,
        tenantsTable.isSuspended,
        tenantsTable.customDomain,
        tenantsTable.tlsStatus,
        tenantsTable.createdAt,
      )
      .limit(1);

    if (!row) return res.status(404).json({ error: "Tenant not found" });

    // Attach branding snapshot (counts only — no private data)
    const [branding] = await db
      .select({
        campaignName: brandingTable.campaignName,
        candidateName: brandingTable.candidateName,
        electionLevel: (brandingTable as any).electionLevel,
        electionYear: brandingTable.electionYear,
        primaryColor: brandingTable.primaryColor,
      })
      .from(brandingTable)
      .where(eq(brandingTable.tenantId, id))
      .limit(1);

    res.json({ ...row, branding: branding ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/platform/tenants/:id/suspend ───────────────────────────────────
router.patch("/tenants/:id/suspend", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { isSuspended } = req.body as { isSuspended?: boolean };

    if (typeof isSuspended !== "boolean") {
      return res.status(400).json({ error: "isSuspended (boolean) is required" });
    }

    let tenant: any;
    await db.transaction(async (tx) => {
      [tenant] = await tx
        .update(tenantsTable)
        .set({ isSuspended })
        .where(eq(tenantsTable.id, id))
        .returning();

      if (!tenant) return; // nothing written — falls through to the 404

      await recordPlatformAction(
        req,
        {
          action: isSuspended ? "platform.tenant.suspend" : "platform.tenant.resume",
          resource: "tenant",
          tenantId: tenant.id,
          resourceId: tenant.id,
          details: { slug: tenant.slug, name: tenant.name },
        },
        tx,
      );
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    res.json(tenant);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/platform/tenants/:id/invite ─────────────────────────────────────
// Send (or resend) an org invitation from the detail page
router.post("/tenants/:id/invite", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { adminEmail } = req.body as { adminEmail?: string };

    if (!adminEmail) return res.status(400).json({ error: "adminEmail is required" });

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id))
      .limit(1);

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const grant = await grantCampaignAdminByEmail(tenant.id, adminEmail);
    if (!grant.granted) {
      if (grant.reason === "no_account") {
        return res.status(404).json({
          error: `No account exists for ${adminEmail} yet. Ask them to sign up first, then resend the invite.`,
        });
      }
      return res
        .status(500)
        .json({ error: "The Super Administrator role is missing from the roles table." });
    }

    await recordPlatformAction(req, {
      action: "platform.membership.grant",
      resource: "user_role",
      tenantId: tenant.id,
      details: { email: adminEmail, role: "super-admin", via: "invite" },
    });

    res.json({ message: `${adminEmail} now has campaign administrator access.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/activity ────────────────────────────────────────────────
// Platform-wide activity log — every audited action across every campaign.
// Only platform standing can read it (requireLevel(0)); a campaign
// administrator — including a campaign super-admin — must never see another
// campaign's records, and no campaign role slug can satisfy that gate.
router.get("/activity", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { userId, tenantId, action, email, limit = "50", offset = "0" } = req.query as any;
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);

    const conditions: any[] = [];
    if (userId) conditions.push(eq(auditLogsTable.userId, userId));
    if (tenantId) conditions.push(eq(auditLogsTable.tenantId, tenantId));
    if (action) conditions.push(eq(auditLogsTable.action, action));
    // Operator filter is server-side so it spans every page, not just the
    // rows the client happens to have loaded.
    if (email) conditions.push(ilike(auditLogsTable.userEmail, `%${email}%`));

    const rows = await db
      .select({
        id: auditLogsTable.id,
        action: auditLogsTable.action,
        resource: auditLogsTable.resource,
        resourceId: auditLogsTable.resourceId,
        newValue: auditLogsTable.newValue,
        oldValue: auditLogsTable.oldValue,
        createdAt: auditLogsTable.createdAt,
        userId: auditLogsTable.userId,
        userEmail: auditLogsTable.userEmail,
        userFullName: auditLogsTable.userFullName,
        tenantId: auditLogsTable.tenantId,
        tenantName: tenantsTable.name,
        tenantSlug: tenantsTable.slug,
      })
      .from(auditLogsTable)
      .leftJoin(tenantsTable, eq(auditLogsTable.tenantId, tenantsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(lim)
      .offset(off);

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() ?? null })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/ops ─────────────────────────────────────────────────────
// Live cross-tenant operations summary for the platform owner.
// Returns per-tenant: station coverage, submission counts, active agents, rate.
router.get("/ops", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    // Any status except 'draft' means the agent pressed Submit — include the full
    // lifecycle (submitted → auto_validated → exception → …verification chain… → verified).
    // Using ne() rather than listing statuses is future-proof as new states are added.
    const notDraft = ne(resultSubmissionsTable.status, "draft");

    const [tenants, stationCounts, subCounts, activeAgentCounts, rateBuckets] =
      await Promise.all([
        db
          .select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug, isSuspended: tenantsTable.isSuspended })
          .from(tenantsTable)
          .orderBy(tenantsTable.createdAt),

        db
          .select({
            tenantId: campaignStationProfilesTable.tenantId,
            total: sql<number>`CAST(COUNT(*) AS INTEGER)`,
            assigned: sql<number>`CAST(COUNT(${campaignStationProfilesTable.primaryAgentId}) AS INTEGER)`,
          })
          .from(campaignStationProfilesTable)
          .groupBy(campaignStationProfilesTable.tenantId),

        db
          .select({
            tenantId: resultSubmissionsTable.tenantId,
            // Count distinct stations that submitted — not submission rows —
            // so a station retrying multiple times still counts as 1 covered.
            received: sql<number>`CAST(COUNT(DISTINCT ${resultSubmissionsTable.pollingStationId}) AS INTEGER)`,
            lastAt: sql<string | null>`MAX(${resultSubmissionsTable.submittedAt})`,
          })
          .from(resultSubmissionsTable)
          .where(notDraft)
          .groupBy(resultSubmissionsTable.tenantId),

        db
          .select({
            tenantId: pollingAgentsTable.tenantId,
            active: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          })
          .from(pollingAgentsTable)
          .innerJoin(agentSyncStatusTable, eq(agentSyncStatusTable.agentId, pollingAgentsTable.id))
          .where(gt(agentSyncStatusTable.lastSeenAt, sql`NOW() - INTERVAL '30 minutes'`))
          .groupBy(pollingAgentsTable.tenantId),

        // 15-minute submission rate buckets over the last 6 hours
        db
          .select({
            tenantId: resultSubmissionsTable.tenantId,
            bucket: sql<string>`
              date_trunc('hour', ${resultSubmissionsTable.submittedAt}) +
              (FLOOR(EXTRACT(minute FROM ${resultSubmissionsTable.submittedAt}) / 15) * 15 * INTERVAL '1 minute')
            `,
            count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          })
          .from(resultSubmissionsTable)
          .where(
            and(
              notDraft,
              gt(resultSubmissionsTable.submittedAt, sql`NOW() - INTERVAL '6 hours'`),
            ),
          )
          .groupBy(resultSubmissionsTable.tenantId, sql`2`)
          .orderBy(sql`2`),
      ]);

    const stationMap = Object.fromEntries(stationCounts.map((r) => [r.tenantId, r]));
    const subMap = Object.fromEntries(subCounts.map((r) => [r.tenantId, r]));
    const agentMap = Object.fromEntries(activeAgentCounts.map((r) => [r.tenantId, r.active]));
    const rateMap: Record<string, Array<{ bucket: string; count: number }>> = {};
    for (const row of rateBuckets) {
      const tid = row.tenantId as string;
      if (!rateMap[tid]) rateMap[tid] = [];
      rateMap[tid].push({ bucket: row.bucket, count: row.count });
    }

    const result = tenants.map((t) => {
      const s = stationMap[t.id];
      const sub = subMap[t.id];
      const total = s?.total ?? 0;
      const received = sub?.received ?? 0;
      return {
        tenantId: t.id,
        name: t.name,
        slug: t.slug,
        isSuspended: t.isSuspended,
        totalStations: total,
        assignedStations: s?.assigned ?? 0,
        submissionsReceived: received,
        coveragePct: total > 0 ? Math.round((received / total) * 100) : 0,
        lastSubmissionAt: sub?.lastAt ?? null,
        activeAgents: agentMap[t.id] ?? 0,
        submissionRate: rateMap[t.id] ?? [],
      };
    });

    res.json({ tenants: result, updatedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/ops/:tenantId ──────────────────────────────────────────
// Per-tenant drilldown: county/constituency/ward breakdown + silent stations.
router.get("/ops/:tenantId", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { tenantId } = req.params;
    // Exclude only 'draft' — every post-submit state counts as received.
    // Status flow: draft → submitted → auto_validated → exception → …review chain… → verified

    const [countyBreakdown, silentStations] = await Promise.all([
      // County-level submission coverage
      db
        .select({
          countyId: countiesTable.id,
          countyName: countiesTable.name,
          totalStations: sql<number>`CAST(COUNT(DISTINCT ${campaignStationProfilesTable.stationId}) AS INTEGER)`,
          // Count stations that have an agent assigned (not distinct agents, which undercounts
          // when one agent covers multiple stations)
          assignedStations: sql<number>`CAST(COUNT(DISTINCT CASE WHEN ${campaignStationProfilesTable.primaryAgentId} IS NOT NULL THEN ${campaignStationProfilesTable.stationId} END) AS INTEGER)`,
          // Count distinct stations covered, not submission rows (retries must not inflate coverage)
          submissionsReceived: sql<number>`CAST(COUNT(DISTINCT ${resultSubmissionsTable.pollingStationId}) AS INTEGER)`,
        })
        .from(countiesTable)
        .innerJoin(pollingStationsTable, eq(pollingStationsTable.countyId, countiesTable.id))
        .innerJoin(
          campaignStationProfilesTable,
          and(
            eq(campaignStationProfilesTable.stationId, pollingStationsTable.id),
            eq(campaignStationProfilesTable.tenantId, tenantId),
          ),
        )
        .leftJoin(
          resultSubmissionsTable,
          and(
            eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id),
            eq(resultSubmissionsTable.tenantId, tenantId),
            ne(resultSubmissionsTable.status, "draft"),
          ),
        )
        .groupBy(countiesTable.id, countiesTable.name)
        .orderBy(countiesTable.name),

      // Stations with assigned agent, no submitted result, last seen > 2 h ago
      db
        .select({
          stationId: pollingStationsTable.id,
          stationName: pollingStationsTable.name,
          stationCode: pollingStationsTable.code,
          countyName: countiesTable.name,
          constituencyName: constituenciesTable.name,
          wardName: wardsTable.name,
          primaryAgentId: campaignStationProfilesTable.primaryAgentId,
          lastSeenAt: agentSyncStatusTable.lastSeenAt,
          syncStatus: agentSyncStatusTable.syncStatus,
          pendingSubmissions: agentSyncStatusTable.pendingSubmissions,
        })
        .from(campaignStationProfilesTable)
        .innerJoin(pollingStationsTable, eq(pollingStationsTable.id, campaignStationProfilesTable.stationId))
        .innerJoin(countiesTable, eq(countiesTable.id, pollingStationsTable.countyId))
        .innerJoin(constituenciesTable, eq(constituenciesTable.id, pollingStationsTable.constituencyId))
        .innerJoin(wardsTable, eq(wardsTable.id, pollingStationsTable.wardId))
        .leftJoin(pollingAgentsTable, eq(pollingAgentsTable.id, campaignStationProfilesTable.primaryAgentId))
        .leftJoin(agentSyncStatusTable, eq(agentSyncStatusTable.agentId, pollingAgentsTable.id))
        .where(
          and(
            eq(campaignStationProfilesTable.tenantId, tenantId),
            isNotNull(campaignStationProfilesTable.primaryAgentId),
            // No accepted result submission for this station
            notExists(
              db
                .select({ x: sql`1` })
                .from(resultSubmissionsTable)
                .where(
                  and(
                    eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id),
                    eq(resultSubmissionsTable.tenantId, tenantId),
                    ne(resultSubmissionsTable.status, "draft"),
                  ),
                ),
            ),
            // Agent hasn't checked in for 2+ hours (or never)
            or(
              isNull(agentSyncStatusTable.lastSeenAt),
              lt(agentSyncStatusTable.lastSeenAt, sql`NOW() - INTERVAL '2 hours'`),
            ),
          ),
        )
        .orderBy(countiesTable.name, constituenciesTable.name, wardsTable.name, pollingStationsTable.name)
        .limit(200),
    ]);

    res.json({ countyBreakdown, silentStations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers for platform user routes ─────────────────────────────────────────

/** Resolve a Clerk user ID to the local users.id UUID (or null). */
async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row ? row.id : null;
}

async function resolveActorFull(clerkId: string) {
  const [row] = await db
    .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row ?? null;
}

/** Get a user with all of their role assignments (all tenants) and geographic scope names. */
async function getPlatformUserDetail(userId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;

  const assignments = await db
    .select({
      assignmentId: userRolesTable.id,
      tenantId: userRolesTable.tenantId,
      tenantName: tenantsTable.name,
      tenantSlug: tenantsTable.slug,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      roleSlug: rolesTable.slug,
      roleLevel: rolesTable.level,
      countyId: userRolesTable.countyId,
      countyName: countiesTable.name,
      constituencyId: userRolesTable.constituencyId,
      constituencyName: constituenciesTable.name,
      wardId: userRolesTable.wardId,
      wardName: wardsTable.name,
      assignedBy: userRolesTable.assignedBy,
      createdAt: userRolesTable.createdAt,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .leftJoin(tenantsTable, eq(userRolesTable.tenantId, tenantsTable.id))
    .leftJoin(countiesTable, eq(userRolesTable.countyId, countiesTable.id))
    .leftJoin(constituenciesTable, eq(userRolesTable.constituencyId, constituenciesTable.id))
    .leftJoin(wardsTable, eq(userRolesTable.wardId, wardsTable.id))
    .where(eq(userRolesTable.userId, userId))
    .orderBy(desc(userRolesTable.createdAt));

  return { ...user, assignments };
}

// ── GET /api/platform/users ───────────────────────────────────────────────────
// Cross-tenant user search. Searchable by email or full name.
// Query params: q (search string), tenantId (filter), page, limit
router.get("/users", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    const filterTenantId = req.query.tenantId as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string ?? "50", 10)));
    const offset = (page - 1) * limit;

    // Build WHERE conditions on the users table
    const searchConditions = q.length > 0
      ? or(ilike(usersTable.email, `%${q}%`), ilike(usersTable.fullName, `%${q}%`))
      : undefined;

    // When tenantId is provided we must JOIN user_roles BEFORE pagination so that
    // we only paginate over users who actually belong to that tenant — not the full
    // user table. Post-pagination filtering would break page sizes and counts.
    let users: Array<{ id: string; email: string; fullName: string; status: string; isGlobalAdmin: boolean; lastLoginAt: Date | null; createdAt: Date }>;

    if (filterTenantId) {
      // Inner join constrains the candidate set to members of the target tenant
      users = await db
        .selectDistinctOn([usersTable.id], {
          id: usersTable.id,
          email: usersTable.email,
          fullName: usersTable.fullName,
          status: usersTable.status,
          isGlobalAdmin: usersTable.isGlobalAdmin,
          lastLoginAt: usersTable.lastLoginAt,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .innerJoin(
          userRolesTable,
          and(
            eq(userRolesTable.userId, usersTable.id),
            eq(userRolesTable.tenantId, filterTenantId),
          ),
        )
        .where(searchConditions)
        .orderBy(usersTable.id, desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset);
    } else {
      users = await db
        .selectDistinctOn([usersTable.id], {
          id: usersTable.id,
          email: usersTable.email,
          fullName: usersTable.fullName,
          status: usersTable.status,
          isGlobalAdmin: usersTable.isGlobalAdmin,
          lastLoginAt: usersTable.lastLoginAt,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(searchConditions)
        .orderBy(usersTable.id, desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset);
    }

    if (users.length === 0) {
      return res.json({ users: [], page, limit });
    }

    const userIds = users.map((u) => u.id);

    // Fetch all tenant memberships for the result set
    const membershipRows = await db
      .select({
        userId: userRolesTable.userId,
        tenantId: tenantsTable.id,
        tenantName: tenantsTable.name,
        tenantSlug: tenantsTable.slug,
        roleCount: sql<number>`CAST(COUNT(*) AS INTEGER)`,
      })
      .from(userRolesTable)
      .innerJoin(tenantsTable, eq(userRolesTable.tenantId, tenantsTable.id))
      .where(inArray(userRolesTable.userId, userIds))
      .groupBy(userRolesTable.userId, tenantsTable.id, tenantsTable.name, tenantsTable.slug);

    const membershipMap: Record<string, Array<{ tenantId: string; tenantName: string; tenantSlug: string; roleCount: number }>> = {};
    for (const row of membershipRows) {
      if (!membershipMap[row.userId]) membershipMap[row.userId] = [];
      membershipMap[row.userId].push({
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        roleCount: row.roleCount,
      });
    }

    const result = users.map((u) => ({ ...u, tenants: membershipMap[u.id] ?? [] }));
    res.json({ users: result, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/users/:id ───────────────────────────────────────────────
router.get("/users/:id", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const user = await getPlatformUserDetail(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/platform/users/:id/roles ───────────────────────────────────────
// Assign a role to any user across any tenant. Writes an audit entry.
router.post("/users/:id/roles", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { tenantId, roleId, countyId, constituencyId, wardId } = req.body as {
      tenantId?: string;
      roleId?: string;
      countyId?: string;
      constituencyId?: string;
      wardId?: string;
    };
    if (!roleId) return res.status(400).json({ error: "roleId is required" });

    // Verify target user exists
    const [targetUser] = await db
      .select({ id: usersTable.id, clerkId: usersTable.clerkId, email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, req.params.id))
      .limit(1);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Verify role exists
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actor = await resolveActorFull(req.clerkId);

    // The grant and its audit record commit in one transaction.
    const [assignment] = await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(userRolesTable)
        .values({
          userId: req.params.id,
          roleId,
          tenantId: tenantId ?? null,
          countyId: countyId ?? null,
          constituencyId: constituencyId ?? null,
          wardId: wardId ?? null,
          assignedBy: actor?.id ?? null,
        })
        .returning();

      await recordPlatformAction(
        req,
        {
          action: "assign_role",
          resource: "user_role",
          tenantId: tenantId ?? null,
          resourceId: a.id,
          details: { userId: req.params.id, roleId, roleName: role.name, tenantId: tenantId ?? null },
        },
        tx,
      );
      return [a];
    });

    // Evict role cache for the target user
    bustActorCache(targetUser.clerkId);

    const updated = await getPlatformUserDetail(req.params.id);
    res.status(201).json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/platform/users/:id/roles/:roleAssignmentId ───────────────────
// Remove a specific role assignment. Writes an audit entry.
router.delete("/users/:id/roles/:roleAssignmentId", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id, roleAssignmentId } = req.params;

    // Verify target user exists and owns this assignment
    const [targetUser] = await db
      .select({ id: usersTable.id, clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const [existing] = await db
      .select({
        id: userRolesTable.id,
        tenantId: userRolesTable.tenantId,
        roleId: userRolesTable.roleId,
        roleName: rolesTable.name,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(and(eq(userRolesTable.id, roleAssignmentId), eq(userRolesTable.userId, id)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Role assignment not found" });

    // The revocation and its audit record commit in one transaction.
    await db.transaction(async (tx) => {
      await tx
        .delete(userRolesTable)
        .where(and(eq(userRolesTable.id, roleAssignmentId), eq(userRolesTable.userId, id)));

      await recordPlatformAction(
        req,
        {
          action: "remove_role",
          resource: "user_role",
          tenantId: existing.tenantId ?? null,
          resourceId: roleAssignmentId,
          prior: { userId: id, roleId: existing.roleId, roleName: existing.roleName, tenantId: existing.tenantId },
        },
        tx,
      );
    });

    // Evict role cache
    bustActorCache(targetUser.clerkId);

    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/roles ───────────────────────────────────────────────────
// All available roles — used by the role inspector UI to populate dropdowns.
router.get("/roles", requireAuth, requireLevel(0), async (_req: any, res: any) => {
  try {
    const roles = await db.select().from(rolesTable).orderBy(rolesTable.level, rolesTable.name);
    res.json(roles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
