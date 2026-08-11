/**
 * Public portal routes — no authentication required.
 * Serves content for the campaign's public-facing website.
 */
import { logger } from "../lib/logger";
import { Readable } from "node:stream";
import { Router } from "express";
import { db } from "@workspace/db";
import { publicSubmitLimiter, statusCheckLimiter } from "../middlewares/rateLimits";
import {
  manifestoSectorsTable,
  manifestoItemsTable,
  countyPrioritiesTable,
  faqItemsTable,
  factCheckItemsTable,
  newsArticlesTable,
  eventsTable,
  volunteersTable,
  supportersTable,
  policySubmissionsTable,
  countiesTable,
  brandingTable,
  resultSubmissionsTable,
  submissionFormImagesTable,
  submissionCandidateVotesTable,
  electionsTable,
  candidatesTable,
} from "@workspace/db";
import { pollingStationsTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql, inArray } from "drizzle-orm";
import { aspirantsTable, contactMessagesTable } from "@workspace/db";
import { tenantFilter, assertTenant } from '../lib/withTenant';
import { notifyAspirantDeclaration } from "../lib/aspirantNotifications";
import { ObjectStorageService } from "../lib/objectStorage";
import { z } from "zod";
import { validate } from "../lib/validate";

const objectStorageService = new ObjectStorageService();

const router = Router();

const eventsQuerySchema = z.object({
  countyId: z.string().uuid().optional(),
  upcoming: z.string().trim().max(20).optional(),
});
const newsQuerySchema = z.object({
  category: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
const faqQuerySchema = z.object({
  category: z.string().trim().max(200).optional(),
});
const aspirantsQuerySchema = z.object({
  position: z.string().trim().max(200).optional(),
  county: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
const aspirantStatusQuerySchema = z.object({
  nationalId: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(1).max(30),
});
const transparencySubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  electionId: z.string().uuid().optional(),
});

// GET /api/public/stats — public portal stats card
router.get("/stats", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    // No tenant context — return neutral zeros. The client supplies branding
    // from its own BrandingContext; the API must never assert a campaign identity.
    if (!tenantId) return res.json({ volunteers: 0, supporters: 0, campaignName: null, tagline: null });
    const [volunteerCount] = await db.select({ total: count() }).from(volunteersTable)
      .where(and(eq(volunteersTable.status, "active"), tenantFilter(volunteersTable, tenantId)));
    const [supporterCount] = await db.select({ total: count() }).from(supportersTable)
      .where(and(eq(supportersTable.optedOut, false), tenantFilter(supportersTable, tenantId)));
    const [branding] = await db.select().from(brandingTable).where(tenantFilter(brandingTable, tenantId)).limit(1);

    res.json({
      volunteers: Number(volunteerCount?.total ?? 0),
      supporters: Number(supporterCount?.total ?? 0),
      campaignName: branding?.campaignName ?? null,
      tagline: branding?.tagline ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/manifesto/sectors
router.get("/manifesto/sectors", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json([]);
    const sectors = await db
      .select()
      .from(manifestoSectorsTable)
      .where(tenantFilter(manifestoSectorsTable, tenantId))
      .orderBy(asc(manifestoSectorsTable.displayOrder));
    res.json(sectors);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/manifesto/sectors/:slug
router.get("/manifesto/sectors/:slug", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Sector not found" });
    const [sector] = await db
      .select()
      .from(manifestoSectorsTable)
      .where(and(eq(manifestoSectorsTable.slug, req.params.slug), tenantFilter(manifestoSectorsTable, tenantId)))
      .limit(1);
    if (!sector) return res.status(404).json({ error: "Sector not found" });

    const items = await db
      .select()
      .from(manifestoItemsTable)
      .where(eq(manifestoItemsTable.sectorId, sector.id))
      .orderBy(asc(manifestoItemsTable.priority));

    const submissions = await db
      .select({ id: policySubmissionsTable.id, titleEn: policySubmissionsTable.title, createdAt: policySubmissionsTable.createdAt })
      .from(policySubmissionsTable)
      .where(and(
        eq(policySubmissionsTable.sectorId, sector.id),
        eq(policySubmissionsTable.status, "published"),
        tenantFilter(policySubmissionsTable, tenantId),
      ))
      .limit(10);

    res.json({ sector, items, recentSubmissions: submissions });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/county-priorities/:countyCode
router.get("/county-priorities/:countyCode", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json({ county: null, priorities: [] });
    const parsedCode = parseInt(req.params.countyCode, 10);
    if (isNaN(parsedCode) || parsedCode < 1 || parsedCode > 47) {
      return res.status(400).json({ error: "Invalid county code. Must be an integer between 1 and 47." });
    }
    const [county] = await db
      .select()
      .from(countiesTable)
      .where(eq(countiesTable.code, parsedCode))
      .limit(1);
    if (!county) return res.status(404).json({ error: "County not found" });

    const priorities = await db
      .select({
        id: countyPrioritiesTable.id,
        titleEn: countyPrioritiesTable.titleEn,
        titleSw: countyPrioritiesTable.titleSw,
        bodyEn: countyPrioritiesTable.bodyEn,
        bodySw: countyPrioritiesTable.bodySw,
        priority: countyPrioritiesTable.priority,
        sectorSlug: manifestoSectorsTable.slug,
        sectorTitleEn: manifestoSectorsTable.titleEn,
        sectorTitleSw: manifestoSectorsTable.titleSw,
      })
      .from(countyPrioritiesTable)
      .leftJoin(manifestoSectorsTable, eq(countyPrioritiesTable.sectorId, manifestoSectorsTable.id))
      .where(and(eq(countyPrioritiesTable.countyId, county.id), tenantFilter(countyPrioritiesTable, tenantId)))
      .orderBy(asc(countyPrioritiesTable.priority));

    res.json({ county, priorities });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/events
router.get("/events", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json([]);
    const q = validate(eventsQuerySchema, req.query, res);
    if (!q) return;
    const { countyId } = q;
    const events = await db
      .select()
      .from(eventsTable)
      .where(and(
        // Events are public once announced: the management lifecycle is
        // draft → pending_approval → approved, with registration open for
        // approved/active. Draft, pending, completed, and cancelled stay hidden.
        inArray(eventsTable.status, ["approved", "active"]),
        tenantFilter(eventsTable, tenantId),
        countyId ? eq(eventsTable.countyId, countyId) : undefined
      ))
      .orderBy(asc(eventsTable.eventDate))
      .limit(20);
    res.json(events);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/news
router.get("/news", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json([]);
    const q = validate(newsQuerySchema, req.query, res);
    if (!q) return;
    const { category } = q;
    const pageNum = q.page;
    const articles = await db
      .select({
        id: newsArticlesTable.id,
        slug: newsArticlesTable.slug,
        category: newsArticlesTable.category,
        titleEn: newsArticlesTable.titleEn,
        titleSw: newsArticlesTable.titleSw,
        excerptEn: newsArticlesTable.excerptEn,
        excerptSw: newsArticlesTable.excerptSw,
        imageUrl: newsArticlesTable.imageUrl,
        publishedAt: newsArticlesTable.publishedAt,
      })
      .from(newsArticlesTable)
      .where(and(
        eq(newsArticlesTable.status, "published"),
        tenantFilter(newsArticlesTable, tenantId),
        category ? eq(newsArticlesTable.category, category as string) : undefined
      ))
      .orderBy(desc(newsArticlesTable.publishedAt))
      .limit(12)
      .offset((pageNum - 1) * 12);
    res.json(articles);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/news/:slug
router.get("/news/:slug", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Article not found" });
    const [article] = await db
      .select()
      .from(newsArticlesTable)
      .where(and(eq(newsArticlesTable.slug, req.params.slug), eq(newsArticlesTable.status, "published"), tenantFilter(newsArticlesTable, tenantId)))
      .limit(1);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/faq
router.get("/faq", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json([]);
    const q = validate(faqQuerySchema, req.query, res);
    if (!q) return;
    const { category } = q;
    const items = await db
      .select()
      .from(faqItemsTable)
      .where(and(
        eq(faqItemsTable.published, true),
        tenantFilter(faqItemsTable, tenantId),
        category ? eq(faqItemsTable.category, category as string) : undefined
      ))
      .orderBy(asc(faqItemsTable.displayOrder));
    res.json(items);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/fact-check
router.get("/fact-check", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json([]);
    const items = await db
      .select()
      .from(factCheckItemsTable)
      .where(tenantFilter(factCheckItemsTable, tenantId))
      .orderBy(desc(factCheckItemsTable.publishedAt))
      .limit(20);
    res.json(items);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/public/volunteer-register — self-registration (no auth)
router.post("/volunteer-register", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    const {
      fullName, phoneNumber, email, countyId, constituencyId, wardId,
      preferredRole, skills, languages, availability, consentGiven,
    } = req.body;

    if (!fullName || !phoneNumber) {
      return res.status(400).json({ error: "fullName and phoneNumber are required" });
    }
    if (!consentGiven) {
      return res.status(400).json({ error: "Consent is required to register" });
    }

    const [volunteer] = await db
      .insert(volunteersTable)
      .values({
        tenantId,
        fullName,
        phoneNumber,
        email,
        countyId,
        constituencyId,
        wardId,
        preferredRole,
        skills: Array.isArray(skills) ? skills : skills ? [skills] : undefined,
        languages: Array.isArray(languages) ? languages : languages ? [languages] : undefined,
        availability,
        consentGiven: true,
        consentDate: new Date(),
        status: "pending",
      })
      .returning({ id: volunteersTable.id, fullName: volunteersTable.fullName, status: volunteersTable.status });

    res.status(201).json({ message: "Volunteer registration received. A coordinator will contact you within 48 hours.", volunteer });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/public/supporter-register — self-registration (no auth)
router.post("/supporter-register", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    const {
      fullName, phoneNumber, email, countyId, constituencyId,
      consentMarketing, consentSms, consentEmail, policyInterests,
    } = req.body;

    if (!fullName) {
      return res.status(400).json({ error: "fullName is required" });
    }

    const [supporter] = await db
      .insert(supportersTable)
      .values({
        tenantId,
        fullName,
        phoneNumber,
        email,
        countyId,
        constituencyId,
        consentMarketing: consentMarketing ?? false,
        consentSms: consentSms ?? false,
        consentEmail: consentEmail ?? false,
        policyInterests: Array.isArray(policyInterests) ? policyInterests : undefined,
        membershipStatus: "supporter",
      })
      .returning({ id: supportersTable.id, fullName: supportersTable.fullName });

    res.status(201).json({ message: "Thank you for joining the movement!", supporter });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/public/aspirants — aspirant self-registration (no auth)
router.post("/aspirants", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    const {
      fullName, phoneNumber, nationalId, position, countyCode, countyName,
      email, constituency, ward, partyAffiliation, isIndependent,
      statementOfIntent, consentGiven,
    } = req.body;

    if (!fullName || !phoneNumber || !nationalId || !position) {
      return res.status(400).json({ error: "fullName, phoneNumber, nationalId, and position are required" });
    }
    if (!consentGiven) {
      return res.status(400).json({ error: "Consent is required to register" });
    }

    const VALID_POSITIONS = ["parliamentary", "gubernatorial", "senatorial", "women_rep", "mca"];
    if (!VALID_POSITIONS.includes(position)) {
      return res.status(400).json({ error: `position must be one of: ${VALID_POSITIONS.join(", ")}` });
    }

    // Optionally resolve countyId UUID from countyCode
    let countyId: string | undefined;
    if (countyCode) {
      const parsed = parseInt(countyCode, 10);
      if (!isNaN(parsed)) {
        const [county] = await db.select({ id: countiesTable.id }).from(countiesTable).where(eq(countiesTable.code, parsed)).limit(1);
        countyId = county?.id;
      }
    }

    // Reject duplicate declarations before hitting the DB constraint.
    // Returns 409 so the client can surface a clear message instead of a generic error.
    const [existing] = await db
      .select({ id: aspirantsTable.id, status: aspirantsTable.status })
      .from(aspirantsTable)
      .where(and(
        eq(aspirantsTable.nationalId, nationalId),
        eq(aspirantsTable.position, position),
        tenantFilter(aspirantsTable, tenantId),
      ))
      .limit(1);

    if (existing) {
      return res.status(409).json({
        error: "A declaration for this national ID and position already exists.",
        existingStatus: existing.status,
      });
    }

    let aspirant: { id: string; fullName: string; status: string } | undefined;
    try {
      [aspirant] = await db
        .insert(aspirantsTable)
        .values({
          fullName,
          phoneNumber,
          email: email || null,
          nationalId,
          position,
          countyId,
          countyName: countyName || null,
          constituency: constituency || null,
          ward: ward || null,
          partyAffiliation: isIndependent ? null : (partyAffiliation || null),
          isIndependent: !!isIndependent,
          statementOfIntent: statementOfIntent || null,
          tenantId,
          status: "pending",
          consentGiven: true,
        })
        .returning({ id: aspirantsTable.id, fullName: aspirantsTable.fullName, status: aspirantsTable.status });
    } catch (insertErr: any) {
      // Catch the unique constraint violation as a safety net (e.g. concurrent submissions).
      if (insertErr?.code === "23505") {
        return res.status(409).json({
          error: "A declaration for this national ID and position already exists.",
        });
      }
      throw insertErr;
    }

    res.status(201).json({
      message: "Declaration received. The campaign team will review your application.",
      aspirant,
    });

    // Fire-and-forget: notify the review team. Must run after res.json() so a
    // slow provider never delays the response seen by the applicant.
    void notifyAspirantDeclaration(tenantId, fullName, position);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/public/aspirants/status?nationalId=...&phone=...
 *
 * Lets an applicant check the review status of their own declaration without
 * calling the office.  Both nationalId and phone must match to prevent
 * enumeration of a single identifier.  Only status and reviewNotes are
 * returned — no other PII is exposed.
 *
 * Rate-limited to 20 requests per IP per 15 minutes.
 */
router.get("/aspirants/status", statusCheckLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      return res.status(400).json({
        error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter",
      });
    }

    const q = validate(aspirantStatusQuerySchema, req.query, res);
    if (!q) return;

    const { nationalId, phone } = q;

    const [record] = await db
      .select({
        status: aspirantsTable.status,
        reviewNotes: aspirantsTable.reviewNotes,
      })
      .from(aspirantsTable)
      .where(
        and(
          eq(aspirantsTable.nationalId, nationalId),
          eq(aspirantsTable.phoneNumber, phone),
          tenantFilter(aspirantsTable, tenantId),
        ),
      )
      .limit(1);

    if (!record) {
      return res.status(404).json({
        error: "No declaration found for the supplied national ID and phone number. Please check your details or contact the campaign office.",
      });
    }

    const response: { status: string; reviewNotes?: string } = { status: record.status };
    if (record.reviewNotes) response.reviewNotes = record.reviewNotes;

    res.json(response);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/aspirants — approved aspirants directory (no auth, no PII)
router.get("/aspirants", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    const q = validate(aspirantsQuerySchema, req.query, res);
    if (!q) return;
    const { position, county } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const offset = (pageNum - 1) * pageSize;

    if (!tenantId) return res.json({ data: [], total: 0, page: pageNum, pageSize });
    const conditions: any[] = [eq(aspirantsTable.status, "approved"), tenantFilter(aspirantsTable, tenantId)];
    if (position) conditions.push(eq(aspirantsTable.position, position as string));
    if (county) conditions.push(eq(aspirantsTable.countyName, county as string));

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(aspirantsTable)
      .where(where);

    // Only expose non-PII fields publicly
    const data = await db
      .select({
        id:               aspirantsTable.id,
        fullName:         aspirantsTable.fullName,
        position:         aspirantsTable.position,
        countyName:       aspirantsTable.countyName,
        constituency:     aspirantsTable.constituency,
        ward:             aspirantsTable.ward,
        partyAffiliation: aspirantsTable.partyAffiliation,
        isIndependent:    aspirantsTable.isIndependent,
        statementOfIntent: aspirantsTable.statementOfIntent,
        createdAt:        aspirantsTable.createdAt,
      })
      .from(aspirantsTable)
      .where(where)
      .orderBy(desc(aspirantsTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    res.json({ data, total: Number(total), page: pageNum, limit: pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/public/aspirants/:id — single approved aspirant profile (no PII)
router.get("/aspirants/:id", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Aspirant not found" });

    const [aspirant] = await db
      .select({
        id:               aspirantsTable.id,
        fullName:         aspirantsTable.fullName,
        position:         aspirantsTable.position,
        countyName:       aspirantsTable.countyName,
        constituency:     aspirantsTable.constituency,
        ward:             aspirantsTable.ward,
        partyAffiliation: aspirantsTable.partyAffiliation,
        isIndependent:    aspirantsTable.isIndependent,
        statementOfIntent: aspirantsTable.statementOfIntent,
        createdAt:        aspirantsTable.createdAt,
      })
      .from(aspirantsTable)
      .where(and(
        eq(aspirantsTable.id, req.params.id),
        eq(aspirantsTable.status, "approved"),
        tenantFilter(aspirantsTable, tenantId),
      ))
      .limit(1);

    if (!aspirant) return res.status(404).json({ error: "Aspirant not found" });
    res.json(aspirant);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── HTML entity escaping for server-rendered OG pages ─────────────────────
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const POSITION_LABELS: Record<string, string> = {
  parliamentary: "Member of Parliament",
  gubernatorial: "Governor",
  senatorial:    "Senator",
  women_rep:     "Women Representative",
  mca:           "Member of County Assembly",
};

/**
 * GET /api/public/aspirants/:id/page
 *
 * Returns a minimal server-rendered HTML document with per-aspirant Open Graph
 * and Twitter Card meta tags so social-sharing crawlers (WhatsApp, Facebook,
 * X/Twitter) can build rich link previews without executing JavaScript.
 *
 * Human browsers are immediately redirected (via <meta refresh> + JS) to the
 * SPA profile page at /aspirants-directory/:id.
 *
 * Only approved aspirants are served; unapproved / cross-tenant IDs return 404.
 */
router.get("/aspirants/:id/page", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).send("Not found");

    const [aspirant] = await db
      .select({
        id:               aspirantsTable.id,
        fullName:         aspirantsTable.fullName,
        position:         aspirantsTable.position,
        countyName:       aspirantsTable.countyName,
        constituency:     aspirantsTable.constituency,
        statementOfIntent: aspirantsTable.statementOfIntent,
      })
      .from(aspirantsTable)
      .where(and(
        eq(aspirantsTable.id, req.params.id),
        eq(aspirantsTable.status, "approved"),
        tenantFilter(aspirantsTable, tenantId),
      ))
      .limit(1);

    if (!aspirant) return res.status(404).send("Aspirant not found");

    // Crawlers do not run JS, so the campaign name must come from this tenant's
    // stored branding — never from a hardcoded campaign identity.
    const [pageBranding] = await db
      .select({ campaignName: brandingTable.campaignName })
      .from(brandingTable)
      .where(tenantFilter(brandingTable, tenantId))
      .limit(1);
    const campaignName = pageBranding?.campaignName?.trim() || null;

    const posLabel   = POSITION_LABELS[aspirant.position] ?? aspirant.position;
    const location   = [aspirant.constituency, aspirant.countyName].filter(Boolean).join(", ");
    const titleText  = `${aspirant.fullName} — ${posLabel}${location ? ` · ${location}` : ""}`;
    const fallbackDesc = campaignName
      ? `Approved aspirant for ${posLabel} under ${campaignName}.`
      : `Approved aspirant for ${posLabel}.`;
    const descText   = aspirant.statementOfIntent
      ? aspirant.statementOfIntent.slice(0, 200)
      : fallbackDesc;

    // Canonical URL (this page itself) — what crawlers see.
    const origin     = `${req.protocol}://${req.get("host")}`;
    const canonUrl   = `${origin}/api/public/aspirants/${aspirant.id}/page`;
    // SPA URL — where human browsers are redirected.
    const spaUrl     = `${origin}/aspirants-directory/${aspirant.id}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(titleText)}</title>
  <meta name="description" content="${escHtml(descText)}" />

  <!-- Open Graph -->
  <meta property="og:type"        content="profile" />
  <meta property="og:title"       content="${escHtml(titleText)}" />
  <meta property="og:description" content="${escHtml(descText)}" />
  <meta property="og:url"         content="${escHtml(canonUrl)}" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card"        content="summary" />
  <meta name="twitter:title"       content="${escHtml(titleText)}" />
  <meta name="twitter:description" content="${escHtml(descText)}" />

  <!-- Redirect browsers to the SPA immediately -->
  <meta http-equiv="refresh" content="0;url=${escHtml(spaUrl)}" />
</head>
<body>
  <script>window.location.replace(${JSON.stringify(spaUrl)});</script>
  <noscript>
    <p><a href="${escHtml(spaUrl)}">View aspirant profile: ${escHtml(aspirant.fullName)}</a></p>
  </noscript>
</body>
</html>`;

    res
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "public, max-age=300")
      .send(html);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).send("Something went wrong.");
  }
});

// POST /api/public/contact — general contact form (no auth)
router.post("/contact", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "name, email, subject, and message are required" });
    }

    const [contact] = await db
      .insert(contactMessagesTable)
      .values({ tenantId, fullName: name, email, subject, message, status: "open" })
      .returning({ id: contactMessagesTable.id });

    res.status(201).json({ message: "Message received. Our team will get back to you within 2–3 business days.", contactId: contact.id });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/public/policy-submit — citizen policy submissions
router.post("/policy-submit", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    const { title, content, sectorId, countyId, anonymous } = req.body;
    if (!title || !content) return res.status(400).json({ error: "title and content are required" });

    const [submission] = await db
      .insert(policySubmissionsTable)
      .values({
        tenantId,
        title,
        content,
        sectorId,
        countyId,
        submitterName: anonymous ? "Anonymous" : req.body.submitterName,
        submitterEmail: anonymous ? null : req.body.submitterEmail,
        status: "pending",
      })
      .returning({ id: policySubmissionsTable.id });

    res.status(201).json({ message: "Thank you for your policy submission!", submissionId: submission.id });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Public Transparency: Form 34A Photos ──────────────────────────────────────
// All three endpoints are fully unauthenticated — tenant is resolved from the
// request host/subdomain or ?tenant= param by the resolveTenantPublic middleware
// that wraps all /api/public/* routes.
// Only submissions with status = 'verified' are exposed; any other status
// returns 404, preventing premature disclosure of unaudited scans.

/**
 * GET /api/public/transparency/submissions
 * Lists all verified result submissions for the tenant, with station name and a
 * flag indicating whether at least one Form 34A image is available.
 */
router.get("/transparency/submissions", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.json({ data: [] });

    const q = validate(transparencySubmissionsQuerySchema, req.query, res);
    if (!q) return;
    const page = q.page;
    const limit = q.limit;
    const offset = (page - 1) * limit;
    const electionIdFilter = q.electionId;

    const conditions: any[] = [
      tenantFilter(resultSubmissionsTable, tenantId),
      eq(resultSubmissionsTable.status, "verified"),
    ];
    if (electionIdFilter) conditions.push(eq(resultSubmissionsTable.electionId, electionIdFilter));

    const rows = await db
      .select({
        id: resultSubmissionsTable.id,
        pollingStationId: resultSubmissionsTable.pollingStationId,
        electionId: resultSubmissionsTable.electionId,
        totalValidVotes: resultSubmissionsTable.totalValidVotes,
        totalVotesCast: resultSubmissionsTable.totalVotesCast,
        registeredVoters: resultSubmissionsTable.registeredVoters,
        rejectedBallots: resultSubmissionsTable.rejectedBallots,
        spoiltBallots: resultSubmissionsTable.spoiltBallots,
        submittedAt: resultSubmissionsTable.submittedAt,
        stationName: pollingStationsTable.name,
        stationCode: pollingStationsTable.code,
        // Subquery: does at least one uploaded image exist for this submission?
        hasImages: sql<boolean>`EXISTS (
          SELECT 1 FROM submission_form_images sfi
          WHERE sfi.submission_id = ${resultSubmissionsTable.id}
            AND sfi.object_path IS NOT NULL
        )`,
      })
      .from(resultSubmissionsTable)
      .leftJoin(
        pollingStationsTable,
        eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id),
      )
      .where(and(...conditions))
      .orderBy(asc(pollingStationsTable.name), desc(resultSubmissionsTable.submittedAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, page, limit });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/public/transparency/submissions/:id/votes
 * Returns candidate vote breakdown for a verified submission.
 */
router.get("/transparency/submissions/:id/votes", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Not found" });

    const [submission] = await db
      .select({ id: resultSubmissionsTable.id })
      .from(resultSubmissionsTable)
      .where(
        and(
          eq(resultSubmissionsTable.id, req.params.id),
          eq(resultSubmissionsTable.status, "verified"),
          tenantFilter(resultSubmissionsTable, tenantId),
        ),
      )
      .limit(1);

    if (!submission) return res.status(404).json({ error: "Submission not found or not yet verified" });

    const votes = await db
      .select({
        id: submissionCandidateVotesTable.id,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        voteCount: submissionCandidateVotesTable.voteCount,
      })
      .from(submissionCandidateVotesTable)
      .where(eq(submissionCandidateVotesTable.submissionId, req.params.id))
      .orderBy(desc(submissionCandidateVotesTable.voteCount));

    res.json(votes);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/public/transparency/submissions/:id/images
 * Returns image metadata for a verified submission (no object paths exposed).
 */
router.get("/transparency/submissions/:id/images", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Not found" });

    const [submission] = await db
      .select({ id: resultSubmissionsTable.id })
      .from(resultSubmissionsTable)
      .where(
        and(
          eq(resultSubmissionsTable.id, req.params.id),
          eq(resultSubmissionsTable.status, "verified"),
          tenantFilter(resultSubmissionsTable, tenantId),
        ),
      )
      .limit(1);

    if (!submission) return res.status(404).json({ error: "Submission not found or not yet verified" });

    const images = await db
      .select({
        id: submissionFormImagesTable.id,
        imageType: submissionFormImagesTable.imageType,
        mimeType: submissionFormImagesTable.mimeType,
        pageNumber: submissionFormImagesTable.pageNumber,
        sizeBytes: submissionFormImagesTable.sizeBytes,
        uploadedAt: submissionFormImagesTable.uploadedAt,
      })
      .from(submissionFormImagesTable)
      .where(
        and(
          eq(submissionFormImagesTable.submissionId, req.params.id),
          sql`${submissionFormImagesTable.objectPath} IS NOT NULL`,
        ),
      )
      .orderBy(
        asc(submissionFormImagesTable.pageNumber),
        asc(submissionFormImagesTable.uploadedAt),
      );

    res.json(images);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/public/transparency/submissions/:id/images/:imageId
 * Serves the raw image bytes for a verified submission.
 * No auth required — gate is submission status = 'verified' + tenant ownership.
 */
router.get("/transparency/submissions/:id/images/:imageId", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(404).json({ error: "Not found" });

    // Gate: submission must be verified and owned by this tenant
    const [submission] = await db
      .select({ id: resultSubmissionsTable.id })
      .from(resultSubmissionsTable)
      .where(
        and(
          eq(resultSubmissionsTable.id, req.params.id),
          eq(resultSubmissionsTable.status, "verified"),
          tenantFilter(resultSubmissionsTable, tenantId),
        ),
      )
      .limit(1);

    if (!submission) return res.status(404).json({ error: "Submission not found or not yet verified" });

    const [image] = await db
      .select({
        objectPath: submissionFormImagesTable.objectPath,
        mimeType: submissionFormImagesTable.mimeType,
      })
      .from(submissionFormImagesTable)
      .where(
        and(
          eq(submissionFormImagesTable.id, req.params.imageId),
          eq(submissionFormImagesTable.submissionId, req.params.id),
          sql`${submissionFormImagesTable.objectPath} IS NOT NULL`,
        ),
      )
      .limit(1);

    if (!image?.objectPath) return res.status(404).json({ error: "Image not found" });

    const objectFile = await objectStorageService.getObjectEntityFile(image.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    // Verified form images are immutable — cache aggressively
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    if (image.mimeType) res.setHeader("Content-Type", image.mimeType);
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      if (!["content-type", "cache-control"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    req.log?.error({ err }, "Error serving transparency image");
    res.status(500).json({ error: "Failed to serve image" });
  }
});

export default router;
