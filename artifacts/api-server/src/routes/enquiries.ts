/**
 * Platform enquiry routes.
 *
 * These are platform-level (not tenant-scoped) — any visitor to the Debe
 * landing page can submit a request-access enquiry without authentication.
 *
 * POST /api/enquiries          — submit a new enquiry (public)
 * GET  /api/enquiries          — list all enquiries (platform admin only)
 * GET  /api/enquiries/:id      — get a single enquiry (platform admin only)
 * PATCH /api/enquiries/:id     — update status / notes (platform admin only)
 */
import { Router } from "express";
import { db, platformEnquiriesTable } from "@workspace/db";
import { publicSubmitLimiter } from "../middlewares/rateLimits";
import { getAuth } from "@clerk/express";
import { requireLevel } from "../middlewares/rbac";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../lib/validate";

const router = Router();

const VALID_LEVELS = [
  "Presidential",
  "Gubernatorial",
  "Senatorial",
  "Women Rep",
  "MP",
  "MCA",
  "Not sure yet",
];

const VALID_STATUSES = ["new", "contacted", "converted", "closed"] as const;

// ── Auth helper ───────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// ── Validation schemas ────────────────────────────────────────────────────────
const listQuerySchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const patchBodySchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

// ── POST /api/enquiries — public, unauthenticated ─────────────────────────────
// publicSubmitLimiter: 5 submissions per IP per 15-minute window (same as
// volunteer/supporter registration) — prevents bot flooding.
router.post("/", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const {
      fullName,
      email,
      organisation,
      electionLevel,
      message,
    } = req.body ?? {};

    // Validate required fields
    const missing: string[] = [];
    if (!fullName?.trim())      missing.push("fullName");
    if (!email?.trim())         missing.push("email");
    if (!organisation?.trim())  missing.push("organisation");
    if (!electionLevel?.trim()) missing.push("electionLevel");

    if (missing.length > 0) {
      return res.status(400).json({
        error: "Missing required fields",
        fields: missing,
      });
    }

    // Validate email format (simple)
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email.trim())) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Validate election level against known values
    if (!VALID_LEVELS.includes(electionLevel)) {
      return res.status(400).json({ error: "Invalid election level" });
    }

    const [enquiry] = await db
      .insert(platformEnquiriesTable)
      .values({
        fullName:      fullName.trim(),
        email:         email.trim().toLowerCase(),
        organisation:  organisation.trim(),
        electionLevel: electionLevel.trim(),
        message:       message?.trim() || null,
      })
      .returning({ id: platformEnquiriesTable.id, createdAt: platformEnquiriesTable.createdAt });

    return res.status(201).json({
      success: true,
      id: enquiry.id,
      message: "Enquiry received. We'll be in touch shortly.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to save enquiry. Please try again." });
  }
});

// ── GET /api/enquiries — platform admin only ──────────────────────────────────
router.get("/", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const query = validate(listQuerySchema, req.query, res);
    if (!query) return;

    const { status, limit, offset } = query;

    const rows = await db
      .select()
      .from(platformEnquiriesTable)
      .where(status ? eq(platformEnquiriesTable.status, status) : undefined)
      .orderBy(desc(platformEnquiriesTable.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to load enquiries. Please try again." });
  }
});

// ── GET /api/enquiries/:id — platform admin only ──────────────────────────────
router.get("/:id", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(platformEnquiriesTable)
      .where(eq(platformEnquiriesTable.id, id))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Enquiry not found" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to load enquiry. Please try again." });
  }
});

// ── PATCH /api/enquiries/:id — platform admin only ────────────────────────────
// Update status and/or notes.
router.patch("/:id", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const body = validate(patchBodySchema, req.body, res);
    if (!body) return;

    if (body.status === undefined && body.notes === undefined) {
      return res.status(400).json({ error: "At least one of status or notes must be provided" });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined)  updates.notes = body.notes;

    const [updated] = await db
      .update(platformEnquiriesTable)
      .set(updates)
      .where(eq(platformEnquiriesTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Enquiry not found" });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to update enquiry. Please try again." });
  }
});

export default router;
