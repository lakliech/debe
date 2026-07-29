/**
 * Platform administration routes — cross-tenant, super-operator only.
 *
 * These routes are NOT wrapped in resolveTenant so they can see all tenants.
 * Access is gated behind requireLevel(0) — only the platform_admin role (level 0)
 * passes. All other campaign roles start at level 1.
 *
 * Endpoints:
 *   GET    /api/platform/tenants          — list all tenants with user counts
 *   POST   /api/platform/tenants          — create Clerk org + tenant row + send invitation
 *   GET    /api/platform/tenants/:id      — single tenant detail
 *   PATCH  /api/platform/tenants/:id/suspend — toggle suspension
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { tenantsTable, userRolesTable, brandingTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireLevel } from "../middlewares/rbac";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

// ── Clerk Backend API helper (uses secret key directly — @clerk/backend is not a direct dep) ──
const CLERK_API = "https://api.clerk.com/v1";

async function clerkPost(path: string, body: Record<string, unknown>) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const res = await fetch(`${CLERK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) {
    const msg = json?.errors?.[0]?.long_message ?? json?.errors?.[0]?.message ?? `Clerk API ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ── Shared: all-tenant query with user counts ─────────────────────────────────
async function listTenantsWithCounts() {
  return db
    .select({
      id: tenantsTable.id,
      clerkOrgId: tenantsTable.clerkOrgId,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      plan: tenantsTable.plan,
      isSuspended: tenantsTable.isSuspended,
      createdAt: tenantsTable.createdAt,
      userCount: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)`,
    })
    .from(tenantsTable)
    .leftJoin(userRolesTable, eq(userRolesTable.tenantId, tenantsTable.id))
    .groupBy(
      tenantsTable.id,
      tenantsTable.clerkOrgId,
      tenantsTable.name,
      tenantsTable.slug,
      tenantsTable.plan,
      tenantsTable.isSuspended,
      tenantsTable.createdAt,
    )
    .orderBy(tenantsTable.createdAt);
}

// ── GET /api/platform/tenants ─────────────────────────────────────────────────
router.get("/tenants", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const tenants = await listTenantsWithCounts();
    res.json(tenants);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/platform/tenants ────────────────────────────────────────────────
router.post("/tenants", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { name, slug, adminEmail, plan = "free" } = req.body as {
      name?: string;
      slug?: string;
      adminEmail?: string;
      plan?: string;
    };

    if (!name || !slug) {
      return res.status(400).json({ error: "name and slug are required" });
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: "slug must be lowercase alphanumeric and hyphens only" });
    }

    // Check slug uniqueness before hitting Clerk
    const [existing] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1);
    if (existing) {
      return res.status(409).json({ error: `Tenant slug '${slug}' is already taken` });
    }

    // Create Clerk organisation — falls back to a stub org ID if Clerk key is missing (dev mode)
    let clerkOrgId: string;
    try {
      const org = await clerkPost("/organizations", {
        name,
        slug,
        created_by_user_id: req.clerkId,
      });
      clerkOrgId = org.id;
    } catch (clerkErr: any) {
      // If Clerk org creation fails, surface the error — we cannot proceed without an org ID
      return res.status(502).json({ error: `Failed to create Clerk organisation: ${clerkErr.message}` });
    }

    // Insert tenant row
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name, slug, clerkOrgId, plan })
      .returning();

    // Send invitation to the designated admin email (best-effort — don't block tenant creation on failure)
    let invitationWarning: string | null = null;
    if (adminEmail) {
      try {
        await clerkPost(`/organizations/${clerkOrgId}/invitations`, {
          email_address: adminEmail,
          role: "org:admin",
          inviter_user_id: req.clerkId,
        });
      } catch (invErr: any) {
        invitationWarning = `Tenant created but invitation failed: ${invErr.message}`;
      }
    }

    res.status(201).json({
      tenant,
      invitationWarning,
      message: invitationWarning
        ? invitationWarning
        : adminEmail
          ? `Tenant created and invitation sent to ${adminEmail}`
          : "Tenant created. No admin email provided — invite from the tenant detail page.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/platform/tenants/:id ────────────────────────────────────────────
router.get("/tenants/:id", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const [row] = await db
      .select({
        id: tenantsTable.id,
        clerkOrgId: tenantsTable.clerkOrgId,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        plan: tenantsTable.plan,
        isSuspended: tenantsTable.isSuspended,
        createdAt: tenantsTable.createdAt,
        userCount: sql<number>`CAST(COUNT(DISTINCT ${userRolesTable.userId}) AS INTEGER)`,
      })
      .from(tenantsTable)
      .leftJoin(userRolesTable, eq(userRolesTable.tenantId, tenantsTable.id))
      .where(eq(tenantsTable.id, id))
      .groupBy(
        tenantsTable.id,
        tenantsTable.clerkOrgId,
        tenantsTable.name,
        tenantsTable.slug,
        tenantsTable.plan,
        tenantsTable.isSuspended,
        tenantsTable.createdAt,
      )
      .limit(1);

    if (!row) return res.status(404).json({ error: "Tenant not found" });

    // Attach branding snapshot (counts only — no private data)
    const [branding] = await db
      .select({
        campaignName: brandingTable.campaignName,
        candidateName: brandingTable.candidateName,
        electionLevel: (brandingTable as any).electionLevel,
        electionYear: brandingTable.electionYear,
        primaryColor: brandingTable.primaryColor,
      })
      .from(brandingTable)
      .where(eq(brandingTable.tenantId, id))
      .limit(1);

    res.json({ ...row, branding: branding ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/platform/tenants/:id/suspend ───────────────────────────────────
router.patch("/tenants/:id/suspend", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { isSuspended } = req.body as { isSuspended?: boolean };

    if (typeof isSuspended !== "boolean") {
      return res.status(400).json({ error: "isSuspended (boolean) is required" });
    }

    const [tenant] = await db
      .update(tenantsTable)
      .set({ isSuspended })
      .where(eq(tenantsTable.id, id))
      .returning();

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    res.json(tenant);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/platform/tenants/:id/invite ─────────────────────────────────────
// Send (or resend) an org invitation from the detail page
router.post("/tenants/:id/invite", requireAuth, requireLevel(0), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { adminEmail } = req.body as { adminEmail?: string };

    if (!adminEmail) return res.status(400).json({ error: "adminEmail is required" });

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id))
      .limit(1);

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    await clerkPost(`/organizations/${tenant.clerkOrgId}/invitations`, {
      email_address: adminEmail,
      role: "org:admin",
      inviter_user_id: req.clerkId,
    });

    res.json({ message: `Invitation sent to ${adminEmail}` });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
