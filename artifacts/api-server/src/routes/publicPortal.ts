/**
 * Public portal routes — no authentication required.
 * Serves content for the campaign's public-facing website.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { publicSubmitLimiter } from "../middlewares/rateLimits";
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
} from "@workspace/db";
import { eq, and, desc, asc, count } from "drizzle-orm";
import { aspirantsTable, contactMessagesTable } from "@workspace/db";

const router = Router();

// GET /api/public/stats — public portal stats card
router.get("/stats", async (req: any, res: any) => {
  try {
    const [volunteerCount] = await db.select({ total: count() }).from(volunteersTable)
      .where(eq(volunteersTable.status, "active"));
    const [supporterCount] = await db.select({ total: count() }).from(supportersTable)
      .where(eq(supportersTable.optedOut, false));
    const [branding] = await db.select().from(brandingTable).limit(1);

    res.json({
      volunteers: Number(volunteerCount?.total ?? 0),
      supporters: Number(supporterCount?.total ?? 0),
      campaignName: branding?.campaignName ?? "Linda Mwananchi",
      tagline: branding?.tagline ?? "It's Time. Be Part of the Change.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/manifesto/sectors
router.get("/manifesto/sectors", async (req: any, res: any) => {
  try {
    const sectors = await db
      .select()
      .from(manifestoSectorsTable)
      .orderBy(asc(manifestoSectorsTable.displayOrder));
    res.json(sectors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/manifesto/sectors/:slug
router.get("/manifesto/sectors/:slug", async (req: any, res: any) => {
  try {
    const [sector] = await db
      .select()
      .from(manifestoSectorsTable)
      .where(eq(manifestoSectorsTable.slug, req.params.slug))
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
        eq(policySubmissionsTable.status, "published")
      ))
      .limit(10);

    res.json({ sector, items, recentSubmissions: submissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/county-priorities/:countyCode
router.get("/county-priorities/:countyCode", async (req: any, res: any) => {
  try {
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
      .where(eq(countyPrioritiesTable.countyId, county.id))
      .orderBy(asc(countyPrioritiesTable.priority));

    res.json({ county, priorities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/events
router.get("/events", async (req: any, res: any) => {
  try {
    const { countyId, upcoming } = req.query;
    const events = await db
      .select()
      .from(eventsTable)
      .where(and(
        eq(eventsTable.status, "published"),
        countyId ? eq(eventsTable.countyId, countyId) : undefined
      ))
      .orderBy(asc(eventsTable.eventDate))
      .limit(20);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/news
router.get("/news", async (req: any, res: any) => {
  try {
    const { category, page = "1" } = req.query;
    const pageNum = parseInt(page as string) || 1;
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
        category ? eq(newsArticlesTable.category, category as string) : undefined
      ))
      .orderBy(desc(newsArticlesTable.publishedAt))
      .limit(12)
      .offset((pageNum - 1) * 12);
    res.json(articles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/news/:slug
router.get("/news/:slug", async (req: any, res: any) => {
  try {
    const [article] = await db
      .select()
      .from(newsArticlesTable)
      .where(and(eq(newsArticlesTable.slug, req.params.slug), eq(newsArticlesTable.status, "published")))
      .limit(1);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/faq
router.get("/faq", async (req: any, res: any) => {
  try {
    const { category } = req.query;
    const items = await db
      .select()
      .from(faqItemsTable)
      .where(and(
        eq(faqItemsTable.published, true),
        category ? eq(faqItemsTable.category, category as string) : undefined
      ))
      .orderBy(asc(faqItemsTable.displayOrder));
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/fact-check
router.get("/fact-check", async (req: any, res: any) => {
  try {
    const items = await db
      .select()
      .from(factCheckItemsTable)
      .orderBy(desc(factCheckItemsTable.publishedAt))
      .limit(20);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/volunteer-register — self-registration (no auth)
router.post("/volunteer-register", publicSubmitLimiter, async (req: any, res: any) => {
  try {
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/supporter-register — self-registration (no auth)
router.post("/supporter-register", publicSubmitLimiter, async (req: any, res: any) => {
  try {
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/aspirants — aspirant self-registration (no auth)
router.post("/aspirants", publicSubmitLimiter, async (req: any, res: any) => {
  try {
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

    const [aspirant] = await db
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
        status: "pending",
        consentGiven: true,
      })
      .returning({ id: aspirantsTable.id, fullName: aspirantsTable.fullName, status: aspirantsTable.status });

    res.status(201).json({
      message: "Declaration received. The Linda Mwananchi 2027 team will review your application.",
      aspirant,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/aspirants — approved aspirants directory (no auth, no PII)
router.get("/aspirants", async (req: any, res: any) => {
  try {
    const { position, county, page = "1", limit = "24" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(48, parseInt(limit as string) || 24);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [eq(aspirantsTable.status, "approved")];
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/contact — general contact form (no auth)
router.post("/contact", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "name, email, subject, and message are required" });
    }

    const [contact] = await db
      .insert(contactMessagesTable)
      .values({ fullName: name, email, subject, message, status: "open" })
      .returning({ id: contactMessagesTable.id });

    res.status(201).json({ message: "Message received. Our team will get back to you within 2–3 business days.", contactId: contact.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/policy-submit — citizen policy submissions
router.post("/policy-submit", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const { title, content, sectorId, countyId, anonymous } = req.body;
    if (!title || !content) return res.status(400).json({ error: "title and content are required" });

    const [submission] = await db
      .insert(policySubmissionsTable)
      .values({
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
