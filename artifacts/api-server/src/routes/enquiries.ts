/**
 * Platform enquiry routes.
 *
 * These are platform-level (not tenant-scoped) — any visitor to the Debe
 * landing page can submit a request-access enquiry without authentication.
 *
 * POST /api/enquiries  — submit a new enquiry
 */
import { Router } from "express";
import { db, platformEnquiriesTable } from "@workspace/db";
import { publicSubmitLimiter } from "../middlewares/rateLimits";

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

// POST /api/enquiries — public, unauthenticated
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

export default router;
