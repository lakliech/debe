/**
 * Self-serve campaign registration.
 *
 * Lets a signed-in Clerk user who has no campaign yet create one without a
 * platform admin provisioning it by hand. Mounted at /api/register with NO
 * resolveTenant wrapper — by definition the caller has no tenant yet.
 *
 * Flow (all in one transaction — membership is owned by the app, so no
 * external system needs to be provisioned or rolled back):
 *   1. Validate + reserve the slug
 *   2. Insert the tenant row with a 14-day Pro trial
 *   3. Seed branding from the submitted campaign details
 *   4. Grant the caller Super Administrator (level 1) for that tenant
 *   5. Send the welcome email
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
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
import { clerkUserEmail, clerkUserName } from "../lib/clerkAdmin";
import { TRIAL_DAYS } from "../lib/plans";
import { platformUrl } from "../lib/stripe";
import { bustActorCache } from "../middlewares/rbac";
import {
  normalizeScope,
  scopeGeographyExists,
  ScopeValidationError,
  SEAT_LABELS,
  type NormalizedScope,
} from "../lib/campaignScope";

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

/**
 * Registration creates a tenant, a trial and an email — expensive, and abusable
 * for slug-squatting. Cap it hard per IP; a genuine founder registers once.
 * req.ip is the proxy-validated client address (app.ts sets trust proxy).
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: {
    error: "Too many registration attempts from this device — please wait an hour and try again.",
  },
});

/**
 * The form checks availability on every debounced keystroke, so this needs a
 * far higher ceiling than a submission — high enough for genuine typing, low
 * enough that nobody enumerates the full tenant list from it.
 */
const slugCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "Too many availability checks — please wait a few minutes and try again." },
});

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

// ── GET /api/register/campaign/check-slug?slug=my-campaign ───────────────────
// Live availability check for the registration form.
// Also served at /api/register/check-slug — the original path, kept so any
// client built against it keeps working.
const checkSlugHandler = async (req: any, res: any) => {
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
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

router.get("/campaign/check-slug", slugCheckLimiter, requireAuth, checkSlugHandler);
router.get("/check-slug", slugCheckLimiter, requireAuth, checkSlugHandler);

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
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /api/register/campaign ──────────────────────────────────────────────
// Also served at POST /api/register — the original path, kept so any client
// built against it keeps working.
const registerCampaignHandler = async (req: any, res: any) => {
  const {
    campaignName,
    slug: rawSlug,
    candidateName,
    electionLevel,
    electionYear,
    primaryColor,
    tagline,
    contactEmail,
    seatType,
    scopeCountyId,
    scopeConstituencyId,
    scopeWardId,
  } = req.body as Record<string, string | number | undefined>;

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

    // Campaign scope is required from day one — every campaign contests a
    // seat, and the geography selection must match that seat's level.
    let scope: NormalizedScope;
    try {
      scope = normalizeScope({ seatType, scopeCountyId, scopeConstituencyId, scopeWardId });
    } catch (err) {
      if (err instanceof ScopeValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const geoProblem = await scopeGeographyExists(scope);
    if (geoProblem) return res.status(400).json({ error: geoProblem });

    // Resolve or create the local user row for the caller.
    // The signed-in account's own Clerk address is authoritative for the user
    // row. contactEmail is campaign contact detail from the request body and
    // must not decide who this user is — privilege decisions read this column's
    // owner, so letting a caller set it to someone else's address is an
    // impersonation vector.
    const email =
      (await clerkUserEmail(req.clerkId)) ??
      (typeof contactEmail === "string" && contactEmail ? contactEmail : null);
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

    // ── Database work (one transaction — rolls back cleanly on failure) ───────
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

    const tenant = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tenantsTable)
        .values({
          name: campaignName.trim(),
          slug,
          // Trial grants Pro; planOverrideUntil is what actually enforces it.
          plan: "pro",
          planOverrideUntil: trialEndsAt,
          trialUsed: true,
          lifecycleState: "active",
          billingEmail: email ?? null,
          ...scope,
        })
        .returning();

      // Only set fields the founder actually provided — the branding columns
      // are NOT NULL with sensible defaults, so passing explicit nulls would
      // violate the constraints instead of falling back to the defaults.
      await tx.insert(brandingTable).values({
        tenantId: t.id,
        campaignName: campaignName.trim(),
        ...(typeof candidateName === "string" && candidateName ? { candidateName } : {}),
        ...(typeof tagline === "string" && tagline ? { tagline } : {}),
        ...(electionYear ? { electionYear: Number(electionYear) } : {}),
        // Branding's display label — explicit electionLevel wins; otherwise
        // derive it from the (now required) campaign scope seat.
        electionLevel:
          typeof electionLevel === "string" && electionLevel
            ? electionLevel
            : SEAT_LABELS[scope.seatType],
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
    // Every pre-check above races with concurrent requests — the database
    // unique constraints are the real arbiters. Translate their violations
    // into the same clean 409s instead of unhandled 500s. Drizzle wraps pg
    // errors: the SQLSTATE and constraint name live on err.cause, never the
    // wrapper message.
    const cause = (err as any)?.cause ?? err;
    if (cause?.code === "23505") {
      const constraint = String(cause?.constraint ?? "");
      // Two campaigns racing for the same web address.
      if (constraint.includes("slug")) {
        return res.status(409).json({ error: "That web address is already taken." });
      }
      // Same person double-submitting (double-click, retry on a slow
      // network): users.clerk_id / users.email / user_roles uniqueness.
      if (constraint.includes("user")) {
        return res.status(409).json({
          error:
            "You already belong to a campaign. Contact support if you need to run more than one.",
        });
      }
    }
    logger.error({ err }, "[register] failed");

    res.status(500).json({ error: "We couldn't create your campaign. Please try again." });
  }
};

router.post("/campaign", registerLimiter, requireAuth, registerCampaignHandler);
router.post("/", registerLimiter, requireAuth, registerCampaignHandler);

export default router;
