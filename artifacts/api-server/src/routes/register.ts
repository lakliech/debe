/**
 * Self-serve campaign registration.
 *
 * Lets a signed-in Clerk user who has no campaign yet create one without a
 * platform admin provisioning it by hand. Mounted at /api/register with NO
 * resolveTenant wrapper — by definition the caller has no tenant yet.
 *
 * Flow:
 *   1. Validate + reserve the slug
 *   2. Create the Clerk organisation and make the caller its admin
 *   3. Insert the tenant row with a 14-day Pro trial
 *   4. Seed branding from the submitted campaign details
 *   5. Grant the caller Super Administrator (level 1) for that tenant
 *   6. Send the welcome email
 *
 * Steps 3-6 run in a transaction where possible; the Clerk org is created
 * first because it is the only step we cannot roll back, and it is cleaned up
 * explicitly if the database work fails.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  tenantsTable,
  brandingTable,
  usersTable,
  rolesTable,
  userRolesTable,
  onboardingProgressTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendEmailAsync } from "../lib/email";
import { clerkPost, clerkDelete, clerkOrgsDisabled, clerkUserEmail, clerkUserName } from "../lib/clerkAdmin";
import { TRIAL_DAYS } from "../lib/plans";
import { platformUrl } from "../lib/stripe";
import { bustActorCache } from "../middlewares/rbac";

const router = Router();

/** Role granted to the person who registers a campaign. */
const FOUNDER_ROLE = "Super Administrator";

/** Slugs that must never become a tenant, because they collide with app routes. */
const RESERVED_SLUGS = new Set([
  "api", "app", "www", "admin", "platform", "dashboard", "settings", "billing",
  "register", "signin", "sign-in", "signup", "sign-up", "login", "logout",
  "pricing", "demo", "docs", "help", "support", "status", "blog", "about",
  "contact", "legal", "privacy", "terms", "static", "assets", "public",
  "health", "webhook", "webhooks", "stripe", "clerk", "auth", "onboarding",
]);

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function slugProblem(slug: string): string | null {
  if (!slug) return "Choose a web address for your campaign.";
  if (slug.length < 3) return "The web address must be at least 3 characters.";
  if (slug.length > 40) return "The web address must be 40 characters or fewer.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use lowercase letters, numbers and hyphens only.";
  if (/^-|-$/.test(slug)) return "The web address cannot start or end with a hyphen.";
  if (RESERVED_SLUGS.has(slug)) return `'${slug}' is reserved. Please choose another.`;
  return null;
}

async function slugTaken(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  return !!row;
}

// ── GET /api/register/check-slug?slug=my-campaign ────────────────────────────
// Live availability check for the registration form.
router.get("/check-slug", requireAuth, async (req: any, res: any) => {
  try {
    const raw = String(req.query.slug ?? "");
    const slug = slugify(raw);

    const problem = slugProblem(slug);
    if (problem) return res.json({ slug, available: false, reason: problem });

    if (await slugTaken(slug)) {
      return res.json({ slug, available: false, reason: "That web address is already taken." });
    }
    res.json({ slug, available: true, reason: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/register/status ─────────────────────────────────────────────────
// Does the signed-in user already belong to a campaign? Drives the post-signup
// redirect: existing members go to the dashboard, new users to registration.
router.get("/status", requireAuth, async (req: any, res: any) => {
  try {
    const [user] = await db
      .select({ id: usersTable.id, isGlobalAdmin: usersTable.isGlobalAdmin })
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkId))
      .limit(1);

    if (!user) {
      return res.json({ hasCampaign: false, isGlobalAdmin: false, campaigns: [] });
    }

    const campaigns = await db
      .selectDistinct({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
      })
      .from(userRolesTable)
      .innerJoin(tenantsTable, eq(tenantsTable.id, userRolesTable.tenantId))
      .where(eq(userRolesTable.userId, user.id));

    res.json({
      hasCampaign: campaigns.length > 0,
      isGlobalAdmin: !!user.isGlobalAdmin,
      campaigns,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/register ───────────────────────────────────────────────────────
router.post("/", requireAuth, async (req: any, res: any) => {
  const {
    campaignName,
    slug: rawSlug,
    candidateName,
    electionLevel,
    electionYear,
    primaryColor,
    tagline,
    contactEmail,
  } = req.body as Record<string, string | number | undefined>;

  let createdOrgId: string | null = null;

  try {
    if (!campaignName || typeof campaignName !== "string" || campaignName.trim().length < 2) {
      return res.status(400).json({ error: "Enter your campaign name." });
    }

    const slug = slugify(String(rawSlug || campaignName));
    const problem = slugProblem(slug);
    if (problem) return res.status(400).json({ error: problem });
    if (await slugTaken(slug)) {
      return res.status(409).json({ error: "That web address is already taken." });
    }

    // Resolve or create the local user row for the caller.
    const email = (typeof contactEmail === "string" && contactEmail) || (await clerkUserEmail(req.clerkId));
    const fullName = (await clerkUserName(req.clerkId)) ?? "Campaign Administrator";

    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkId))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId: req.clerkId,
          email: email ?? `${req.clerkId}@placeholder.invalid`,
          fullName,
        })
        .returning();
    }

    // One campaign per founder via self-serve — keeps billing unambiguous.
    // Platform admins can still attach a user to extra tenants manually.
    const existingMemberships = await db
      .select({ tenantId: userRolesTable.tenantId })
      .from(userRolesTable)
      .where(and(eq(userRolesTable.userId, user.id), sql`${userRolesTable.tenantId} IS NOT NULL`))
      .limit(1);

    if (existingMemberships.length > 0) {
      return res.status(409).json({
        error:
          "You already belong to a campaign. Contact support if you need to run more than one.",
      });
    }

    // ── Clerk organisation (not transactional — cleaned up manually on failure)
    let clerkOrgId: string;
    if (clerkOrgsDisabled()) {
      clerkOrgId = `org_stub_${slug}_${Date.now()}`;
    } else {
      try {
        const org = await clerkPost("/organizations", {
          name: campaignName,
          slug,
          created_by_user_id: req.clerkId,
        });
        clerkOrgId = org.id;
        createdOrgId = org.id;
      } catch (clerkErr: any) {
        logger.error({ err: clerkErr.message }, "[register] Clerk org creation failed");
        return res.status(502).json({
          error:
            "We couldn't finish setting up your campaign workspace. Please try again in a moment.",
        });
      }
    }

    // ── Database work ─────────────────────────────────────────────────────────
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

    const tenant = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tenantsTable)
        .values({
          name: campaignName.trim(),
          slug,
          clerkOrgId,
          // Trial grants Pro; planOverrideUntil is what actually enforces it.
          plan: "pro",
          planOverrideUntil: trialEndsAt,
          trialUsed: true,
          lifecycleState: "active",
          billingEmail: email ?? null,
        })
        .returning();

      await tx.insert(brandingTable).values({
        tenantId: t.id,
        campaignName: campaignName.trim(),
        candidateName: typeof candidateName === "string" && candidateName ? candidateName : null,
        tagline: typeof tagline === "string" && tagline ? tagline : null,
        electionYear:
          typeof electionYear === "number"
            ? electionYear
            : electionYear
              ? Number(electionYear)
              : null,
        ...(typeof electionLevel === "string" && electionLevel ? { electionLevel } : {}),
        ...(typeof primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(primaryColor)
          ? { primaryColor }
          : {}),
      } as any);

      const [role] = await tx
        .select({ id: rolesTable.id })
        .from(rolesTable)
        .where(eq(rolesTable.name, FOUNDER_ROLE))
        .limit(1);

      if (!role) throw new Error(`Role '${FOUNDER_ROLE}' is missing from the roles table`);

      await tx.insert(userRolesTable).values({
        userId: user!.id,
        roleId: role.id,
        tenantId: t.id,
      });

      await tx.insert(onboardingProgressTable).values({ tenantId: t.id });

      return t;
    });

    // Add the founder to the Clerk org as admin so their JWT carries the orgId.
    if (!clerkOrgsDisabled()) {
      try {
        await clerkPost(`/organizations/${clerkOrgId}/memberships`, {
          user_id: req.clerkId,
          role: "org:admin",
        });
      } catch (memErr: any) {
        // created_by_user_id usually adds them already; a duplicate is fine.
        logger.warn({ err: memErr.message }, "[register] org membership add skipped");
      }
    }

    // The caller's cached RBAC actor predates this tenant — clear it so the
    // very next request sees the new role instead of a stale "no access".
    bustActorCache(req.clerkId);

    if (email) {
      sendEmailAsync({
        to: email,
        tenantId: tenant.id,
        template: "campaign_welcome",
        data: {
          campaignName: tenant.name,
          adminName: fullName,
          dashboardUrl: `${platformUrl()}/dashboard`,
          trialDays: TRIAL_DAYS,
        },
      });
    }

    logger.info({ tenantId: tenant.id, slug }, "[register] campaign created");

    res.status(201).json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        trialEndsAt,
      },
      trialDays: TRIAL_DAYS,
      message: `${tenant.name} is ready. Your ${TRIAL_DAYS}-day Pro trial has started.`,
    });
  } catch (err: any) {
    logger.error({ err }, "[register] failed");

    // Roll back the Clerk org so a retry with the same slug isn't blocked.
    if (createdOrgId && !clerkOrgsDisabled()) {
      try {
        await clerkDelete(`/organizations/${createdOrgId}`);
      } catch (cleanupErr: any) {
        logger.error(
          { err: cleanupErr.message, orgId: createdOrgId },
          "[register] orphaned Clerk org — manual cleanup needed",
        );
      }
    }

    res.status(500).json({ error: "We couldn't create your campaign. Please try again." });
  }
});

export default router;
