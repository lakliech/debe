import { logger } from "../lib/logger";
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  supportersTable,
  countiesTable,
  constituenciesTable,
  consentRecordsTable,
  supporterAccessLogsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { resolveTenant } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant } from "../lib/withTenant";

async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row?.id ?? null;
}

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canManageSupporters = requireRoles([
  "campaign-exec-director",
  "national-organising-director",
  "county-coordinator",
  "constituency-coordinator",
  "ward-coordinator",
  "communications-officer",
]);

const canExportSupporters = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "data-protection-officer",
]);

const canViewConsents = requireRoles([
  "campaign-exec-director",
  "data-protection-officer",
  "legal-officer",
  "communications-officer",
]);

const SupporterPatchSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().optional(),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  membershipStatus: z.string().optional(),
  policyInterests: z.array(z.string()).optional(),
  consentMarketing: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  consentEmail: z.boolean().optional(),
});

const ConsentGrantSchema = z.object({
  consentType: z.string().min(1),
  granted: z.boolean().optional(),
  ipAddress: z.string().optional(),
});

const ConsentWithdrawSchema = z.object({
  consentType: z.string().optional(),
});

// GET /api/supporters
router.get("/", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, countyId, search, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(limit) || 25);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(supportersTable, t.id)];
    if (status === "opted-out") conditions.push(eq(supportersTable.optedOut, true));
    else if (status === "active") conditions.push(eq(supportersTable.optedOut, false));
    if (countyId) conditions.push(eq(supportersTable.countyId, countyId));
    if (search) conditions.push(or(
      ilike(supportersTable.fullName, `%${search}%`),
      ilike(supportersTable.email, `%${search}%`),
      ilike(supportersTable.phoneNumber, `%${search}%`),
    ));

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(supportersTable)
      .where(where);

    const data = await db
      .select({
        id: supportersTable.id,
        fullName: supportersTable.fullName,
        email: supportersTable.email,
        phoneNumber: supportersTable.phoneNumber,
        countyId: supportersTable.countyId,
        membershipStatus: supportersTable.membershipStatus,
        optedOut: supportersTable.optedOut,
        createdAt: supportersTable.createdAt,
        countyName: countiesTable.name,
      })
      .from(supportersTable)
      .leftJoin(countiesTable, eq(supportersTable.countyId, countiesTable.id))
      .where(where)
      .orderBy(desc(supportersTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    res.json({ data, total: Number(total), page: pageNum, limit: pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/supporters/:id
router.get("/:id", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [supporter] = await db
      .select()
      .from(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .limit(1);
    if (!supporter) return res.status(404).json({ error: "Supporter not found" });
    res.json(supporter);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/supporters/:id
router.patch("/:id", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = SupporterPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const [updated] = await db
      .update(supportersTable)
      .set(parsed.data)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Supporter not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE /api/supporters/:id — GDPR erasure
router.delete("/:id", requireAuth, resolveTenant, canExportSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [deleted] = await db
      .delete(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .returning({ id: supportersTable.id });
    if (!deleted) return res.status(404).json({ error: "Supporter not found" });
    res.json({ deleted: true });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/supporters/:id/opt-out
router.post("/:id/opt-out", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db
      .update(supportersTable)
      .set({ optedOut: true, optedOutAt: new Date() })
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Supporter not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/supporters/:id/consents
router.get("/:id/consents", requireAuth, resolveTenant, canViewConsents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [supporter] = await db.select({ id: supportersTable.id })
      .from(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .limit(1);
    if (!supporter) return res.status(404).json({ error: "Supporter not found" });

    const consents = await db
      .select()
      .from(consentRecordsTable)
      .where(and(
        eq(consentRecordsTable.subjectType, "supporter"),
        eq(consentRecordsTable.subjectId, req.params.id),
      ))
      .orderBy(desc(consentRecordsTable.createdAt));
    res.json(consents);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/supporters/:id/consents — grant or update a consent
router.post("/:id/consents", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [supporter] = await db.select({ id: supportersTable.id })
      .from(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .limit(1);
    if (!supporter) return res.status(404).json({ error: "Supporter not found" });

    const { consentType, granted = true, ipAddress } = req.body;
    if (!consentType) return res.status(400).json({ error: "consentType required" });

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(consentRecordsTable).values({
      subjectType: "supporter",
      subjectId: req.params.id,
      consentType,
      granted,
      grantedAt: granted ? new Date() : undefined,
      ipAddress: ipAddress ?? req.ip,
      collectedBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/supporters/:id/consents/withdraw — withdraw all or a specific consent type
router.post("/:id/consents/withdraw", requireAuth, resolveTenant, canManageSupporters, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [supporter] = await db.select({ id: supportersTable.id })
      .from(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .limit(1);
    if (!supporter) return res.status(404).json({ error: "Supporter not found" });

    const { consentType } = req.body;
    const actorId = await resolveActorUUID(req.clerkId);

    const conditions: any[] = [
      eq(consentRecordsTable.subjectType, "supporter"),
      eq(consentRecordsTable.subjectId, req.params.id),
    ];
    if (consentType) conditions.push(eq(consentRecordsTable.consentType, consentType));

    await db.update(consentRecordsTable).set({
      granted: false,
      withdrawnAt: new Date(),
      withdrawnBy: actorId ?? undefined,
    }).where(and(...conditions));

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/supporters/:id/access-logs — DPO audit trail of who viewed this supporter
router.get("/:id/access-logs", requireAuth, resolveTenant, canViewConsents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [supporter] = await db.select({ id: supportersTable.id })
      .from(supportersTable)
      .where(and(eq(supportersTable.id, req.params.id), tenantFilter(supportersTable, t.id)))
      .limit(1);
    if (!supporter) return res.status(404).json({ error: "Supporter not found" });

    const logs = await db
      .select()
      .from(supporterAccessLogsTable)
      .where(eq(supporterAccessLogsTable.supporterId, req.params.id))
      .orderBy(desc(supporterAccessLogsTable.createdAt))
      .limit(200);
    res.json(logs);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
