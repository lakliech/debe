/**
 * Enrollment routes — new-user onboarding.
 *
 * Deliberately NOT tenant-mounted: applicants have no campaign membership yet,
 * so they have no tenant context. User-facing endpoints (campaigns, submit,
 * /me) work tenant-free; coordinator endpoints resolve the caller's tenant
 * via assertTenant like any staff route.
 *
 * GET  /campaigns        — campaigns open to join (auth)
 * POST /                 — submit an enrollment application (auth)
 * GET  /me               — the caller's own applications + status (auth)
 * GET  /                 — pending queue (coordinator+, tenant-scoped)
 * POST /:id/approve      — assign role + create person record (coordinator+)
 * POST /:id/reject       — reject with a reason (coordinator+)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  volunteersTable,
  pollingAgentsTable,
  pollingStationsTable,
  enrollmentsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requireCountyOrAbove } from "../middlewares/rbac";
import { publicSubmitLimiter, statusCheckLimiter } from "../middlewares/rateLimits";
import { validate } from "../lib/validate";
import { sendRouteError } from "../lib/routeError";
import { assertTenant, tenantFilter } from "../lib/withTenant";
import { logger } from "../lib/logger";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const uuidField = z.string().uuid();
const applySchema = z.object({
  tenantId: uuidField.optional(),
  tenantSlug: z.string().trim().min(2).max(100).optional(), // mobile knows the slug, not the id
  intendedRole: z.enum(["volunteer", "polling-agent"]),
  fullName: z.string().trim().min(2).max(150),
  phoneNumber: z.string().trim().min(5).max(30),
  email: z.string().trim().email().max(200),
  nationalId: z.string().trim().min(5).max(20).optional(),
  countyId: uuidField.optional(),
  constituencyId: uuidField.optional(),
  wardId: uuidField.optional(),
  preferredStationId: uuidField.optional(),
});

// Campaigns a new user may apply to join.
router.get("/campaigns", statusCheckLimiter, requireAuth, async (_req: any, res: any) => {
  try {
    const rows = await db
      .select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug })
      .from(tenantsTable)
      .orderBy(tenantsTable.name)
      .limit(200);
    res.json(rows);
  } catch (err) { sendRouteError(res, err); }
});

router.post("/", publicSubmitLimiter, requireAuth, async (req: any, res: any) => {
  try {
    const parsed = validate(applySchema, req.body, res);
    if (!parsed) return;
    if (parsed.intendedRole === "polling-agent" && !parsed.nationalId) {
      return res.status(400).json({ code: "NATIONAL_ID_REQUIRED", error: "Polling agents must provide their national ID number." });
    }
    if (!parsed.tenantId && !parsed.tenantSlug) return res.status(400).json({ error: "tenantId or tenantSlug is required" });
    const [tenant] = await db.select({
      id: tenantsTable.id,
      scopeCountyId: (tenantsTable as any).scopeCountyId,
      scopeConstituencyId: (tenantsTable as any).scopeConstituencyId,
      scopeWardId: (tenantsTable as any).scopeWardId,
    }).from(tenantsTable)
      .where(parsed.tenantId ? eq(tenantsTable.id, parsed.tenantId) : eq(tenantsTable.slug, parsed.tenantSlug!));
    if (!tenant) return res.status(404).json({ error: "Campaign not found" });
    // Submitted geography must sit inside the campaign's own scope.
    if (tenant.scopeCountyId && parsed.countyId && parsed.countyId !== tenant.scopeCountyId)
      return res.status(400).json({ code: "OUT_OF_SCOPE", error: "That county is outside this campaign's scope." });
    if (tenant.scopeConstituencyId && parsed.constituencyId && parsed.constituencyId !== tenant.scopeConstituencyId)
      return res.status(400).json({ code: "OUT_OF_SCOPE", error: "That constituency is outside this campaign's scope." });
    if (tenant.scopeWardId && parsed.wardId && parsed.wardId !== tenant.scopeWardId)
      return res.status(400).json({ code: "OUT_OF_SCOPE", error: "That ward is outside this campaign's scope." });
    // Preferred station must exist and sit inside the campaign's scope.
    if (parsed.preferredStationId) {
      const [st] = await db.select({ countyId: pollingStationsTable.countyId, constituencyId: pollingStationsTable.constituencyId, wardId: pollingStationsTable.wardId })
        .from(pollingStationsTable).where(eq(pollingStationsTable.id, parsed.preferredStationId)).limit(1);
      if (!st) return res.status(404).json({ error: "Polling station not found" });
      if ((tenant.scopeCountyId && st.countyId !== tenant.scopeCountyId)
        || (tenant.scopeConstituencyId && st.constituencyId !== tenant.scopeConstituencyId)
        || (tenant.scopeWardId && st.wardId !== tenant.scopeWardId)) {
        return res.status(400).json({ code: "OUT_OF_SCOPE", error: "That station is outside this campaign's scope." });
      }
    }
    // Already a member? No second application.
    const [approved] = await db.select({ id: enrollmentsTable.id }).from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.tenantId, tenant.id), eq(enrollmentsTable.clerkUserId, req.clerkId), eq(enrollmentsTable.status, "approved")))
      .limit(1);
    if (approved) return res.status(409).json({ code: "ALREADY_MEMBER", error: "Your application to this campaign was already approved." });
    try {
      const [row] = await db.insert(enrollmentsTable).values({
        tenantId: tenant.id,
        clerkUserId: req.clerkId,
        email: parsed.email,
        intendedRole: parsed.intendedRole,
        fullName: parsed.fullName,
        phoneNumber: parsed.phoneNumber,
        nationalId: parsed.nationalId ?? null,
        countyId: parsed.countyId ?? null,
        constituencyId: parsed.constituencyId ?? null,
        wardId: parsed.wardId ?? null,
        preferredStationId: parsed.preferredStationId ?? null,
      }).returning();
      return res.status(201).json(row);
    } catch (err: any) {
      // Partial unique index: one pending application per user per campaign.
      if (err?.cause?.code === "23505") {
        return res.status(409).json({ code: "ENROLLMENT_PENDING", error: "You already have a pending application with this campaign." });
      }
      throw err;
    }
  } catch (err) { sendRouteError(res, err); }
});

// The caller's own applications (drives the wizard's status screen).
router.get("/me", requireAuth, async (req: any, res: any) => {
  try {
    const rows = await db
      .select({ enrollment: enrollmentsTable, campaignName: tenantsTable.name })
      .from(enrollmentsTable)
      .innerJoin(tenantsTable, eq(enrollmentsTable.tenantId, tenantsTable.id))
      .where(eq(enrollmentsTable.clerkUserId, req.clerkId))
      .orderBy(desc(enrollmentsTable.createdAt))
      .limit(50);
    res.json(rows.map((r) => ({ ...r.enrollment, campaignName: r.campaignName })));
  } catch (err) { sendRouteError(res, err); }
});

// ─── Coordinator queue ──────────────────────────────────────────────────────

router.get("/", requireAuth, requireCountyOrAbove, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const status = String(req.query.status ?? "pending");
    const rows = await db.select().from(enrollmentsTable)
      .where(and(tenantFilter(enrollmentsTable, t.id), eq(enrollmentsTable.status, status)))
      .orderBy(desc(enrollmentsTable.createdAt))
      .limit(500);
    res.json(rows);
  } catch (err) { sendRouteError(res, err); }
});

const ROLE_LEVELS: Record<string, number> = { volunteer: 8, "polling-agent": 7 };

/**
 * Reviewers scoped to a county/constituency/ward (their user_roles rows carry
 * the scope columns) may only act on applications inside that scope.
 * Applications with no geography are reviewable by anyone — there's nothing
 * to mismatch yet. Returns null when allowed, otherwise the 403 payload.
 */
async function reviewerScopeViolation(clerkId: string, tenantId: string, enrollment: { countyId: string | null; constituencyId: string | null; wardId: string | null }): Promise<boolean> {
  const rows = await db.select({
    countyId: userRolesTable.countyId, constituencyId: userRolesTable.constituencyId, wardId: userRolesTable.wardId,
  }).from(userRolesTable)
    .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
    .where(and(eq(userRolesTable.tenantId, tenantId), eq(usersTable.clerkId, clerkId)));
  for (const s of rows) {
    if (!s.countyId && !s.constituencyId && !s.wardId) return false; // a national/unscoped role grants review
    const countyOk = !s.countyId || !enrollment.countyId || enrollment.countyId === s.countyId;
    const conOk = !s.constituencyId || !enrollment.constituencyId || enrollment.constituencyId === s.constituencyId;
    const wardOk = !s.wardId || !enrollment.wardId || enrollment.wardId === s.wardId;
    if (countyOk && conOk && wardOk) return false;
  }
  return rows.length > 0;
}

async function ensureRole(slug: string): Promise<string> {
  const [existing] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable)
    .values({ slug, name: slug, level: ROLE_LEVELS[slug] ?? 8 } as any)
    .onConflictDoNothing()
    .returning();
  if (role) return role.id;
  const [again] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  return again.id;
}

router.post("/:id/approve", requireAuth, requireCountyOrAbove, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Reviewer scope check happens before the claim.
    const [target] = await db.select().from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.id, req.params.id), tenantFilter(enrollmentsTable, t.id))).limit(1);
    if (target && await reviewerScopeViolation(req.clerkId, t.id, target)) {
      return res.status(403).json({ code: "OUTSIDE_REVIEW_SCOPE", error: "This application is outside your assigned area." });
    }
    const result = await db.transaction(async (tx) => {
      // Claim first: a conditional pending→approved UPDATE serializes
      // concurrent approvals — the loser gets no row and 409s before any
      // side effects run, so duplicate roles/records can't happen.
      const [enrollment] = await tx.update(enrollmentsTable)
        .set({ status: "approved", reviewedBy: req.clerkId, reviewedAt: new Date() })
        .where(and(
          eq(enrollmentsTable.id, req.params.id),
          tenantFilter(enrollmentsTable, t.id),
          eq(enrollmentsTable.status, "pending"),
        ))
        .returning();
      if (!enrollment) {
        const [existing] = await tx.select({ status: enrollmentsTable.status }).from(enrollmentsTable)
          .where(and(eq(enrollmentsTable.id, req.params.id), tenantFilter(enrollmentsTable, t.id))).limit(1);
        if (!existing) return { error: 404 as const };
        return { error: 409 as const, status: existing.status };
      }

      const [roleRow] = await tx.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.slug, enrollment.intendedRole)).limit(1);
      const roleId = roleRow?.id ?? (await tx.insert(rolesTable)
        .values({ slug: enrollment.intendedRole, name: enrollment.intendedRole, level: ROLE_LEVELS[enrollment.intendedRole] ?? 8 } as any)
        .onConflictDoNothing().returning())[0]?.id
        ?? (await tx.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.slug, enrollment.intendedRole)).limit(1))[0].id;

      // The applicant may never have called an API that creates their user row.
      let [user] = await tx.select().from(usersTable).where(eq(usersTable.clerkId, enrollment.clerkUserId)).limit(1);
      if (!user) {
        [user] = await tx.insert(usersTable).values({
          clerkId: enrollment.clerkUserId,
          email: enrollment.email,
          fullName: enrollment.fullName,
          status: "active",
          isGlobalAdmin: false,
          activeTenantId: t.id,
        } as any).returning();
      }

      await tx.insert(userRolesTable)
        .values({ userId: user.id, roleId, tenantId: t.id } as any)
        .onConflictDoNothing();

      if (enrollment.intendedRole === "volunteer") {
        await tx.insert(volunteersTable).values({
          tenantId: t.id, userId: user.id,
          fullName: enrollment.fullName, phoneNumber: enrollment.phoneNumber, email: enrollment.email,
          countyId: enrollment.countyId, constituencyId: enrollment.constituencyId, wardId: enrollment.wardId,
          status: "active", consentGiven: true,
        } as any);
      } else {
        await tx.insert(pollingAgentsTable).values({
          tenantId: t.id, userId: user.id,
          fullName: enrollment.fullName, phoneNumber: enrollment.phoneNumber,
          nationalId: enrollment.nationalId, pollingStationId: enrollment.preferredStationId,
          status: "active",
        } as any);
      }

      // First campaign for this user becomes their active context.
      await tx.update(usersTable).set({ activeTenantId: t.id } as any)
        .where(and(eq(usersTable.id, user.id), sql`${usersTable.activeTenantId} IS NULL`));

      return { enrollment };
    });
    if ("error" in result && result.error === 404) return res.status(404).json({ error: "Enrollment not found" });
    if ("error" in result && result.error === 409) return res.status(409).json({ code: "ALREADY_REVIEWED", error: `Application already ${result.status}.` });
    logger.info({ tenantId: t.id, enrollmentId: req.params.id }, "enrollment approved");
    res.json((result as any).enrollment);
  } catch (err) { sendRouteError(res, err); }
});

const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

router.post("/:id/reject", requireAuth, requireCountyOrAbove, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(rejectSchema, req.body, res);
    if (!parsed) return;
    const [target] = await db.select().from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.id, req.params.id), tenantFilter(enrollmentsTable, t.id))).limit(1);
    if (target && await reviewerScopeViolation(req.clerkId, t.id, target)) {
      return res.status(403).json({ code: "OUTSIDE_REVIEW_SCOPE", error: "This application is outside your assigned area." });
    }
    const [row] = await db.update(enrollmentsTable)
      .set({ status: "rejected", reviewReason: parsed.reason, reviewedBy: req.clerkId, reviewedAt: new Date() })
      .where(and(
        eq(enrollmentsTable.id, req.params.id),
        tenantFilter(enrollmentsTable, t.id),
        eq(enrollmentsTable.status, "pending"),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Pending enrollment not found" });
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

export default router;
