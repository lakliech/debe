import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  supportersTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  consentRecordsTable,
  supporterAccessLogsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";

/** Resolve a Clerk text ID to the local UUID from the users table. Returns null if not found. */
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

// ─── Schemas ──────────────────────────────────────────────────────────────────

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
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const { search, countyId, constituencyId, optedOut, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const rows = await db
      .select({
        id: supportersTable.id,
        fullName: supportersTable.fullName,
        email: supportersTable.email,
        phoneNumber: supportersTable.phoneNumber,
        membershipStatus: supportersTable.membershipStatus,
        optedOut: supportersTable.optedOut,
        consentMarketing: supportersTable.consentMarketing,
        consentSms: supportersTable.consentSms,
        countyId: supportersTable.countyId,
        constituencyId: supportersTable.constituencyId,
        createdAt: supportersTable.createdAt,
        countyName: countiesTable.name,
      })
      .from(supportersTable)
      .leftJoin(countiesTable, eq(supportersTable.countyId, countiesTable.id))
      .where(
        and(
          countyId ? eq(supportersTable.countyId, countyId) : undefined,
          constituencyId ? eq(supportersTable.constituencyId, constituencyId) : undefined,
          optedOut !== undefined ? eq(supportersTable.optedOut, optedOut === "true") : undefined,
          search
            ? or(
                ilike(supportersTable.fullName, `%${search}%`),
                ilike(supportersTable.email, `%${search}%`),
                ilike(supportersTable.phoneNumber, `%${search}%`)
              )
            : undefined
        )
      )
      .orderBy(desc(supportersTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [totalRow] = await db.select({ total: count() }).from(supportersTable)
      .where(and(
        countyId ? eq(supportersTable.countyId, countyId) : undefined,
        optedOut !== undefined ? eq(supportersTable.optedOut, optedOut === "true") : undefined,
      ));

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum, limit: limitNum });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supporters/stats
router.get("/stats", requireAuth, async (req: any, res: any) => {
  try {
    const [totals] = await db.select({ total: count() }).from(supportersTable);
    const [optedOutCount] = await db.select({ total: count() }).from(supportersTable).where(eq(supportersTable.optedOut, true));
    const [consentSmsCount] = await db.select({ total: count() }).from(supportersTable).where(eq(supportersTable.consentSms, true));
    const [consentEmailCount] = await db.select({ total: count() }).from(supportersTable).where(eq(supportersTable.consentEmail, true));

    res.json({
      total: Number(totals?.total ?? 0),
      optedOut: Number(optedOutCount?.total ?? 0),
      consentSms: Number(consentSmsCount?.total ?? 0),
      consentEmail: Number(consentEmailCount?.total ?? 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supporters/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const [supporter] = await db
      .select()
      .from(supportersTable)
      .where(eq(supportersTable.id, req.params.id))
      .limit(1);

    if (!supporter) return res.status(404).json({ error: "Supporter not found" });

    // Log access — resolve Clerk text ID to local UUID (required for UUID column)
    const actorUUID = req.actorId ?? await resolveActorUUID(req.clerkId).catch(() => null);
    if (actorUUID) {
      await db.insert(supporterAccessLogsTable).values({
        supporterId: req.params.id,
        accessedBy: actorUUID,
        accessedByEmail: req.auth?.userEmail,
        action: "view",
      }).catch((err: any) => {
        console.warn("[supporters] access log write failed:", err?.message);
      });
    } else {
      console.warn("[supporters] access log skipped: could not resolve actor UUID for clerkId", req.clerkId);
    }

    res.json(supporter);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/supporters/:id
router.patch("/:id", requireAuth, canManageSupporters, async (req: any, res: any) => {
  try {
    const body = validate(SupporterPatchSchema, req.body, res);
    if (!body) return;

    const {
      fullName, email, phoneNumber, countyId, constituencyId, wardId,
      membershipStatus, policyInterests,
      consentMarketing, consentSms, consentEmail,
    } = body;

    const [updated] = await db
      .update(supportersTable)
      .set({
        ...(fullName !== undefined && { fullName }),
        ...(email !== undefined && { email }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(countyId !== undefined && { countyId }),
        ...(constituencyId !== undefined && { constituencyId }),
        ...(wardId !== undefined && { wardId }),
        ...(membershipStatus !== undefined && { membershipStatus }),
        ...(policyInterests !== undefined && { policyInterests }),
        ...(consentMarketing !== undefined && { consentMarketing }),
        ...(consentSms !== undefined && { consentSms }),
        ...(consentEmail !== undefined && { consentEmail }),
      })
      .where(eq(supportersTable.id, req.params.id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Supporter not found" });

    const editActorUUID = req.actorId ?? await resolveActorUUID(req.clerkId).catch(() => null);
    if (editActorUUID) {
      await db.insert(supporterAccessLogsTable).values({
        supporterId: req.params.id,
        accessedBy: editActorUUID,
        action: "edit",
      }).catch((err: any) => {
        console.warn("[supporters] access log write failed:", err?.message);
      });
    } else {
      console.warn("[supporters] access log skipped: could not resolve actor UUID for clerkId", req.clerkId);
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supporters/:id/opt-out
router.post("/:id/opt-out", requireAuth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(supportersTable)
      .set({ optedOut: true, optedOutAt: new Date(), consentMarketing: false, consentSms: false, consentEmail: false })
      .where(eq(supportersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Supporter not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supporters/:id/consents
router.get("/:id/consents", requireAuth, canViewConsents, async (req: any, res: any) => {
  try {
    const consents = await db
      .select()
      .from(consentRecordsTable)
      .where(and(eq(consentRecordsTable.subjectId, req.params.id), eq(consentRecordsTable.subjectType, "supporter")))
      .orderBy(desc(consentRecordsTable.createdAt));
    res.json(consents);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supporters/:id/consents
router.post("/:id/consents", requireAuth, canManageSupporters, async (req: any, res: any) => {
  try {
    const body = validate(ConsentGrantSchema, req.body, res);
    if (!body) return;

    const { consentType, granted } = body;
    const [record] = await db
      .insert(consentRecordsTable)
      .values({
        subjectType: "supporter",
        subjectId: req.params.id,
        consentType,
        granted: granted ?? true,
        grantedAt: granted !== false ? new Date() : undefined,
      })
      .returning();
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supporters/:id/consents/withdraw
router.post("/:id/consents/withdraw", requireAuth, async (req: any, res: any) => {
  try {
    const body = validate(ConsentWithdrawSchema, req.body, res);
    if (!body) return;

    const { consentType } = body;
    // Mark all active consents of this type as withdrawn
    await db
      .update(consentRecordsTable)
      .set({ granted: false, withdrawnAt: new Date() })
      .where(
        and(
          eq(consentRecordsTable.subjectId, req.params.id),
          eq(consentRecordsTable.subjectType, "supporter"),
          consentType ? eq(consentRecordsTable.consentType, consentType) : undefined,
          eq(consentRecordsTable.granted, true)
        )
      );
    // Also update the supporter table flags
    const updates: any = {};
    if (!consentType || consentType === "marketing") updates.consentMarketing = false;
    if (!consentType || consentType === "sms") updates.consentSms = false;
    if (!consentType || consentType === "email") updates.consentEmail = false;
    if (Object.keys(updates).length) {
      await db.update(supportersTable).set(updates).where(eq(supportersTable.id, req.params.id));
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supporters/:id/access-logs
router.get("/:id/access-logs", requireAuth, canViewConsents, async (req: any, res: any) => {
  try {
    const logs = await db
      .select()
      .from(supporterAccessLogsTable)
      .where(eq(supporterAccessLogsTable.supporterId, req.params.id))
      .orderBy(desc(supporterAccessLogsTable.createdAt))
      .limit(50);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/supporters/:id — data deletion request (hard delete, restricted)
router.delete("/:id", requireAuth, canExportSupporters, async (req: any, res: any) => {
  try {
    await db.delete(supportersTable).where(eq(supportersTable.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
