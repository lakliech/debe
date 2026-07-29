/**
 * Event Management API (extended)
 * Registrations, QR check-in, incidents, reconciliation, speakers, transport, media accreditation
 */
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  eventsTable, eventRegistrationsTable, eventIncidentsTable,
  eventReconciliationsTable, eventSpeakersTable, eventTransportTable,
  eventMediaAccreditationsTable, usersTable,
} from "@workspace/db";
import { eq, desc, and, count, ilike, or } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  return row?.id ?? null;
}


// Helper: verify the event belongs to the active tenant. Returns the event row or null.
async function verifyEventTenant(eventId: string, tenantId: string) {
  const [event] = await db.select({ id: eventsTable.id, status: eventsTable.status }).from(eventsTable)
    .where(and(eq(eventsTable.id, eventId), tenantFilter(eventsTable, tenantId))).limit(1);
  return event ?? null;
}

const canViewEvents = requireRoles(["campaign-exec-director","national-campaign-manager","national-organising-director","county-coordinator","constituency-coordinator","ward-coordinator","communications-officer","media-officer","events-coordinator"]);
const canManageEvents = requireRoles(["campaign-exec-director","national-campaign-manager","national-organising-director","county-coordinator","events-coordinator"]);
const canApproveEvents = requireRoles(["campaign-exec-director","national-campaign-manager"]);
const canCheckIn = requireRoles(["campaign-exec-director","county-coordinator","constituency-coordinator","ward-coordinator","events-coordinator","national-organising-director"]);
const canViewTransport = requireRoles(["campaign-exec-director","national-campaign-manager","security-officer"]);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EventCreateSchema = z.object({
  title: z.string().min(1),
  eventDate: z.string().min(1),
  venue: z.string().optional(),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  expectedAttendance: z.number().int().positive().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const EventPatchSchema = z.object({
  title: z.string().min(1).optional(),
  eventDate: z.string().optional(),
  venue: z.string().optional(),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  expectedAttendance: z.number().int().positive().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const RegistrationSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  idNumber: z.string().optional(),
  organization: z.string().optional(),
  registrationType: z.string().optional(),
  notes: z.string().optional(),
});

const CheckInSchema = z.object({
  qrCode: z.string().optional(),
  registrationId: z.string().uuid().optional(),
}).refine((d) => d.qrCode || d.registrationId, {
  message: "Either qrCode or registrationId is required",
});

const IncidentCreateSchema = z.object({
  incidentType: z.string().min(1),
  description: z.string().min(1),
  severity: z.string().optional(),
  location: z.string().optional(),
});

const IncidentResolveSchema = z.object({
  resolution: z.string().min(1),
});

/** Drizzle `numeric` columns accept only string values, not numbers. */
const numericStr = z.union([z.string(), z.number()]).transform((v) => String(v));

const ReconciliationSchema = z.object({
  actualAttendance: z.number().int().nonnegative().optional(),
  actualCostKes: numericStr.optional(),
  budgetedCostKes: numericStr.optional(),
  donationsCollectedKes: numericStr.optional(),
  volunteerHours: z.number().int().nonnegative().optional(),
  lessonsLearned: z.string().optional(),
  mediaImpactNotes: z.string().optional(),
  incidentSummary: z.string().optional(),
  overallRating: z.number().int().min(1).max(5).optional(),
});

const SpeakerSchema = z.object({
  fullName: z.string().min(1),
  title: z.string().optional(),
  topicEn: z.string().optional(),
  topicSw: z.string().optional(),
  allocatedMinutes: z.number().int().nonnegative().optional(),
  talkOrder: z.number().int().nonnegative().optional(),
  confirmed: z.boolean().optional(),
});

const TransportSchema = z.object({
  routeDescription: z.string().optional(),
  vehicleCount: z.number().int().positive().optional(),
  securityBriefing: z.string().optional(),
  notes: z.string().optional(),
});

const MediaAccreditationSchema = z.object({
  journalistName: z.string().min(1),
  mediaHouse: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  idNumber: z.string().optional(),
  pressPassNumber: z.string().optional(),
  coverageType: z.string().optional(),
});

// ─── EVENTS ──────────────────────────────────────────────────────────────────

// GET /api/events-mgmt  (admin list, full details)
router.get("/", requireAuth, canViewEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, countyId, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 20, 50);
    const conds: any[] = [tenantFilter(eventsTable, t.id)];
    if (status) conds.push(eq(eventsTable.status, status));
    if (countyId) conds.push(eq(eventsTable.countyId, countyId));
    if (search) conds.push(ilike(eventsTable.title, `%${search}%`));
    const where = and(...conds);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(eventsTable).where(where).orderBy(desc(eventsTable.eventDate)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(eventsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events-mgmt  — proposal (starts in draft/pending_approval)
router.post("/", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(EventCreateSchema, req.body, res);
    if (!body) return;

    const [event] = await db.insert(eventsTable).values({ ...body, tenantId: t.id, status: body.status ?? "draft" }).returning();
    res.status(201).json(event);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events-mgmt/:id
router.get("/:id", requireAuth, canViewEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [event] = await db.select().from(eventsTable).where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, t.id))).limit(1);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const [registrations, speakers, incidents, reconciliation] = await Promise.all([
      db.select({ count: count() }).from(eventRegistrationsTable).where(eq(eventRegistrationsTable.eventId, req.params.id)),
      db.select().from(eventSpeakersTable).where(eq(eventSpeakersTable.eventId, req.params.id)).orderBy(eventSpeakersTable.talkOrder),
      db.select().from(eventIncidentsTable).where(eq(eventIncidentsTable.eventId, req.params.id)).orderBy(desc(eventIncidentsTable.createdAt)),
      db.select().from(eventReconciliationsTable).where(eq(eventReconciliationsTable.eventId, req.params.id)).limit(1),
    ]);
    res.json({ ...event, registrationCount: Number(registrations[0]?.count ?? 0), speakers, incidents, reconciliation: reconciliation[0] ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events-mgmt/:id
router.patch("/:id", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(EventPatchSchema, req.body, res);
    if (!body) return;

    const [updated] = await db.update(eventsTable).set(body).where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events-mgmt/:id/approve
router.post("/:id/approve", requireAuth, canApproveEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(eventsTable)
      .set({ status: "approved" })
      .where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, t.id), eq(eventsTable.status, "pending_approval")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Event not in pending_approval status" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events-mgmt/:id/submit-approval
router.post("/:id/submit-approval", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(eventsTable)
      .set({ status: "pending_approval" })
      .where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, t.id), eq(eventsTable.status, "draft")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Event must be in draft status" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REGISTRATIONS ────────────────────────────────────────────────────────────

// POST /api/events-mgmt/:id/register  (public — anyone can register)
router.post("/:id/register", async (req: any, res: any) => {
  try {
    const body = validate(RegistrationSchema, req.body, res);
    if (!body) return;

    const tenantId = req.tenant?.id;
    // Tenant context is required — public callers must supply X-Tenant-Slug / ?tenant=
    if (!tenantId) return res.status(404).json({ error: "Event not found" });
    const [event] = await db.select({ id: eventsTable.id, status: eventsTable.status }).from(eventsTable)
      .where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, tenantId))).limit(1);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!["approved", "active"].includes(event.status)) return res.status(400).json({ error: "Event is not open for registration" });

    // Generate unique QR code payload
    const qrCode = `LIND-EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const [registration] = await db.insert(eventRegistrationsTable).values({
      ...body, eventId: req.params.id, qrCode,
    }).returning();
    res.status(201).json({ ...registration, qrCode });
  } catch (err: any) {
    if (err.message?.includes("unique")) return res.status(409).json({ error: "Registration conflict — try again" });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events-mgmt/:id/registrations
router.get("/:id/registrations", requireAuth, canCheckIn, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const { checkedIn, search, page = "1", limit = "50" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 50, 200);
    const conds: any[] = [eq(eventRegistrationsTable.eventId, req.params.id)];
    if (checkedIn === "true") conds.push(eq(eventRegistrationsTable.checkedIn, true));
    if (checkedIn === "false") conds.push(eq(eventRegistrationsTable.checkedIn, false));
    if (search) conds.push(or(ilike(eventRegistrationsTable.fullName, `%${search}%`), ilike(eventRegistrationsTable.phone, `%${search}%`)));
    const where = and(...conds);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(eventRegistrationsTable).where(where).orderBy(eventRegistrationsTable.createdAt).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(eventRegistrationsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events-mgmt/:id/check-in  — QR code or manual check-in
router.post("/:id/check-in", requireAuth, canCheckIn, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(CheckInSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const { qrCode, registrationId } = body;

    const cond = qrCode
      ? and(eq(eventRegistrationsTable.eventId, req.params.id), eq(eventRegistrationsTable.qrCode, qrCode))
      : and(eq(eventRegistrationsTable.eventId, req.params.id), eq(eventRegistrationsTable.id, registrationId!));

    const [reg] = await db.select().from(eventRegistrationsTable).where(cond).limit(1);
    if (!reg) return res.status(404).json({ error: "Registration not found" });
    if (reg.checkedIn) return res.status(409).json({ error: "Already checked in", registration: reg });

    const [updated] = await db.update(eventRegistrationsTable)
      .set({ checkedIn: true, checkedInAt: new Date(), checkedInBy: actorId ?? undefined })
      .where(eq(eventRegistrationsTable.id, reg.id)).returning();
    res.json({ success: true, registration: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INCIDENTS ────────────────────────────────────────────────────────────────

router.post("/:id/incidents", requireAuth, canViewEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(IncidentCreateSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(eventIncidentsTable).values({ ...body, eventId: req.params.id, reportedBy: actorId }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/incidents/:incidentId/resolve", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(IncidentResolveSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(eventIncidentsTable)
      .set({ resolvedBy: actorId ?? undefined, resolvedAt: new Date(), resolution: body.resolution })
      .where(and(eq(eventIncidentsTable.id, req.params.incidentId), eq(eventIncidentsTable.eventId, req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RECONCILIATION ───────────────────────────────────────────────────────────

router.post("/:id/reconciliation", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(ReconciliationSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(eventReconciliationsTable).values({ ...body, eventId: req.params.id, submittedBy: actorId }).returning();
    // Update event status to completed
    await db.update(eventsTable).set({ status: "completed" }).where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, t.id)));
    res.status(201).json(row);
  } catch (err: any) {
    if (err.message?.includes("unique")) return res.status(409).json({ error: "Reconciliation already submitted for this event" });
    res.status(500).json({ error: err.message });
  }
});

// ─── SPEAKERS ─────────────────────────────────────────────────────────────────

router.get("/:id/speakers", requireAuth, canViewEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const rows = await db.select().from(eventSpeakersTable).where(eq(eventSpeakersTable.eventId, req.params.id)).orderBy(eventSpeakersTable.talkOrder);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/speakers", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(SpeakerSchema, req.body, res);
    if (!body) return;

    const [row] = await db.insert(eventSpeakersTable).values({ ...body, eventId: req.params.id }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TRANSPORT (restricted) ───────────────────────────────────────────────────

router.get("/:id/transport", requireAuth, canViewTransport, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const rows = await db.select().from(eventTransportTable).where(eq(eventTransportTable.eventId, req.params.id));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/transport", requireAuth, canViewTransport, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const body = validate(TransportSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(eventTransportTable).values({ ...body, eventId: req.params.id, coordinatorId: actorId ?? undefined }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MEDIA ACCREDITATION ──────────────────────────────────────────────────────

router.get("/:id/media-accreditations", requireAuth, canViewEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const rows = await db.select().from(eventMediaAccreditationsTable).where(eq(eventMediaAccreditationsTable.eventId, req.params.id)).orderBy(desc(eventMediaAccreditationsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/media-accreditations", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    const body = validate(MediaAccreditationSchema, req.body, res);
    if (!body) return;

    // Tenant context is required — public callers must supply X-Tenant-Slug / ?tenant=
    if (!tenantId) return res.status(404).json({ error: "Event not found" });
    const [evt] = await db.select({ id: eventsTable.id }).from(eventsTable)
      .where(and(eq(eventsTable.id, req.params.id), tenantFilter(eventsTable, tenantId))).limit(1);
    if (!evt) return res.status(404).json({ error: "Event not found" });

    const qrCode = `MEDIA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const [row] = await db.insert(eventMediaAccreditationsTable).values({ ...body, eventId: req.params.id, status: "pending", qrCode }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/media-accreditations/:accId/approve", requireAuth, canManageEvents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (!await verifyEventTenant(req.params.id, t.id)) return res.status(404).json({ error: "Event not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(eventMediaAccreditationsTable)
      .set({ status: "approved", approvedBy: actorId ?? undefined })
      .where(and(eq(eventMediaAccreditationsTable.id, req.params.accId), eq(eventMediaAccreditationsTable.eventId, req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
