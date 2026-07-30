/**
 * Platform administration routes — cross-tenant, super-operator only.
 *
 * These routes are NOT wrapped in resolveTenant so they can see all tenants.
 * Access is gated behind requireLevel(0) — only the platform_admin role (level 0)
 * passes. All other campaign roles start at level 1.
 *
 * Endpoints:
 *   GET    /api/platform/tenants          — list all tenants with user counts
 *   POST   /api/platform/tenants          — create Clerk org + tenant row + send invitation
 *   GET    /api/platform/tenants/:id      — single tenant detail
 *   PATCH  /api/platform/tenants/:id/suspend — toggle suspension
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  userRolesTable,
  brandingTable,
  campaignStationProfilesTable,
  resultSubmissionsTable,
  pollingAgentsTable,
  agentSyncStatusTable,
  pollingStationsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
} from "@workspace/db";
import { eq, sql, and, or, isNull, isNotNull, notExists, lt, gt, ne } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// ── Clerk Backend API helper (uses secret key directly — @clerk/backend is not a direct dep) ──
const CLERK_API = "https://api.clerk.com/v1";

async function clerkPost(path: string, body: Record<string, unknown>) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const res = await fetch(`${CLERK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) {
    // Surface the full Clerk error for easier debugging
    const clerkMsg =
      json?.errors?.[0]?.long_message ??
      json?.errors?.[0]?.message ??
      JSON.stringify(json);
    throw new Error(`Clerk ${res.status}: ${clerkMsg}`);
  }
  return json;
}

/**
 * Returns true when running in dev with Clerk Organizations disabled.
 * Set CLERK_ORGS_DISABLED=true in .env to use stub org IDs locally.
 */
function clerkOrgsDisabled() {
  return process.env.CLERK_ORGS_DISABLED === "true";
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

    // Create Clerk organisation.
    // If CLERK_ORGS_DISABLED=true (local dev without Organizations enabled), use a stub ID.
    let clerkOrgId: string;
    if (clerkOrgsDisabled()) {
      clerkOrgId = `org_stub_${slug}_${Date.now()}`;
    } else {
      try {
        const org = await clerkPost("/organizations", {
          name,
          slug,
          created_by_user_id: req.clerkId,
        });
        clerkOrgId = org.id;
      } catch (clerkErr: any) {
        // Surface the full Clerk error so it's visible in logs and the UI
        console.error("[platform] Clerk org creation failed:", clerkErr.message);
        return res.status(502).json({
          error: `Failed to create Clerk organisation: ${clerkErr.message}`,
          hint: "If you are running locally without Clerk Organizations enabled, set CLERK_ORGS_DISABLED=true in your environment.",
        });
      }
    }

    // Insert tenant row
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name, slug, clerkOrgId, plan })
      .returning();

    // Send invitation to the designated admin email (best-effort — don't block tenant creation on failure)
    let invitationWarning: string | null = null;
    if (adminEmail) {
      try {
        await clerkPost(`/organizations/${clerkOrgId}/invitations`, {
          email_address: adminEmail,
          role: "org:admin",
          inviter_user_id: req.clerkId,
        });
      } catch (invErr: any) {
        invitationWarning = `Tenant created but invitation failed: ${invErr.message}`;
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

    const [tenant] = await db
      .update(tenantsTable)
      .set({ isSuspended })
      .where(eq(tenantsTable.id, id))
      .returning();

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

    await clerkPost(`/organizations/${tenant.clerkOrgId}/invitations`, {
      email_address: adminEmail,
      role: "org:admin",
      inviter_user_id: req.clerkId,
    });

    res.json({ message: `Invitation sent to ${adminEmail}` });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
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

export default router;
