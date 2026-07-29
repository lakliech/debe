/**
 * Election Admin API: Elections & Candidates management
 */
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  electionsTable,
  candidatesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from "../lib/withTenant";

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

const canManageElections = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "returning-officer",
]);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ElectionCreateSchema = z.object({
  name: z.string().min(1),
  year: z.coerce.number().int(),
  electionDate: z.string().optional(),
  status: z.string().optional(),
  isActive: z.boolean().optional(),
});

const ElectionPatchSchema = z.object({
  name: z.string().min(1).optional(),
  year: z.coerce.number().int().optional(),
  electionDate: z.string().optional(),
  status: z.string().optional(),
  isActive: z.boolean().optional(),
});

const CandidateCreateSchema = z.object({
  fullName: z.string().min(1),
  partyName: z.string().optional(),
  partyAbbreviation: z.string().optional(),
  isOurCandidate: z.boolean().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

const CandidatePatchSchema = z.object({
  fullName: z.string().min(1).optional(),
  partyName: z.string().optional(),
  partyAbbreviation: z.string().optional(),
  isOurCandidate: z.boolean().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

// GET /api/election-admin/elections
router.get("/elections", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(electionsTable)
      .where(tenantFilter(electionsTable, t.id))
      .orderBy(desc(electionsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-admin/elections
router.post("/elections", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(ElectionCreateSchema, req.body, res);
    if (!body) return;

    const { name, year, electionDate, status, isActive } = body;
    const [row] = await db.insert(electionsTable).values({
      tenantId: t.id,
      name, year: Number(year) || year, electionDate, status, isActive,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-admin/elections/active — accessible to any authenticated user (agents, observers)
// MUST be before /:id to avoid wildcard shadowing
router.get("/elections/active", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(electionsTable)
      .where(tenantFilter(electionsTable, t.id))
      .orderBy(desc(electionsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/election-admin/elections/:id
router.patch("/elections/:id", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(ElectionPatchSchema, req.body, res);
    if (!body) return;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.year !== undefined) updateData.year = Number(body.year) || body.year;
    if (body.electionDate !== undefined) updateData.electionDate = body.electionDate;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const [row] = await db.update(electionsTable).set(updateData)
      .where(and(eq(electionsTable.id, req.params.id), tenantFilter(electionsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Election not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-admin/elections/:id/candidates
router.get("/elections/:id/candidates", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // First verify the election belongs to this tenant
    const [election] = await db.select({ id: electionsTable.id }).from(electionsTable)
      .where(and(eq(electionsTable.id, req.params.id), tenantFilter(electionsTable, t.id))).limit(1);
    if (!election) return res.status(404).json({ error: "Election not found" });

    const rows = await db.select().from(candidatesTable)
      .where(and(eq(candidatesTable.electionId, req.params.id), tenantFilter(candidatesTable, t.id)))
      .orderBy(candidatesTable.displayOrder);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-admin/elections/:id/candidates
router.post("/elections/:id/candidates", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(CandidateCreateSchema, req.body, res);
    if (!body) return;

    // Verify election belongs to this tenant
    const [election] = await db.select({ id: electionsTable.id }).from(electionsTable)
      .where(and(eq(electionsTable.id, req.params.id), tenantFilter(electionsTable, t.id))).limit(1);
    if (!election) return res.status(404).json({ error: "Election not found" });

    const [row] = await db.insert(candidatesTable).values({
      ...body,
      tenantId: t.id,
      electionId: req.params.id,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/election-admin/elections/:id/candidates/:cid
router.patch("/elections/:id/candidates/:cid", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(CandidatePatchSchema, req.body, res);
    if (!body) return;

    const [row] = await db.update(candidatesTable).set(body)
      .where(and(
        eq(candidatesTable.id, req.params.cid),
        eq(candidatesTable.electionId, req.params.id),
        tenantFilter(candidatesTable, t.id),
      )).returning();
    if (!row) return res.status(404).json({ error: "Candidate not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/election-admin/elections/:id/candidates/:cid
router.delete("/elections/:id/candidates/:cid", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.delete(candidatesTable)
      .where(and(
        eq(candidatesTable.id, req.params.cid),
        eq(candidatesTable.electionId, req.params.id),
        tenantFilter(candidatesTable, t.id),
      )).returning();
    if (!row) return res.status(404).json({ error: "Candidate not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
