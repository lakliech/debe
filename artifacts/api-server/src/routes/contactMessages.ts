/**
 * Contact Messages — admin management routes (auth required).
 * Public submission lives in publicPortal.ts → POST /api/public/contact
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, contactMessagesTable, usersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";
import { requireLevel } from "../middlewares/rbac";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// County coordinator (level ≤ 6) and above can view and triage messages
const canView   = requireLevel(6);
// Same level required to mutate status / add reply notes
const canManage = requireLevel(6);

async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row?.id ?? null;
}

// GET /api/contact-messages/counts — per-status counts for tab badges
router.get("/counts", requireAuth, canView, async (_req: any, res: any) => {
  try {
    const rows = await db
      .select({ status: contactMessagesTable.status, count: count() })
      .from(contactMessagesTable)
      .groupBy(contactMessagesTable.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = Number(r.count);
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contact-messages — paginated list with optional status filter
router.get("/", requireAuth, canView, async (req: any, res: any) => {
  try {
    const { status, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(100, parseInt(limit as string) || 25);
    const offset = (pageNum - 1) * pageSize;

    const where = status ? eq(contactMessagesTable.status, status as string) : undefined;

    const [{ total }] = await db
      .select({ total: count() })
      .from(contactMessagesTable)
      .where(where);

    const data = await db
      .select({
        id:        contactMessagesTable.id,
        fullName:  contactMessagesTable.fullName,
        email:     contactMessagesTable.email,
        subject:   contactMessagesTable.subject,
        status:    contactMessagesTable.status,
        createdAt: contactMessagesTable.createdAt,
        repliedAt: contactMessagesTable.repliedAt,
      })
      .from(contactMessagesTable)
      .where(where)
      .orderBy(desc(contactMessagesTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    res.json({ data, total: Number(total), page: pageNum, limit: pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contact-messages/:id — fetch full message; auto-advance open → read
router.get("/:id", requireAuth, canView, async (req: any, res: any) => {
  try {
    const [msg] = await db
      .select()
      .from(contactMessagesTable)
      .where(eq(contactMessagesTable.id, req.params.id))
      .limit(1);

    if (!msg) return res.status(404).json({ error: "Message not found" });

    // Auto-advance open → read on first view
    if (msg.status === "open") {
      await db
        .update(contactMessagesTable)
        .set({ status: "read" })
        .where(eq(contactMessagesTable.id, req.params.id));
      msg.status = "read";
    }

    res.json(msg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const patchSchema = z.object({
  status:    z.enum(["open", "read", "replied", "archived"]).optional(),
  replyNote: z.string().max(4000).optional(),
});

// PATCH /api/contact-messages/:id — update status and/or reply note
router.patch("/:id", requireAuth, canManage, async (req: any, res: any) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { status, replyNote } = parsed.data;
    const update: Record<string, unknown> = {};

    if (status !== undefined) update.status = status;
    if (replyNote !== undefined) update.replyNote = replyNote;

    // Set repliedAt/repliedBy when marking as replied
    if (status === "replied") {
      update.repliedAt = new Date();
      const actorId = await resolveActorUUID(req.clerkId);
      if (actorId) update.repliedBy = actorId;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const [updated] = await db
      .update(contactMessagesTable)
      .set(update)
      .where(eq(contactMessagesTable.id, req.params.id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Message not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
