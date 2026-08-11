/**
 * Campaign admin settings hub.
 *
 * One place for a campaign admin to see and manage everything about their own
 * campaign: profile, plan, team size, web address, onboarding progress, and
 * account closure. Mounted at /api/settings behind resolveTenant.
 *
 * Slug and custom-domain changes are NOT applied directly — they break live
 * links and public portal URLs, so they go through a request queue that a
 * platform admin actions. Same for deletion.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  tenantsTable,
  brandingTable,
  usersTable,
  userRolesTable,
  rolesTable,
  campaignStationProfilesTable,
  pollingAgentsTable,
  domainChangeRequestsTable,
  deletionRequestsTable,
  onboardingProgressTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";
import { logger } from "../lib/logger";
import {
  normalizeScope,
  scopeGeographyExists,
  ScopeValidationError,
} from "../lib/campaignScope";
import { PLANS, getEffectivePlan } from "../lib/plans";
import { requirePlanFeatureWhen } from "../middlewares/requirePlan";
import { stripeConfigured } from "../lib/stripe";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

function assertTenant(req: any, res: any): string | null {
  const id = req.tenant?.id;
  if (!id) {
    res.status(400).json({ error: "No campaign context for this request." });
    return null;
  }
  return id;
}

async function actorId(clerkId: string): Promise<string | null> {
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return u?.id ?? null;
}

/** Branding defaults that mean "the admin hasn't set this yet". */
const DEFAULT_CAMPAIGN_NAME = "Your Campaign";
const DEFAULT_CANDIDATE_NAME = "Your Candidate";
const DEFAULT_TAGLINE = "Your Campaign Tagline";
const DEFAULT_PRIMARY = "209 88% 50%";

/**
 * Compute the onboarding checklist from live data rather than stored flags.
 * Flags drift when an admin undoes something; derived state cannot.
 * Only `dismissed` is persisted.
 */
async function buildOnboarding(tenantId: string) {
  const [branding] = await db
    .select()
    .from(brandingTable)
    .where(eq(brandingTable.tenantId, tenantId))
    .limit(1);

  const [{ n: teamCount } = { n: 0 }] = (await db
    .select({ n: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)` })
    .from(userRolesTable)
    .where(eq(userRolesTable.tenantId, tenantId))) as Array<{ n: number }>;

  const [{ n: stationCount } = { n: 0 }] = (await db
    .select({ n: sql<number>`CAST(COUNT(*) AS INTEGER)` })
    .from(campaignStationProfilesTable)
    .where(eq(campaignStationProfilesTable.tenantId, tenantId))) as Array<{ n: number }>;

  const [progress] = await db
    .select()
    .from(onboardingProgressTable)
    .where(eq(onboardingProgressTable.tenantId, tenantId))
    .limit(1);

  const steps = [
    {
      key: "logo",
      label: "Upload your campaign logo",
      description: "Appears on the portal, dashboard and mobile app.",
      href: "/settings?tab=branding",
      done: !!branding?.logoUrl,
    },
    {
      key: "colours",
      label: "Set your brand colours",
      description: "Your primary colour themes the whole platform.",
      href: "/settings?tab=branding",
      done: !!branding && branding.primaryColor !== DEFAULT_PRIMARY,
    },
    {
      key: "profile",
      label: "Complete your campaign profile",
      description: "Candidate name, position and tagline.",
      href: "/settings?tab=branding",
      done:
        !!branding &&
        branding.campaignName !== DEFAULT_CAMPAIGN_NAME &&
        branding.candidateName !== DEFAULT_CANDIDATE_NAME &&
        branding.tagline !== DEFAULT_TAGLINE,
    },
    {
      key: "team",
      label: "Invite your team",
      description: "Add coordinators and officers to your campaign.",
      href: "/users",
      done: Number(teamCount) > 1,
    },
    {
      key: "stations",
      label: "Configure your polling stations",
      description: "Choose the stations your agents will cover.",
      href: "/polling-stations",
      done: Number(stationCount) > 0,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    allDone: completed === steps.length,
    dismissed: !!progress?.dismissed,
  };
}

// ── GET /api/settings/overview ───────────────────────────────────────────────
router.get("/overview", requireAuth, requireLevel(2), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });

    const [branding] = await db
      .select()
      .from(brandingTable)
      .where(eq(brandingTable.tenantId, tenantId))
      .limit(1);

    const [{ n: teamCount } = { n: 0 }] = (await db
      .select({ n: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)` })
      .from(userRolesTable)
      .where(eq(userRolesTable.tenantId, tenantId))) as Array<{ n: number }>;

    const [{ n: agentCount } = { n: 0 }] = (await db
      .select({ n: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(pollingAgentsTable)
      .where(eq(pollingAgentsTable.tenantId, tenantId))) as Array<{ n: number }>;

    const [{ n: stationCount } = { n: 0 }] = (await db
      .select({ n: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(campaignStationProfilesTable)
      .where(eq(campaignStationProfilesTable.tenantId, tenantId))) as Array<{ n: number }>;

    const effective = getEffectivePlan(tenant);
    const limits = PLANS[effective.plan];

    const [pendingDomain] = await db
      .select()
      .from(domainChangeRequestsTable)
      .where(
        and(
          eq(domainChangeRequestsTable.tenantId, tenantId),
          eq(domainChangeRequestsTable.status, "pending"),
        ),
      )
      .orderBy(desc(domainChangeRequestsTable.createdAt))
      .limit(1);

    const [pendingDeletion] = await db
      .select()
      .from(deletionRequestsTable)
      .where(
        and(
          eq(deletionRequestsTable.tenantId, tenantId),
          eq(deletionRequestsTable.status, "pending"),
        ),
      )
      .orderBy(desc(deletionRequestsTable.createdAt))
      .limit(1);

    // Resolve the scope geography names (with parent ids) so the client can
    // display the chain and pre-fill the edit form's cascading pickers.
    const [scopeCounty] = tenant.scopeCountyId
      ? await db
          .select({ id: countiesTable.id, name: countiesTable.name })
          .from(countiesTable)
          .where(eq(countiesTable.id, tenant.scopeCountyId))
          .limit(1)
      : [null];
    const [scopeConstituency] = tenant.scopeConstituencyId
      ? await db
          .select({ id: constituenciesTable.id, name: constituenciesTable.name, countyId: constituenciesTable.countyId })
          .from(constituenciesTable)
          .where(eq(constituenciesTable.id, tenant.scopeConstituencyId))
          .limit(1)
      : [null];
    const [scopeWard] = tenant.scopeWardId
      ? await db
          .select({ id: wardsTable.id, name: wardsTable.name, constituencyId: wardsTable.constituencyId, countyId: wardsTable.countyId })
          .from(wardsTable)
          .where(eq(wardsTable.id, tenant.scopeWardId))
          .limit(1)
      : [null];

    res.json({
      campaign: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        customDomain: tenant.customDomain,
        tlsStatus: tenant.tlsStatus,
        createdAt: tenant.createdAt,
        lifecycleState: tenant.lifecycleState,
        scheduledDeletionAt: tenant.scheduledDeletionAt,
        isSuspended: tenant.isSuspended,
        seatType: tenant.seatType,
        scopeCounty: scopeCounty ?? null,
        scopeConstituency: scopeConstituency ?? null,
        scopeWard: scopeWard ?? null,
      },
      branding: branding ?? null,
      plan: {
        current: effective.plan,
        label: PLANS[effective.plan].label,
        isTrial: effective.isTrial,
        trialDaysLeft: effective.trialDaysLeft,
        trialEndsAt: effective.trialEndsAt,
        subscriptionStatus: tenant.stripeSubscriptionStatus,
        billingEmail: tenant.billingEmail,
        billingEnabled: stripeConfigured(),
      },
      usage: {
        team: Number(teamCount),
        agents: Number(agentCount),
        stations: Number(stationCount),
        maxAgents: limits.maxAgents,
        maxStations: limits.maxStations,
      },
      onboarding: await buildOnboarding(tenantId),
      pendingDomainRequest: pendingDomain ?? null,
      pendingDeletionRequest: pendingDeletion ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── GET /api/settings/onboarding ─────────────────────────────────────────────
router.get("/onboarding", requireAuth, async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;
    res.json(await buildOnboarding(tenantId));
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /api/settings/onboarding/dismiss ────────────────────────────────────
router.post("/onboarding/dismiss", requireAuth, requireLevel(2), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;
    const { dismissed = true } = req.body as { dismissed?: boolean };

    await db
      .insert(onboardingProgressTable)
      .values({ tenantId, dismissed })
      .onConflictDoUpdate({
        target: onboardingProgressTable.tenantId,
        set: { dismissed },
      });

    res.json(await buildOnboarding(tenantId));
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Campaign scope (seat + geography) ────────────────────────────────────────

// PATCH /api/settings/scope — set or change which seat the campaign contests.
// The seat's geography rule is enforced (see lib/campaignScope.ts); the
// tenants_scope_valid CHECK constraint mirrors it at the database layer.
router.patch("/scope", requireAuth, requireLevel(2), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    let scope;
    try {
      scope = normalizeScope(req.body ?? {});
    } catch (err) {
      if (err instanceof ScopeValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const geoProblem = await scopeGeographyExists(scope);
    if (geoProblem) return res.status(400).json({ error: geoProblem });

    await db.update(tenantsTable).set(scope).where(eq(tenantsTable.id, tenantId));
    res.json({ message: "Campaign scope updated.", scope });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Domain / web-address change requests ─────────────────────────────────────

router.get("/domain-requests", requireAuth, requireLevel(2), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;
    const rows = await db
      .select()
      .from(domainChangeRequestsTable)
      .where(eq(domainChangeRequestsTable.tenantId, tenantId))
      .orderBy(desc(domainChangeRequestsTable.createdAt))
      .limit(20);
    // Envelope shape — the Settings DomainTab reads data.requests.
    res.json({ requests: rows });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// A custom-domain request is only worth queueing if the campaign is entitled
// to the feature — refuse up front rather than leaving the admin waiting on a
// request the platform will reject. Slug changes are free on every plan.
const canRequestCustomDomain = requirePlanFeatureWhen(
  "customDomain",
  (req) => (req.body as any)?.kind === "custom_domain",
);

router.post("/domain-requests", requireAuth, requireLevel(1), canRequestCustomDomain, async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const { kind, requestedValue } = req.body as { kind?: string; requestedValue?: string };
    if (kind !== "slug" && kind !== "custom_domain") {
      return res.status(400).json({ error: "kind must be 'slug' or 'custom_domain'" });
    }
    const value = String(requestedValue ?? "").trim().toLowerCase();
    if (!value) return res.status(400).json({ error: "requestedValue is required" });

    if (kind === "slug" && !/^[a-z0-9-]{3,40}$/.test(value)) {
      return res
        .status(400)
        .json({ error: "Web address must be 3–40 lowercase letters, numbers or hyphens." });
    }
    if (kind === "custom_domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
      return res.status(400).json({ error: "Enter a valid domain, e.g. campaign.co.ke" });
    }

    const [existing] = await db
      .select({ id: domainChangeRequestsTable.id })
      .from(domainChangeRequestsTable)
      .where(
        and(
          eq(domainChangeRequestsTable.tenantId, tenantId),
          eq(domainChangeRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      return res
        .status(409)
        .json({ error: "You already have a pending web-address request. Wait for it to be reviewed." });
    }

    const [row] = await db
      .insert(domainChangeRequestsTable)
      .values({
        tenantId,
        requestedBy: await actorId(req.clerkId),
        kind,
        currentValue: kind === "slug" ? req.tenant.slug : req.tenant.customDomain,
        requestedValue: value,
      })
      .returning();

    res.status(201).json({
      request: row,
      message: "Request submitted. The platform team will review it shortly.",
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Account closure ──────────────────────────────────────────────────────────

router.get("/deletion-request", requireAuth, requireLevel(1), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;
    const [row] = await db
      .select()
      .from(deletionRequestsTable)
      .where(eq(deletionRequestsTable.tenantId, tenantId))
      .orderBy(desc(deletionRequestsTable.createdAt))
      .limit(1);
    res.json(row ?? null);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/deletion-request", requireAuth, requireLevel(1), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const { reason, confirmName } = req.body as { reason?: string; confirmName?: string };

    // Typing the campaign name is the guard against an accidental click.
    if (!confirmName || confirmName.trim() !== req.tenant.name) {
      return res.status(400).json({
        error: `Type the campaign name exactly ("${req.tenant.name}") to confirm.`,
      });
    }

    const [existing] = await db
      .select({ id: deletionRequestsTable.id })
      .from(deletionRequestsTable)
      .where(
        and(
          eq(deletionRequestsTable.tenantId, tenantId),
          eq(deletionRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(409).json({ error: "A deletion request is already pending review." });
    }

    const [row] = await db
      .insert(deletionRequestsTable)
      .values({
        tenantId,
        requestedBy: await actorId(req.clerkId),
        reason: typeof reason === "string" ? reason.slice(0, 2000) : null,
      })
      .returning();

    logger.warn({ tenantId }, "[settings] deletion requested");

    res.status(201).json({
      request: row,
      message:
        "Deletion request submitted. The platform team will contact you before anything is removed.",
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/deletion-request", requireAuth, requireLevel(1), async (req: any, res: any) => {
  try {
    const tenantId = assertTenant(req, res);
    if (!tenantId) return;

    const result = await db
      .update(deletionRequestsTable)
      .set({ status: "rejected", reviewNotes: "Withdrawn by the campaign." })
      .where(
        and(
          eq(deletionRequestsTable.tenantId, tenantId),
          eq(deletionRequestsTable.status, "pending"),
        ),
      )
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: "No pending deletion request to withdraw." });
    }
    res.json({ message: "Deletion request withdrawn." });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
