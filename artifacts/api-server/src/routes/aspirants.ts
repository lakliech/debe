/**
 * Aspirants — admin management routes (auth + coordinator-level required).
 * Public self-registration lives in publicPortal.ts → POST /api/public/aspirants
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, aspirantsTable, usersTable } from "@workspace/db";
import { eq, ilike, and, count, sql, desc } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// County coordinator or above can read and review aspirants (level ≤ 6)
const canReview = requireLevel(6);

/** Resolve Clerk user ID → local users.id UUID (null if not found) */
async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row?.id ?? null;
}

// GET /api/aspirants/stats — requires coordinator+
router.get("/stats", requireAuth, canReview, async (_req: any, res: any) => {
  try {
    const rows = await db
      .select({ status: aspirantsTable.status, count: count() })
      .from(aspirantsTable)
      .groupBy(aspirantsTable.status);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = Number(r.count);
      total += Number(r.count);
    }
    res.json({ total, byStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/aspirants — requires coordinator+
router.get("/", requireAuth, canReview, async (req: any, res: any) => {
  try {
    const { search, status, position, countyId, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(limit) || 20);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (search) conditions.push(ilike(aspirantsTable.fullName, `%${search}%`));
    if (status) conditions.push(eq(aspirantsTable.status, status));
    if (position) conditions.push(eq(aspirantsTable.position, position));
    if (countyId) conditions.push(eq(aspirantsTable.countyId, countyId));

    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(aspirantsTable)
      .where(where);

    const data = await db
      .select()
      .from(aspirantsTable)
      .where(where)
      .orderBy(desc(aspirantsTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    res.json({ data, total, page: pageNum, limit: pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/aspirants/:id — requires coordinator+
router.get("/:id", requireAuth, canReview, async (req: any, res: any) => {
  try {
    const [row] = await db
      .select()
      .from(aspirantsTable)
      .where(eq(aspirantsTable.id, req.params.id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/aspirants/:id — update status / review notes (coordinator+)
router.patch("/:id", requireAuth, canReview, async (req: any, res: any) => {
  try {
    const { status, reviewNotes } = req.body;
    if (status && !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be pending | approved | rejected" });
    }

    const updates: Record<string, any> = {};
    if (status) {
      updates.status = status;
      updates.reviewedAt = new Date();
      // Persist reviewer identity for audit trail
      const actorUUID = await resolveActorUUID(req.clerkId);
      if (actorUUID) updates.reviewedBy = actorUUID;
    }
    if (reviewNotes !== undefined) updates.reviewNotes = reviewNotes;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    const [updated] = await db
      .update(aspirantsTable)
      .set(updates)
      .where(eq(aspirantsTable.id, req.params.id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
