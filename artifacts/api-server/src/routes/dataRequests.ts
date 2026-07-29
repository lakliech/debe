/**
 * Data Subject Requests — GDPR/Kenya DPA 2019 workflow.
 * Access, correction, deletion requests by data subjects.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { dataSubjectRequestsTable, supportersTable, volunteersTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { publicSubmitLimiter } from "../middlewares/rateLimits";
import { DATA_REQUEST_TYPES } from "@workspace/api-zod";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canManageDSRs = requireRoles([
  "data-protection-officer",
  "legal-officer",
  "campaign-exec-director",
]);

// GET /api/data-requests
router.get("/", requireAuth, canManageDSRs, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, type, page = "1" } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limit = 20;
    const offset = (pageNum - 1) * limit;

    const rows = await db
      .select()
      .from(dataSubjectRequestsTable)
      .where(
        and(
          tenantFilter(dataSubjectRequestsTable, t.id),
          status ? eq(dataSubjectRequestsTable.status, status as string) : undefined,
          type ? eq(dataSubjectRequestsTable.requestType, type as string) : undefined
        )
      )
      .orderBy(desc(dataSubjectRequestsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ total: count() })
      .from(dataSubjectRequestsTable)
      .where(and(tenantFilter(dataSubjectRequestsTable, t.id), status ? eq(dataSubjectRequestsTable.status, status as string) : undefined));

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data-requests — public, anyone can submit
router.post("/", publicSubmitLimiter, async (req: any, res: any) => {
  try {
    const { requestType, fullName, email, phoneNumber, description, subjectType, subjectId } = req.body;
    if (!requestType || !fullName) {
      return res.status(400).json({ error: "requestType and fullName are required" });
    }
    if (!(DATA_REQUEST_TYPES as readonly string[]).includes(requestType)) {
      return res.status(400).json({ error: `requestType must be ${DATA_REQUEST_TYPES.join(" | ")}` });
    }

    // Require tenant context — public callers must supply X-Tenant-Slug / ?tenant=
    const tenantId: string | undefined = (req as any).tenant?.id;
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenant context: please supply the X-Tenant-Slug header or ?tenant= query parameter" });
    }

    const [request] = await db
      .insert(dataSubjectRequestsTable)
      .values({
        tenantId,
        requestType,
        fullName,
        subjectEmail: email,
        phoneNumber,
        description,
        subjectType,
        subjectId,
        status: "pending",
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 30 days
      })
      .returning({ id: dataSubjectRequestsTable.id, status: dataSubjectRequestsTable.status });

    res.status(201).json({ message: "Your request has been received. We will respond within 30 days.", requestId: request.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data-requests/:id
router.get("/:id", requireAuth, canManageDSRs, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [request] = await db
      .select()
      .from(dataSubjectRequestsTable)
      .where(and(eq(dataSubjectRequestsTable.id, req.params.id), tenantFilter(dataSubjectRequestsTable, t.id)))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request not found" });
    res.json(request);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/data-requests/:id
router.patch("/:id", requireAuth, canManageDSRs, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, resolutionNotes, resolvedAt } = req.body;
    const [updated] = await db
      .update(dataSubjectRequestsTable)
      .set({
        ...(status !== undefined && { status }),
        ...(resolutionNotes !== undefined && { resolutionNotes }),
        ...(resolvedAt !== undefined ? { resolvedAt: new Date(resolvedAt) } : status === "resolved" ? { resolvedAt: new Date() } : {}),
      })
      .where(and(eq(dataSubjectRequestsTable.id, req.params.id), tenantFilter(dataSubjectRequestsTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Request not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data-requests/:id/resolve
router.post("/:id/resolve", requireAuth, canManageDSRs, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { resolutionNotes, action } = req.body;
    const [request] = await db
      .select()
      .from(dataSubjectRequestsTable)
      .where(and(eq(dataSubjectRequestsTable.id, req.params.id), tenantFilter(dataSubjectRequestsTable, t.id)))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request not found" });

    // If deletion request and confirmed, delete the subject record
    // Tenant-scoped: only delete records belonging to this tenant to prevent cross-tenant writes
    if (request.requestType === "deletion" && action === "confirm_delete" && request.subjectId) {
      if (request.subjectType === "supporter") {
        await db.delete(supportersTable)
          .where(and(eq(supportersTable.id, request.subjectId), tenantFilter(supportersTable, t.id)));
      } else if (request.subjectType === "volunteer") {
        await db.update(volunteersTable)
          .set({ fullName: "[DELETED]", email: null, phoneNumber: "[DELETED]", status: "deactivated" })
          .where(and(eq(volunteersTable.id, request.subjectId), tenantFilter(volunteersTable, t.id)));
      }
    }

    const [updated] = await db
      .update(dataSubjectRequestsTable)
      .set({ status: "resolved", resolutionNotes, resolvedAt: new Date() })
      .where(and(eq(dataSubjectRequestsTable.id, req.params.id), tenantFilter(dataSubjectRequestsTable, t.id)))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
