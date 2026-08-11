/**
 * Public demo auto-login — route-level integration tests.
 *
 * The demo session endpoint is the one place in the app that hands out a
 * signed-in identity to a caller who has proved nothing at all, so the things
 * worth pinning down are: it only ever grants the demo campaign, it refuses
 * loudly instead of degrading, and what it grants still cannot write.
 *
 * Clerk is mocked (both the request-side auth and the Backend API helpers) so
 * no real accounts or tickets are created. The demo account is pointed at a
 * throwaway email via DEMO_VISITOR_EMAIL so a real seeded demo account in the
 * same database is left untouched.
 *
 * Run with: pnpm --filter @workspace/api-server exec vitest run src/tests/demo-session.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Environment must be set before the app (and the route) reads it ─────────

const TEST_DEMO_EMAIL = `demo_visitor_test_${Date.now()}@demo.test`;
const TEST_DEMO_CLERK_ID = `user_test_demo_${Date.now()}`;
const FAKE_TICKET = "tkt_test_fake_ticket";

process.env.DEMO_VISITOR_EMAIL = TEST_DEMO_EMAIL;
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || "sk_test_placeholder";

// ─── Mock Clerk BEFORE any app import (vi.mock is hoisted) ───────────────────

const mockAuth = { userId: "" as string | null };

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

// Only the two calls the demo route makes are replaced; everything else in the
// module (used by identity resolution elsewhere) keeps its real implementation.
const clerkPostSpy = vi.fn(async (path: string, _body?: Record<string, unknown>) => {
  if (path === "/sign_in_tokens") return { token: FAKE_TICKET };
  if (path === "/users") return { id: TEST_DEMO_CLERK_ID };
  throw new Error(`Unexpected Clerk POST in test: ${path}`);
});

vi.mock("../lib/clerkAdmin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/clerkAdmin")>();
  return {
    ...actual,
    clerkPost: (path: string, body?: Record<string, unknown>) => clerkPostSpy(path, body),
    clerkUserIdsByEmail: vi.fn(async (_email: string) => [TEST_DEMO_CLERK_ID]),
    clerkUserEmail: vi.fn(async (_id: string) => TEST_DEMO_EMAIL),
  };
});

// ─── App and DB imports (after the mocks are registered) ─────────────────────

import request from "supertest";
import { db, tenantsTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const { default: app } = await import("../app");

const DEMO_SLUG = "demo";

let demoTenantId: string;
/** True when this test file created the demo tenant and must remove it again. */
let createdDemoTenant = false;

beforeAll(async () => {
  const [existing] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, DEMO_SLUG))
    .limit(1);

  if (existing) {
    demoTenantId = existing.id;
    // A suspended demo tenant would make the happy path fail for the wrong
    // reason; the suspension test restores whatever it changes.
    if (existing.isSuspended) {
      await db
        .update(tenantsTable)
        .set({ isSuspended: false })
        .where(eq(tenantsTable.id, demoTenantId));
    }
  } else {
    const [created] = await db
      .insert(tenantsTable)
      .values({ name: "Debe Demo Campaign", slug: DEMO_SLUG, plan: "pro" })
      .returning();
    demoTenantId = created.id;
    createdDemoTenant = true;
  }
});

afterAll(async () => {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, TEST_DEMO_CLERK_ID))
    .limit(1);

  if (user) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, user.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
  if (createdDemoTenant && demoTenantId) {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, demoTenantId));
  }
});

// ─── The grant itself ─────────────────────────────────────────────────────────

describe("GET /api/demo/session", () => {
  it("hands an unauthenticated visitor a ticket into the demo campaign", async () => {
    mockAuth.userId = ""; // no session at all

    const res = await request(app).get("/api/demo/session");

    expect(res.status).toBe(200);
    expect(res.body.ticket).toBe(FAKE_TICKET);
    expect(res.body.tenantSlug).toBe(DEMO_SLUG);
    expect(res.body.expiresInSeconds).toBeGreaterThan(0);
    expect(res.body.expiresInSeconds).toBeLessThanOrEqual(600);
  });

  it("grants membership of the demo campaign only, and pins it as the context", async () => {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, TEST_DEMO_CLERK_ID))
      .limit(1);

    expect(user).toBeTruthy();
    expect(user.isGlobalAdmin).toBe(false);
    expect(user.activeTenantId).toBe(demoTenantId);

    const memberships = await db
      .select({ tenantId: userRolesTable.tenantId })
      .from(userRolesTable)
      .where(eq(userRolesTable.userId, user.id));

    expect(memberships.length).toBe(1);
    expect(memberships[0].tenantId).toBe(demoTenantId);
  });

  it("is idempotent — a second visit does not stack up memberships", async () => {
    mockAuth.userId = "";

    const res = await request(app).get("/api/demo/session");
    expect(res.status).toBe(200);

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, TEST_DEMO_CLERK_ID))
      .limit(1);

    const memberships = await db
      .select({ id: userRolesTable.id })
      .from(userRolesTable)
      .where(eq(userRolesTable.userId, user.id));

    expect(memberships.length).toBe(1);
  });
});

// ─── What the ticket cannot do ────────────────────────────────────────────────

describe("the demo session is read-only", () => {
  it("rejects a write to the demo campaign with 403", async () => {
    mockAuth.userId = TEST_DEMO_CLERK_ID;

    // The id does not need to exist: read-only enforcement runs on the way in,
    // before the route handler ever looks anything up.
    const res = await request(app)
      .post("/api/volunteers/00000000-0000-0000-0000-000000000000/suspend")
      .send({ reason: "demo write attempt" });

    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/read-only demo/i);
  });

  it("still allows reads inside the demo campaign", async () => {
    mockAuth.userId = TEST_DEMO_CLERK_ID;

    const res = await request(app).get("/api/volunteers");
    expect(res.status).toBe(200);
  });
});

// ─── Refusing loudly ──────────────────────────────────────────────────────────

describe("GET /api/demo/session refuses rather than degrading", () => {
  it("returns 503 when the demo campaign is suspended", async () => {
    mockAuth.userId = "";
    await db
      .update(tenantsTable)
      .set({ isSuspended: true })
      .where(eq(tenantsTable.id, demoTenantId));

    try {
      const res = await request(app).get("/api/demo/session");
      expect(res.status).toBe(503);
      expect(res.body.ticket).toBeUndefined();
    } finally {
      await db
        .update(tenantsTable)
        .set({ isSuspended: false })
        .where(eq(tenantsTable.id, demoTenantId));
    }
  });

  it("returns 503 rather than handing out a platform administrator", async () => {
    mockAuth.userId = "";
    await db
      .update(usersTable)
      .set({ isGlobalAdmin: true })
      .where(eq(usersTable.clerkId, TEST_DEMO_CLERK_ID));

    try {
      const res = await request(app).get("/api/demo/session");
      expect(res.status).toBe(503);
      expect(res.body.ticket).toBeUndefined();
    } finally {
      await db
        .update(usersTable)
        .set({ isGlobalAdmin: false })
        .where(eq(usersTable.clerkId, TEST_DEMO_CLERK_ID));
    }
  });

  it("never mints a ticket for a tenant other than the demo campaign", async () => {
    // Whatever else happened above, the only sign-in token ever requested is
    // for the demo account.
    const tokenCalls = clerkPostSpy.mock.calls.filter(([path]) => path === "/sign_in_tokens");
    expect(tokenCalls.length).toBeGreaterThan(0);
    for (const [, body] of tokenCalls) {
      expect((body as any).user_id).toBe(TEST_DEMO_CLERK_ID);
    }

    const roleRows = await db
      .select({ name: rolesTable.name })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
      .innerJoin(usersTable, eq(usersTable.id, userRolesTable.userId))
      .where(
        and(
          eq(usersTable.clerkId, TEST_DEMO_CLERK_ID),
          eq(userRolesTable.tenantId, demoTenantId),
        ),
      );

    expect(roleRows.length).toBe(1);
  });
});
