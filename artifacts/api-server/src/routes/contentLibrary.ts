/**
 * Digital Content Library API
 * Asset catalogue, versioning, download tracking, role-based access
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  contentAssetsTable, assetVersionsTable, downloadRecordsTable, usersTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or, count } from "drizzle-orm";
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

// County teams can access but only edit their own county's pending assets
const MANAGER_ROLES = new Set(["campaign-exec-director","national-campaign-manager","communications-officer"]);

const canViewLibrary = requireRoles([
  "campaign-exec-director","national-campaign-manager","communications-officer",
  "county-coordinator","constituency-coordinator","legal-officer","media-officer",
]);
const canManageLibrary = requireRoles(["campaign-exec-director","national-campaign-manager","communications-officer"]);
const canApproveAssets = requireRoles(["campaign-exec-director","national-campaign-manager","communications-officer"]);

/** Redact objectPath from non-approved assets for non-managers */
function redactAsset(asset: any, actorRoles: string[]): any {
  const isManager = actorRoles.some(r => MANAGER_ROLES.has(r));
  if (!isManager && asset.approvalStatus !== "approved") {
    const { objectPath: _omit, ...rest } = asset;
    return { ...rest, objectPath: null };
  }
  return asset;
}

// GET /api/content/assets
router.get("/assets", requireAuth, canViewLibrary, async (req: any, res: any) => {
  try {
    const { category, approvalStatus, countyId, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conds: any[] = [];
    if (category) conds.push(eq(contentAssetsTable.category, category));
    if (approvalStatus) conds.push(eq(contentAssetsTable.approvalStatus, approvalStatus));
    if (countyId) conds.push(eq(contentAssetsTable.countyId, countyId));
    if (search) conds.push(or(ilike(contentAssetsTable.title, `%${search}%`), ilike(contentAssetsTable.description, `%${search}%`)));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(contentAssetsTable).where(where).orderBy(desc(contentAssetsTable.updatedAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(contentAssetsTable).where(where),
    ]);
    const actorRoles: string[] = (req as any).actorRoles ?? [];
    res.json({ data: rows.map(r => redactAsset(r, actorRoles)), total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/assets — create catalogue entry after file is uploaded to GCS
router.post("/assets", requireAuth, canManageLibrary, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [asset] = await db.insert(contentAssetsTable).values({ ...req.body, owner: actorId, approvalStatus: "pending" }).returning();
    // Create initial version record
    await db.insert(assetVersionsTable).values({ assetId: asset.id, version: 1, objectPath: asset.objectPath, uploadedBy: actorId });
    res.status(201).json(asset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/assets/:id
router.get("/assets/:id", requireAuth, canViewLibrary, async (req: any, res: any) => {
  try {
    const [asset] = await db.select().from(contentAssetsTable).where(eq(contentAssetsTable.id, req.params.id)).limit(1);
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    const versions = await db.select().from(assetVersionsTable).where(eq(assetVersionsTable.assetId, req.params.id)).orderBy(desc(assetVersionsTable.version));
    const [{ total: dlCount }] = await db.select({ total: count() }).from(downloadRecordsTable).where(eq(downloadRecordsTable.assetId, req.params.id));
    const actorRoles: string[] = (req as any).actorRoles ?? [];
    // For non-managers, also redact objectPath from version records if asset isn't approved
    const isManager = actorRoles.some(r => MANAGER_ROLES.has(r));
    const safeVersions = isManager || asset.approvalStatus === "approved"
      ? versions
      : versions.map(({ objectPath: _o, ...v }) => ({ ...v, objectPath: null }));
    res.json({ ...redactAsset(asset, actorRoles), versions: safeVersions, downloadCount: Number(dlCount) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/content/assets/:id
// Managers (campaign-exec-director, national-campaign-manager, communications-officer):
//   may edit any asset at any status across any county.
// County roles (county-coordinator, constituency-coordinator):
//   may only edit assets in their own county AND only when status is 'pending'.
//   Allowed fields restricted to: title, description, tags, language.
router.patch("/assets/:id", requireAuth, canViewLibrary, async (req: any, res: any) => {
  try {
    const actorRoles: string[] = (req as any).actorRoles ?? [];
    const isManager = actorRoles.some(r => MANAGER_ROLES.has(r));

    // Fetch actor and asset concurrently
    const [[actorRow], [asset]] = await Promise.all([
      db.select({ id: usersTable.id, countyId: usersTable.countyId })
        .from(usersTable).where(eq(usersTable.clerkId, req.clerkId)).limit(1),
      db.select().from(contentAssetsTable).where(eq(contentAssetsTable.id, req.params.id)).limit(1),
    ]);

    if (!asset) return res.status(404).json({ error: "Not found" });
    if (!actorRow) return res.status(403).json({ error: "Actor not found" });

    const COUNTY_EDIT_ROLES = new Set(["county-coordinator", "constituency-coordinator"]);
    const isCountyRole = actorRoles.some(r => COUNTY_EDIT_ROLES.has(r));

    if (!isManager) {
      // Only county-coordinator and constituency-coordinator may edit (with scope restrictions)
      // All other view-only roles (legal-officer, media-officer, etc.) are denied
      if (!isCountyRole) {
        return res.status(403).json({ error: "Forbidden: insufficient role to edit content assets" });
      }
      // County role: enforce county ownership constraint
      if (!actorRow.countyId || actorRow.countyId !== asset.countyId) {
        return res.status(403).json({ error: "Forbidden: asset belongs to a different county" });
      }
      // Enforce pending-only constraint
      if (asset.approvalStatus !== "pending") {
        return res.status(403).json({ error: "Forbidden: only pending assets may be edited at county level" });
      }
    }

    const allowedFields = ["title", "description", "tags", "language"];
    const fullEditFields = [...allowedFields, "category", "publishingRights", "expiresAt", "objectPath"];
    const editableBody = isManager
      ? Object.fromEntries(Object.entries(req.body).filter(([k]) => fullEditFields.includes(k)))
      : Object.fromEntries(Object.entries(req.body).filter(([k]) => allowedFields.includes(k)));

    if (Object.keys(editableBody).length === 0) {
      return res.status(400).json({ error: "No editable fields provided" });
    }

    const [updated] = await db.update(contentAssetsTable)
      .set(editableBody)
      .where(eq(contentAssetsTable.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/assets/:id/approve
router.post("/assets/:id/approve", requireAuth, canApproveAssets, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(contentAssetsTable)
      .set({ approvalStatus: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(eq(contentAssetsTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/assets/:id/reject
router.post("/assets/:id/reject", requireAuth, canApproveAssets, async (req: any, res: any) => {
  try {
    const [updated] = await db.update(contentAssetsTable)
      .set({ approvalStatus: "rejected" })
      .where(eq(contentAssetsTable.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/assets/:id/versions — upload a new version
router.post("/assets/:id/versions", requireAuth, canManageLibrary, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [latest] = await db.select({ version: assetVersionsTable.version }).from(assetVersionsTable)
      .where(eq(assetVersionsTable.assetId, req.params.id)).orderBy(desc(assetVersionsTable.version)).limit(1);
    const newVersion = (latest?.version ?? 0) + 1;
    const [row] = await db.insert(assetVersionsTable).values({
      assetId: req.params.id, version: newVersion, objectPath: req.body.objectPath,
      changeNote: req.body.changeNote, uploadedBy: actorId,
    }).returning();
    await db.update(contentAssetsTable).set({ currentVersion: newVersion, objectPath: req.body.objectPath, approvalStatus: "pending" })
      .where(eq(contentAssetsTable.id, req.params.id));
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/assets/:id/download — record download and return signed URL
router.post("/assets/:id/download", requireAuth, canViewLibrary, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [asset] = await db.select().from(contentAssetsTable).where(eq(contentAssetsTable.id, req.params.id)).limit(1);
    if (!asset) return res.status(404).json({ error: "Not found" });
    if (asset.approvalStatus !== "approved") return res.status(403).json({ error: "Asset not yet approved for download" });

    // Record the download
    await db.insert(downloadRecordsTable).values({
      assetId: asset.id, downloadedBy: actorId ?? undefined,
      purpose: req.body.purpose, ipAddress: req.ip,
    });
    await db.update(contentAssetsTable).set({ downloadCount: (asset.downloadCount ?? 0) + 1 }).where(eq(contentAssetsTable.id, asset.id));

    // Return the GCS object path — client fetches via /api/storage/objects/{path}
    res.json({ objectPath: asset.objectPath, title: asset.title });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/assets/:id/history
router.get("/assets/:id/history", requireAuth, canViewLibrary, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(downloadRecordsTable)
      .where(eq(downloadRecordsTable.assetId, req.params.id))
      .orderBy(desc(downloadRecordsTable.createdAt)).limit(100);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
