import { Router } from "express";
import { getAuth } from "@clerk/express";
import { promises as dnsPromises } from "dns";
import { db } from "@workspace/db";
import { brandingTable, systemConfigTable, tenantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { resolveTenant, resolveTenantPublic, resolveTenantMixed } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant, requireTenantContext } from "../lib/withTenant";
import { triggerTlsProvisioning } from "../lib/tlsCert";
import { PLANS, getEffectivePlan, minimumTierFor } from "../lib/plans";

// ── DNS CNAME verification ────────────────────────────────────────────────────
// The expected CNAME target is the platform's public hostname (PORTAL_DOMAIN).
// Admins must point their custom domain at this value before it will be accepted.
const PORTAL_DOMAIN = (process.env.PORTAL_DOMAIN ?? "ushindi.app").toLowerCase();

/**
 * Returns true if `hostname` has a CNAME record pointing at PORTAL_DOMAIN
 * (or any subdomain of it, e.g. custom.ushindi.app).
 * Returns false on any DNS error or missing record.
 */
async function verifyCname(hostname: string): Promise<boolean> {
  try {
    const cnames = await dnsPromises.resolveCname(hostname);
    return cnames.some((c) => {
      const normalised = c.toLowerCase().replace(/\.$/, ""); // strip trailing dot
      return normalised === PORTAL_DOMAIN || normalised.endsWith(`.${PORTAL_DOMAIN}`);
    });
  } catch {
    return false;
  }
}

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// Only national-level leadership and comms roles may change branding
const canUpdateBranding = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "communications-officer",
  "content-approver",
]);

// GET /api/config/branding — public + authenticated endpoint.
// resolveTenantMixed checks:
//   authenticated requests → the caller's app-owned membership (cannot be spoofed)
//   unauthenticated requests → X-Tenant-Slug header or ?tenant= query param
// This allows the mobile app and the web frontend (via subdomain) to both
// resolve the correct campaign's branding.
router.get("/branding", resolveTenantMixed, async (req: any, res: any) => {
  try {
    const t = (req as any).tenant as import("../lib/withTenant").TenantInfo | undefined;
    const neutral = {
      isTenant: false,
      campaignName: "Your Campaign",
      candidateName: "Your Candidate",
      positionTitle: "Your Position",
      partyName: "Your Party",
      primaryColor: "209 88% 50%",
      secondaryColor: "0 0% 8%",
      accentColor: "0 0% 8%",
      logoUrl: null,
      faviconUrl: null,
      tagline: "Your Campaign Tagline",
      electionYear: new Date().getFullYear() + 1,
      mpesaPaybill: "",
      electionLevel: "Presidential",
      websiteUrl: null,
      socialTwitter: null,
      socialFacebook: null,
      socialInstagram: null,
      updatedAt: new Date().toISOString(),
    };

    if (!t) {
      return res.json(neutral);
    }
    const [branding] = await db
      .select()
      .from(brandingTable)
      .where(tenantFilter(brandingTable, t.id))
      .limit(1);

    if (!branding) {
      // Tenant resolved but no branding row yet — still a real tenant
      return res.json({ ...neutral, isTenant: true });
    }
    res.json({ isTenant: true, ...branding, updatedAt: branding.updatedAt?.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/config/branding
router.patch("/branding", requireAuth, resolveTenant, canUpdateBranding, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const {
      campaignName, candidateName, positionTitle, partyName,
      primaryColor, secondaryColor, accentColor,
      logoUrl, faviconUrl, tagline, electionYear, mpesaPaybill, electionLevel, websiteUrl,
      socialTwitter, socialFacebook, socialInstagram,
      heroSubtagline, primaryCtaLabel, primaryCtaUrl, secondaryCtaLabel, secondaryCtaUrl,
    } = req.body;

    const updates: any = {};
    if (campaignName !== undefined) updates.campaignName = campaignName;
    if (candidateName !== undefined) updates.candidateName = candidateName;
    if (positionTitle !== undefined) updates.positionTitle = positionTitle;
    if (partyName !== undefined) updates.partyName = partyName;
    if (primaryColor !== undefined) updates.primaryColor = primaryColor;
    if (secondaryColor !== undefined) updates.secondaryColor = secondaryColor;
    if (accentColor !== undefined) updates.accentColor = accentColor;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (faviconUrl !== undefined) updates.faviconUrl = faviconUrl;
    if (tagline !== undefined) updates.tagline = tagline;
    if (electionYear !== undefined) updates.electionYear = electionYear;
    if (mpesaPaybill !== undefined) updates.mpesaPaybill = mpesaPaybill;
    if (electionLevel !== undefined) updates.electionLevel = electionLevel;
    if (websiteUrl !== undefined) updates.websiteUrl = websiteUrl;
    if (socialTwitter !== undefined) updates.socialTwitter = socialTwitter;
    if (socialFacebook !== undefined) updates.socialFacebook = socialFacebook;
    if (socialInstagram !== undefined) updates.socialInstagram = socialInstagram;
    // Hero copy fields
    if (heroSubtagline !== undefined) updates.heroSubtagline = heroSubtagline || null;
    if (primaryCtaLabel !== undefined) updates.primaryCtaLabel = primaryCtaLabel || null;
    if (primaryCtaUrl !== undefined) updates.primaryCtaUrl = primaryCtaUrl || null;
    if (secondaryCtaLabel !== undefined) updates.secondaryCtaLabel = secondaryCtaLabel || null;
    if (secondaryCtaUrl !== undefined) updates.secondaryCtaUrl = secondaryCtaUrl || null;

    const [existing] = await db
      .select()
      .from(brandingTable)
      .where(tenantFilter(brandingTable, t.id))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(brandingTable)
        .set(updates)
        .where(and(eq(brandingTable.id, existing.id), tenantFilter(brandingTable, t.id)))
        .returning();
    } else {
      [result] = await db
        .insert(brandingTable)
        .values({ ...updates, tenantId: t.id })
        .returning();
    }

    res.json({ ...result, updatedAt: result.updatedAt?.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/config/domain ─────────────────────────────────────────────────
// Returns the tenant's current custom domain plus a live DNS verification result.
router.get("/domain", requireAuth, resolveTenant, requireTenantContext, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [tenant] = await db
      .select({
        slug: tenantsTable.slug,
        customDomain: tenantsTable.customDomain,
        tlsStatus: tenantsTable.tlsStatus,
        tlsCertError: tenantsTable.tlsCertError,
        tlsProvisionedAt: tenantsTable.tlsProvisionedAt,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, t.id))
      .limit(1);

    const customDomain = tenant?.customDomain ?? null;
    // Run DNS check inline (single UDP lookup — fast); null when no domain is set
    const dnsVerified = customDomain ? await verifyCname(customDomain) : null;

    res.json({
      slug: tenant?.slug ?? null,
      customDomain,
      dnsVerified,
      tlsStatus: tenant?.tlsStatus ?? null,
      tlsCertError: tenant?.tlsCertError ?? null,
      tlsProvisionedAt: tenant?.tlsProvisionedAt?.toISOString() ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/config/domain ───────────────────────────────────────────────
// Lets campaign admins set or clear their custom domain.
// When setting a domain, the API verifies the CNAME record first so only
// correctly-pointed domains can be activated.
const canUpdateDomain = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
]);

router.patch("/domain", requireAuth, resolveTenant, requireTenantContext, canUpdateDomain, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { customDomain } = req.body as { customDomain?: string | null };

    // Normalise: lowercase, strip protocol, strip trailing slash
    const normalised = customDomain
      ? customDomain.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || null
      : null;

    // Basic hostname validation when a value is provided
    if (normalised && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalised)) {
      return res.status(400).json({ error: "Invalid domain format. Use e.g. vote.example.ke" });
    }

    // Custom domains are a paid feature. This gate must live here as well as on
    // the settings request queue — otherwise this older direct mutator hands the
    // feature to Free and lapsed campaigns for free.
    // Clearing a domain is always allowed, so a downgraded campaign can still
    // tidy up after losing the entitlement.
    if (normalised) {
      // resolveTenant only carries identity fields, so read the billing columns
      // the plan resolver needs.
      const [planRow] = await db
        .select({
          plan: tenantsTable.plan,
          planOverrideUntil: tenantsTable.planOverrideUntil,
          stripeSubscriptionStatus: tenantsTable.stripeSubscriptionStatus,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, t.id))
        .limit(1);

      const effective = getEffectivePlan(planRow ?? { plan: "free" });
      if (!PLANS[effective.plan].customDomain) {
        return res.status(402).json({
          error: `Custom domains require the ${PLANS[minimumTierFor("customDomain")!].label} plan.`,
          feature: "customDomain",
          currentPlan: effective.plan,
          requiredPlan: minimumTierFor("customDomain"),
        });
      }
    }

    // DNS verification — required before a domain can be saved.
    // Clearing the domain (null) always succeeds without a DNS check.
    if (normalised) {
      const cnameOk = await verifyCname(normalised);
      if (!cnameOk) {
        return res.status(422).json({
          error: "CNAME not yet detected — please add the DNS record and retry",
          hint: `Add a CNAME record: ${normalised} → ${PORTAL_DOMAIN}`,
          dnsVerified: false,
        });
      }
    }

    // When clearing the domain, also clear TLS state
    const [updated] = await db
      .update(tenantsTable)
      .set({
        customDomain: normalised,
        ...(normalised
          ? {}
          : { tlsStatus: null, tlsCertError: null, tlsProvisionedAt: null }),
      })
      .where(eq(tenantsTable.id, t.id))
      .returning({ slug: tenantsTable.slug, customDomain: tenantsTable.customDomain });

    // Trigger async TLS provisioning when a new domain is being saved
    if (normalised) {
      triggerTlsProvisioning(t.id, normalised).catch(() => {});
    }

    res.json({
      slug: updated.slug,
      customDomain: updated.customDomain,
      dnsVerified: !!normalised,
      tlsStatus: normalised ? "pending" : null,
    });
  } catch (err: any) {
    // Unique-constraint violation → domain already in use.
    // Drizzle ORM wraps the underlying postgres error in DrizzleQueryError,
    // so the PostgreSQL SQLSTATE code lives at err.cause?.code, not err.code.
    const pgCode: string | undefined = err.code ?? err.cause?.code;
    if (pgCode === "23505") {
      return res.status(409).json({ error: "That domain is already registered to another campaign." });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/config/domain/check ─────────────────────────────────────────
// Re-checks DNS for the tenant's current custom domain without changing it.
// Powers the "Re-check DNS" button in the Branding UI.
router.post("/domain/check", requireAuth, resolveTenant, canUpdateDomain, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [tenant] = await db
      .select({ customDomain: tenantsTable.customDomain })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, t.id))
      .limit(1);

    if (!tenant?.customDomain) {
      return res.status(400).json({ error: "No custom domain is set for this campaign." });
    }

    const dnsVerified = await verifyCname(tenant.customDomain);
    res.json({ customDomain: tenant.customDomain, dnsVerified });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/config/domain/cert/retry ────────────────────────────────────
// Re-triggers TLS certificate provisioning for the current custom domain.
// Returns immediately (202 Accepted) — the result is polled via GET /domain.
router.post("/domain/cert/retry", requireAuth, resolveTenant, canUpdateDomain, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [tenant] = await db
      .select({ customDomain: tenantsTable.customDomain })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, t.id))
      .limit(1);

    if (!tenant?.customDomain) {
      return res.status(400).json({ error: "No custom domain is set for this campaign." });
    }

    // Fire async — client polls GET /domain for the updated status
    triggerTlsProvisioning(t.id, tenant.customDomain).catch(() => {});

    res.status(202).json({
      message: "Certificate check started. Poll GET /api/config/domain for status.",
      tlsStatus: "pending",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config/system
router.get("/system", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const configs = await db
      .select()
      .from(systemConfigTable)
      .where(tenantFilter(systemConfigTable, t.id));

    const map: Record<string, string> = {};
    for (const c of configs) map[c.key] = c.value;

    res.json({
      maintenanceMode: map["maintenance_mode"] === "true",
      registrationOpen: map["registration_open"] !== "false",
      twoFactorRequired: map["two_factor_required"] === "true",
      sessionTimeoutMinutes: Number(map["session_timeout_minutes"] || "60"),
      maxLoginAttempts: Number(map["max_login_attempts"] || "5"),
      passwordMinLength: Number(map["password_min_length"] || "8"),
      auditRetentionDays: Number(map["audit_retention_days"] || "365"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
