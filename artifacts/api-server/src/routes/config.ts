import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { brandingTable, systemConfigTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { resolveTenant, resolveTenantPublic } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant } from "../lib/withTenant";

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

// GET /api/config/branding — public endpoint; tenant resolved from X-Tenant-Slug header or ?tenant= param
router.get("/branding", resolveTenantPublic, async (req: any, res: any) => {
  try {
    const t = (req as any).tenant as import("../lib/withTenant").TenantInfo | undefined;
    const neutral = {
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
      return res.json(neutral);
    }
    res.json({ ...branding, updatedAt: branding.updatedAt?.toISOString() });
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
