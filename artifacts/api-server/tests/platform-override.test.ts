/**
 * Platform super-admin override tests — the override is total, audited, and
 * platform-standing-only.
 *
 * What this covers (real DB, mocked Clerk session):
 *   A. Plan gates (requirePlanFeature / requirePlanTier / requireCapacity)
 *      pass for the platform super admin on a free-plan campaign, while a
 *      campaign super-admin on the same campaign is still refused.
 *   B. The read-only demo guard lets the platform super admin curate the
 *      demo campaign; everyone else stays blocked.
 *   C. Every platform action — create, suspend/resume (both paths), lifecycle
 *      transitions, campaign enter/exit — produces exactly one audit record,
 *      and the platform-wide activity log serves them to platform standing
 *      only (a campaign super-admin is refused).
 *   D. The four-eyes conflict check flags a campaign user holding conflicting
 *      roles but never flags the platform super admin (documented exemption).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/platform-override.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";

// ─── Mutable auth state — point at the desired user per test ─────────────────
const mockAuth = { userId: "user_override_operator" };

const ts = Date.now();
const OPERATOR_CLERK_ID = "user_override_operator";
const ADMIN_CLERK_ID = "user_override_admin";
const CONFLICT_CLERK_ID = "user_override_conflict";
const OPERATOR_EMAIL = `operator-${ts}@override.test`;
const ADMIN_EMAIL = `admin-${ts}@override.test`;
const CONFLICT_EMAIL = `conflict-${ts}@override.test`;

const EMAILS: Record<string, string> = {
  [OPERATOR_CLERK_ID]: OPERATOR_EMAIL,
  [ADMIN_CLERK_ID]: ADMIN_EMAIL,
  [CONFLICT_CLERK_ID]: CONFLICT_EMAIL,
};
const NAMES: Record<string, string> = {
  [OPERATOR_CLERK_ID]: "Override Operator",
  [ADMIN_CLERK_ID]: "Override Admin",
  [CONFLICT_CLERK_ID]: "Override Conflict",
};
const IDS_BY_EMAIL: Record<string, string[]> = {
  [ADMIN_EMAIL]: [ADMIN_CLERK_ID],
};

// ─── Mock Clerk BEFORE any app import ────────────────────────────────────────
vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock_key",
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

vi.mock("../src/lib/clerkAdmin", () => ({
  clerkUserEmail: vi.fn(async (id: string) => EMAILS[id] ?? null),
  clerkUserName: vi.fn(async (id: string) => NAMES[id] ?? null),
  clerkUserIdsByEmail: vi.fn(async (email: string) => IDS_BY_EMAIL[email] ?? []),
  clerkVerifiedPrimaryEmail: vi.fn(async () => null),
}));

vi.mock("../src/lib/email", () => ({
  sendEmailAsync: vi.fn(),
}));

// ─── App and DB imports (after all mocks are registered) ─────────────────────
import request from "supertest";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  auditLogsTable,
  domainChangeRequestsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requirePlanFeature, requirePlanTier, requireCapacity } from "../src/middlewares/requirePlan";
import { demoGuard } from "../src/middlewares/demoGuard";
import { recordPlatformAction } from "../src/lib/platformAudit";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let tenantAId: string;
let tenantBId: string;
let operatorUserId: string;
let adminUserId: string;
let conflictUserId: string;
const insertedRoleIds: string[] = [];

function asOperator() { mockAuth.userId = OPERATOR_CLERK_ID; }
function asAdmin() { mockAuth.userId = ADMIN_CLERK_ID; }

const FREE_TENANT = {
  slug: "whatever",
  plan: "free",
  planOverrideUntil: null,
  stripeSubscriptionStatus: null,
};

async function ensureRole(slug: string, name: string, level: number): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name, level }).returning();
  insertedRoleIds.push(role.id);
  return role.id;
}

async function auditCount(action: string, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: auditLogsTable.id })
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.action, action), eq(auditLogsTable.tenantId, tenantId)));
  return rows.length;
}

/** Small express app wiring the REAL guard middlewares behind a fixed tenant. */
function gatedApp(tenant: any) {
  const g = express();
  g.use(express.json());
  g.use((req: any, _res, next) => {
    req.clerkId = mockAuth.userId;
    req.tenant = tenant;
    next();
  });
  g.get("/feature", requirePlanFeature("customDomain"), (_req, res) => res.json({ ok: true }));
  g.get("/tier", requirePlanTier("pro"), (_req, res) => res.json({ ok: true }));
  g.post("/capacity", requireCapacity("maxAgents", async () => 999, "agents"), (_req, res) =>
    res.json({ ok: true }),
  );
  g.post("/demo-write", demoGuard, (_req, res) => res.json({ ok: true }));
  return g;
}

beforeAll(async () => {
  const [a] = await db
    .insert(tenantsTable)
    .values({ name: "Override Tenant A", slug: `override-a-${ts}`, plan: "free" })
    .returning();
  tenantAId = a.id;
  const [b] = await db
    .insert(tenantsTable)
    .values({ name: "Override Tenant B", slug: `override-b-${ts}`, plan: "free" })
    .returning();
  tenantBId = b.id;

  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: OPERATOR_CLERK_ID,
      email: OPERATOR_EMAIL,
      fullName: "Override Operator",
      status: "active",
      isGlobalAdmin: true,
      activeTenantId: null,
    })
    .returning();
  operatorUserId = operator.id;

  const [admin] = await db
    .insert(usersTable)
    .values({
      clerkId: ADMIN_CLERK_ID,
      email: ADMIN_EMAIL,
      fullName: "Override Admin",
      status: "active",
      isGlobalAdmin: false,
      activeTenantId: tenantAId,
    })
    .returning();
  adminUserId = admin.id;

  const [conflict] = await db
    .insert(usersTable)
    .values({
      clerkId: CONFLICT_CLERK_ID,
      email: CONFLICT_EMAIL,
      fullName: "Override Conflict",
      status: "active",
      isGlobalAdmin: false,
      activeTenantId: tenantAId,
    })
    .returning();
  conflictUserId = conflict.id;

  const superAdminRole = await ensureRole("super-admin", "Super Administrator", 1);
  const verifierRole = await ensureRole("national-tally-verifier", "National Tally Verifier", 4);
  const financeRole = await ensureRole("finance-manager", "Finance Manager", 5);

  // Campaign admin: super-admin of tenant A only.
  await db.insert(userRolesTable).values({ userId: adminUserId, roleId: superAdminRole, tenantId: tenantAId });

  // Conflict user: roles from two mutually-exclusive privilege groups.
  await db.insert(userRolesTable).values([
    { userId: conflictUserId, roleId: verifierRole, tenantId: tenantAId },
    { userId: conflictUserId, roleId: financeRole, tenantId: tenantAId },
  ]);

  // The operator ALSO holds the same conflicting campaign roles in their own
  // right — the exemption must still keep them out of the violations list.
  await db.insert(userRolesTable).values([
    { userId: operatorUserId, roleId: verifierRole, tenantId: tenantAId },
    { userId: operatorUserId, roleId: financeRole, tenantId: tenantAId },
  ]);
});

afterAll(async () => {
  await db.delete(auditLogsTable).where(
    inArray(auditLogsTable.userId, [operatorUserId, adminUserId, conflictUserId]),
  );
  await db.delete(userRolesTable).where(
    inArray(userRolesTable.userId, [operatorUserId, adminUserId, conflictUserId]),
  );
  await db.delete(usersTable).where(
    inArray(usersTable.id, [operatorUserId, adminUserId, conflictUserId]),
  );
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantAId, tenantBId]));
  if (insertedRoleIds.length) {
    await db.delete(rolesTable).where(inArray(rolesTable.id, insertedRoleIds));
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. The override is total — plan gates
// ═══════════════════════════════════════════════════════════════════════════════

describe("Plan gates yield to platform standing only", () => {
  it("lets the platform super admin use every gated feature on a free-plan campaign", async () => {
    asOperator();
    const g = gatedApp(FREE_TENANT);

    expect((await request(g).get("/feature")).status).toBe(200);
    expect((await request(g).get("/tier")).status).toBe(200);
    expect((await request(g).post("/capacity")).status).toBe(200);
  });

  it("still refuses a campaign super-admin on the same free-plan campaign", async () => {
    asAdmin();
    const g = gatedApp(FREE_TENANT);

    // Campaign roles — even the campaign's own super-admin — must never
    // satisfy a platform override.
    expect((await request(g).get("/feature")).status).toBe(402);
    expect((await request(g).get("/tier")).status).toBe(402);
    expect((await request(g).post("/capacity")).status).toBe(402);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. The override is total — read-only demo guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("Demo guard yields to platform standing only", () => {
  const demoTenant = { ...FREE_TENANT, slug: "demo" };

  it("lets the platform super admin modify the demo campaign", async () => {
    asOperator();
    expect((await request(gatedApp(demoTenant)).post("/demo-write")).status).toBe(200);
  });

  it("still blocks everyone else from modifying the demo campaign", async () => {
    asAdmin();
    const res = await request(gatedApp(demoTenant)).post("/demo-write");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read-only demo/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Every platform action is recorded — and reviewable platform-wide
// ═══════════════════════════════════════════════════════════════════════════════

describe("Platform actions each produce exactly one audit record", () => {
  it("records campaign creation and the founder grant", async () => {
    asOperator();

    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({ name: "Audited Tenant", slug: `override-c-${ts}`, plan: "free", adminEmail: ADMIN_EMAIL });
    expect(res.status).toBe(201);
    const createdId = res.body.tenant.id;

    expect(await auditCount("platform.tenant.create", createdId)).toBe(1);
    expect(await auditCount("platform.membership.grant", createdId)).toBe(1);

    // Clean up the extra tenant (its audit rows cascade with it).
    await db.delete(tenantsTable).where(eq(tenantsTable.id, createdId));
  });

  it("records suspend and resume via the platform route", async () => {
    asOperator();

    await request(app)
      .patch(`/api/platform/tenants/${tenantAId}/suspend`)
      .set("Content-Type", "application/json")
      .send({ isSuspended: true });
    expect(await auditCount("platform.tenant.suspend", tenantAId)).toBe(1);

    await request(app)
      .patch(`/api/platform/tenants/${tenantAId}/suspend`)
      .set("Content-Type", "application/json")
      .send({ isSuspended: false });
    expect(await auditCount("platform.tenant.resume", tenantAId)).toBe(1);
  });

  it("records every lifecycle transition", async () => {
    asOperator();
    const lifecycle = (action: string) =>
      request(app)
        .patch(`/api/platform/tenants/${tenantBId}/lifecycle`)
        .set("Content-Type", "application/json")
        .send({ action });

    expect((await lifecycle("suspend")).status).toBe(200);
    expect(await auditCount("platform.tenant.suspend", tenantBId)).toBe(1);

    expect((await lifecycle("reactivate")).status).toBe(200);
    expect(await auditCount("platform.tenant.resume", tenantBId)).toBe(1);

    expect((await lifecycle("schedule-deletion")).status).toBe(200);
    expect(await auditCount("platform.tenant.schedule-deletion", tenantBId)).toBe(1);

    expect((await lifecycle("cancel-deletion")).status).toBe(200);
    expect(await auditCount("platform.tenant.cancel-deletion", tenantBId)).toBe(1);
  });

  it("records a campaign rename", async () => {
    asOperator();

    const res = await request(app)
      .patch(`/api/platform/tenants/${tenantAId}/rename`)
      .set("Content-Type", "application/json")
      .send({ name: "Override Tenant A Renamed" });
    expect(res.status).toBe(200);
    expect(await auditCount("platform.tenant.rename", tenantAId)).toBe(1);
  });

  it("records a plan change", async () => {
    asOperator();

    const res = await request(app)
      .patch(`/api/platform/tenants/${tenantAId}/plan`)
      .set("Content-Type", "application/json")
      .send({ plan: "pro", months: 1 });
    expect(res.status).toBe(200);
    expect(await auditCount("platform.tenant.plan-change", tenantAId)).toBe(1);

    // Restore the fixture plan.
    await request(app)
      .patch(`/api/platform/tenants/${tenantAId}/plan`)
      .set("Content-Type", "application/json")
      .send({ plan: "free" });
  });

  it("records a domain-change request review", async () => {
    asOperator();

    const [reqRow] = await db
      .insert(domainChangeRequestsTable)
      .values({
        tenantId: tenantBId,
        requestedBy: adminUserId,
        kind: "custom_domain",
        currentValue: null,
        requestedValue: `b-${ts}.example.test`,
      })
      .returning();

    const res = await request(app)
      .patch(`/api/platform/requests/domain/${reqRow.id}`)
      .set("Content-Type", "application/json")
      .send({ approve: true });
    expect(res.status).toBe(200);
    expect(await auditCount("platform.domain-request.review", tenantBId)).toBe(1);
  });

  it("records entering and leaving a customer's campaign", async () => {
    asOperator();

    expect(
      (
        await request(app)
          .put("/api/platform/active-campaign")
          .set("Content-Type", "application/json")
          .send({ tenantId: tenantAId })
      ).status,
    ).toBe(200);
    expect(await auditCount("platform.campaign.enter", tenantAId)).toBe(1);

    expect(
      (
        await request(app)
          .put("/api/platform/active-campaign")
          .set("Content-Type", "application/json")
          .send({ tenantId: null })
      ).status,
    ).toBe(200);
    expect(await auditCount("platform.campaign.exit", tenantAId)).toBe(1);
  });
});

describe("Platform-wide activity log", () => {
  it("serves the recorded actions to platform standing, filterable by campaign and action", async () => {
    asOperator();

    const all = await request(app).get("/api/platform/activity");
    expect(all.status).toBe(200);
    const actions = all.body.map((r: any) => r.action);
    expect(actions).toContain("platform.tenant.suspend");
    expect(actions).toContain("platform.campaign.enter");

    const filtered = await request(app).get(
      `/api/platform/activity?tenantId=${tenantBId}&action=platform.tenant.schedule-deletion`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBe(1);
    expect(filtered.body[0].tenantSlug).toBe(`override-b-${ts}`);
    expect(filtered.body[0].userEmail).toBe(OPERATOR_EMAIL);
  });

  it("refuses a campaign super-admin outright", async () => {
    asAdmin();
    expect((await request(app).get("/api/platform/activity")).status).toBe(403);
  });

  it("filters by operator email server-side, spanning all pages", async () => {
    asOperator();

    const res = await request(app).get(
      `/api/platform/activity?email=${encodeURIComponent(OPERATOR_EMAIL)}&limit=200`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((r: any) => r.userEmail === OPERATOR_EMAIL)).toBe(true);

    // The campaign admin performed no platform actions — no rows, on any page.
    const none = await request(app).get(
      `/api/platform/activity?email=${encodeURIComponent(ADMIN_EMAIL)}`,
    );
    expect(none.status).toBe(200);
    expect(none.body.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Audit durability — fail closed, never silent
// ═══════════════════════════════════════════════════════════════════════════════

describe("Audit durability", () => {
  it("a recording failure propagates instead of being swallowed", async () => {
    // No local user exists for this clerk id — recording must refuse loudly
    // rather than write an anonymous row or silently skip the record.
    await expect(
      recordPlatformAction(
        { clerkId: "user_override_ghost", headers: {}, ip: null } as any,
        { action: "platform.test", resource: "test" },
      ),
    ).rejects.toThrow(/no local user/i);
  });

  it("an unauthenticated caller cannot record at all", async () => {
    await expect(
      recordPlatformAction({ headers: {}, ip: null } as any, {
        action: "platform.test",
        resource: "test",
      }),
    ).rejects.toThrow(/no authenticated actor/i);
  });

  it("a recording failure inside the transaction rolls the mutation back", async () => {
    // Wire a route the way the platform routes do: mutation + record in ONE
    // transaction. The ghost clerk id makes recording fail — the plan change
    // must NOT survive.
    const atomic = express();
    atomic.use(express.json());
    atomic.use((req: any, _res, next) => {
      req.clerkId = "user_override_ghost";
      next();
    });
    atomic.patch("/tenant/:id/plan", async (req: any, res: any) => {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(tenantsTable)
            .set({ plan: "pro" })
            .where(eq(tenantsTable.id, req.params.id));
          await recordPlatformAction(
            req,
            { action: "platform.test", resource: "test", tenantId: req.params.id },
            tx,
          );
        });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    const res = await request(atomic).patch(`/tenant/${tenantAId}/plan`);
    expect(res.status).toBe(500);

    const [t] = await db
      .select({ plan: tenantsTable.plan })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantAId))
      .limit(1);
    expect(t.plan).toBe("free");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Separation of duties — platform standing is exempt, campaign users are not
// ═══════════════════════════════════════════════════════════════════════════════

describe("Four-eyes conflict check", () => {
  it("flags the conflicted campaign user but never the platform super admin", async () => {
    asOperator();
    // The review is tenant-scoped — the operator must be inside the campaign.
    await request(app)
      .put("/api/platform/active-campaign")
      .set("Content-Type", "application/json")
      .send({ tenantId: tenantAId });

    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).toBe(200);

    const flaggedIds = res.body.violations.map((v: any) => v.userId);
    expect(flaggedIds).toContain(conflictUserId);
    expect(flaggedIds).not.toContain(operatorUserId);

    // Leave the campaign again so the operator fixture ends tenantless.
    await request(app)
      .put("/api/platform/active-campaign")
      .set("Content-Type", "application/json")
      .send({ tenantId: null });
  });
});
