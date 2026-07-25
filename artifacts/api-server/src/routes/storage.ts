import { Readable } from 'stream';
import { Router, type IRouter, type Request, type Response } from 'express';
import { getAuth } from '@clerk/express';
import { db } from '@workspace/db';
import { contentAssetsTable, usersTable, userRolesTable, rolesTable } from '@workspace/db';
import { eq, and } from 'drizzle-orm';

// Inline validation helpers (replaces codegen-derived Zod schemas)
const RequestUploadUrlBody = {
  safeParse(body: unknown): { success: boolean; data: { name: string; size?: number; contentType?: string } } {
    if (!body || typeof body !== 'object') return { success: false, data: { name: '' } };
    const b = body as Record<string, unknown>;
    if (typeof b.name !== 'string' || !b.name) return { success: false, data: { name: '' } };
    return { success: true, data: { name: b.name, size: typeof b.size === 'number' ? b.size : undefined, contentType: typeof b.contentType === 'string' ? b.contentType : undefined } };
  },
};
const RequestUploadUrlResponse = {
  parse(data: unknown) { return data; },
};

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const CONTENT_MANAGER_ROLES = new Set([
  'campaign-exec-director', 'national-campaign-manager', 'communications-officer',
]);

function requireClerkAuth(req: Request, res: Response): string | null {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return auth.userId;
}

/** Resolve actor roles from Clerk userId. Returns empty array if user not found. */
async function getActorRoles(clerkUserId: string): Promise<string[]> {
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.clerkId, clerkUserId)).limit(1);
  if (!user) return [];
  const roleRows = await db
    .select({ slug: rolesTable.slug })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, user.id));
  return roleRows.map(r => r.slug);
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * Requires Clerk auth — only authenticated staff can mint upload URLs.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    const clerkUserId = requireClerkAuth(req, res);
    if (!clerkUserId) return;

    // Only content managers may request upload URLs
    const roles = await getActorRoles(clerkUserId);
    const isManager = roles.some(r => CONTENT_MANAGER_ROLES.has(r));
    if (!isManager) {
      res.status(403).json({ error: 'Forbidden: content manager role required' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath, metadata: { name, size, contentType } }));
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * Unconditionally public — no authentication required.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const response = await objectStorageService.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve private object entities.
 * Authorization rules:
 *  1. Must be Clerk-authenticated.
 *  2. The object path must correspond to a content_assets record.
 *  3. If the asset is NOT approved: only content managers can access it.
 *  4. If the asset IS approved: any canViewLibrary role may access it.
 *     (canViewLibrary roles are checked inline; the download endpoint is the
 *      canonical approved-asset access path — this endpoint exists for direct
 *      manager previews and the download flow.)
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const clerkUserId = requireClerkAuth(req, res);
    if (!clerkUserId) return;

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Look up the asset by objectPath in the content catalogue
    const [asset] = await db
      .select({ id: contentAssetsTable.id, approvalStatus: contentAssetsTable.approvalStatus })
      .from(contentAssetsTable)
      .where(eq(contentAssetsTable.objectPath, objectPath))
      .limit(1);

    if (!asset) {
      // Not catalogued — deny all access (no orphan object serving)
      res.status(404).json({ error: 'Object not found in catalogue' });
      return;
    }

    // Resolve caller's roles
    const roles = await getActorRoles(clerkUserId);
    const isManager = roles.some(r => CONTENT_MANAGER_ROLES.has(r));

    const VIEW_ROLES = new Set([
      'campaign-exec-director', 'national-campaign-manager', 'communications-officer',
      'county-coordinator', 'constituency-coordinator', 'legal-officer', 'media-officer',
    ]);
    const canView = roles.some(r => VIEW_ROLES.has(r));

    if (!canView) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Non-approved assets: only managers can preview
    if (asset.approvalStatus !== 'approved' && !isManager) {
      res.status(403).json({ error: 'Asset not yet approved for access' });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
