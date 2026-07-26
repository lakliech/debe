/**
 * Election Admin API: Elections & Candidates management
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  electionsTable,
  candidatesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";

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

// GET /api/election-admin/elections
router.get("/elections", requireAuth, canManageElections, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(electionsTable).orderBy(desc(electionsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-admin/elections
router.post("/elections", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    // Only pick columns that exist in electionsTable schema
    const { name, year, electionDate, status, isActive } = req.body;
    const [row] = await db.insert(electionsTable).values({
      name, year: Number(year) || year, electionDate, status, isActive,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-admin/elections/active — accessible to any authenticated user (agents, observers)
// MUST be before /:id to avoid wildcard shadowing
router.get("/elections/active", requireAuth, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(electionsTable).orderBy(desc(electionsTable.createdAt));
    // Return all elections for this endpoint; agents need the list to find the active one
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/election-admin/elections/:id
router.patch("/elections/:id", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    // Only pick columns that exist in electionsTable schema
    const { name, year, electionDate, status, isActive } = req.body;
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (year !== undefined) updateData.year = Number(year) || year;
    if (electionDate !== undefined) updateData.electionDate = electionDate;
    if (status !== undefined) updateData.status = status;
    if (isActive !== undefined) updateData.isActive = isActive;
    const [row] = await db.update(electionsTable).set(updateData)
      .where(eq(electionsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Election not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-admin/elections/:id/candidates
router.get("/elections/:id/candidates", requireAuth, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(candidatesTable)
      .where(eq(candidatesTable.electionId, req.params.id))
      .orderBy(candidatesTable.displayOrder);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-admin/elections/:id/candidates
router.post("/elections/:id/candidates", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const [row] = await db.insert(candidatesTable).values({
      ...req.body,
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
    const [row] = await db.update(candidatesTable).set(req.body)
      .where(eq(candidatesTable.id, req.params.cid)).returning();
    if (!row) return res.status(404).json({ error: "Candidate not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/election-admin/elections/:id/candidates/:cid
router.delete("/elections/:id/candidates/:cid", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const [row] = await db.delete(candidatesTable)
      .where(eq(candidatesTable.id, req.params.cid)).returning();
    if (!row) return res.status(404).json({ error: "Candidate not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
