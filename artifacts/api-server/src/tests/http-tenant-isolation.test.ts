/**
 * HTTP-layer tenant isolation integration tests.
 *
 * Uses supertest against the real Express app. Clerk auth is mocked via
 * vi.mock() (hoisted) so no real tokens are needed. Two campaigns are created,
 * each with its OWN member user — campaign context comes from app-owned
 * membership (user_roles), never from anything the request carries. We verify
 * cross-tenant access is blocked at the HTTP layer.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mock Clerk BEFORE any app import ────────────────────────────────────────
// vi.mock is hoisted to the top of the compiled output, so this runs before
// any module that imports @clerk/express.

// We expose a mutable object that individual tests can point at the desired user.
const mockAuth = { userId: "" as string | null };

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    // clerkMiddleware: no-op in tests (we inject auth directly via getAuth)
    clerkMiddleware: vi.fn(
      () => (_req: any, _res: any, next: any) => next(),
    ),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

// ─── App and DB imports (after mock is registered) ───────────────────────────
import request from "supertest";
import { db } from "@workspace/db";
import {
  tenantsTable,
  aspirantsTable,
  contactMessagesTable,
  volunteersTable,
  countiesTable,
  usersTable,
  userRolesTable,
  rolesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// Dynamic import so the app picks up the mocked @clerk/express
const { default: app } = await import("../app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A_CLERK_ID = "user_test_http_a";
const USER_B_CLERK_ID = "user_test_http_b";

let tenantAId: string;
let tenantBId: string;
let tenantASlug: string;
let userAId: string;
let userBId: string;

let aspirantAId: string;
let aspirantBId: string;
let messageAId: string;
let messageBId: string;
let volunteerAId: string;
let volunteerBId: string;

beforeAll(async () => {
  const [county] = await db.select().from(countiesTable).limit(1);
  if (!county) throw new Error("No counties — run seed first");
  const countyId = county.id;

  const ts = Date.now();

  // One member user per campaign — with a single membership each, their
  // campaign context resolves automatically, exactly like a real campaign user.
  const [userA] = await db
    .insert(usersTable)
    .values({ clerkId: USER_A_CLERK_ID, email: `test_http_a_${ts}@isolation.test`, fullName: "HTTP Test User A", status: "active" })
    .onConflictDoUpdate({ target: usersTable.clerkId, set: { activeTenantId: null } })
    .returning();
  userAId = userA.id;

  const [userB] = await db
    .insert(usersTable)
    .values({ clerkId: USER_B_CLERK_ID, email: `test_http_b_${ts}@isolation.test`, fullName: "HTTP Test User B", status: "active" })
    .onConflictDoUpdate({ target: usersTable.clerkId, set: { activeTenantId: null } })
    .returning();
  userBId = userB.id;

  const [tA] = await db
    .insert(tenantsTable)
    .values({ name: "HTTP Tenant A", slug: `http-a-${ts}`, plan: "free" })
    .returning();
  tenantAId = tA.id;
  tenantASlug = tA.slug;

  const [tB] = await db
    .insert(tenantsTable)
    .values({ name: "HTTP Tenant B", slug: `http-b-${ts}`, plan: "free" })
    .returning();
  tenantBId = tB.id;

  // Grant each user super-admin in THEIR campaign only, so RBAC passes and
  // the tenant filter is what we're testing.
  const [superAdminRole] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "super-admin"))
    .limit(1);
  if (superAdminRole) {
    await db.insert(userRolesTable).values({ userId: userAId, roleId: superAdminRole.id, tenantId: tenantAId }).onConflictDoNothing();
    await db.insert(userRolesTable).values({ userId: userBId, roleId: superAdminRole.id, tenantId: tenantBId }).onConflictDoNothing();
  }

  const [aA] = await db
    .insert(aspirantsTable)
    .values({ tenantId: tenantAId, fullName: "HTTP Alice A", nationalId: `HTTP_A_${ts}`, phoneNumber: "+254711100001", position: "member_of_parliament", countyId, status: "pending" })
    .returning();
  aspirantAId = aA.id;

  const [aB] = await db
    .insert(aspirantsTable)
    .values({ tenantId: tenantBId, fullName: "HTTP Bob B", nationalId: `HTTP_B_${ts}`, phoneNumber: "+254711100002", position: "member_of_parliament", countyId, status: "pending" })
    .returning();
  aspirantBId = aB.id;

  const [mA] = await db
    .insert(contactMessagesTable)
    .values({ tenantId: tenantAId, fullName: "Msg A", email: "http_a@test.com", subject: "Sub A", message: "Body A", status: "open" })
    .returning();
  messageAId = mA.id;

  const [mB] = await db
    .insert(contactMessagesTable)
    .values({ tenantId: tenantBId, fullName: "Msg B", email: "http_b@test.com", subject: "Sub B", message: "Body B", status: "open" })
    .returning();
  messageBId = mB.id;

  const [vA] = await db
    .insert(volunteersTable)
    .values({ tenantId: tenantAId, fullName: "Vol HTTP A", phoneNumber: "+254711100003", email: "va_http@test.com", countyId, status: "pending", consentGiven: true })
    .returning();
  volunteerAId = vA.id;

  const [vB] = await db
    .insert(volunteersTable)
    .values({ tenantId: tenantBId, fullName: "Vol HTTP B", phoneNumber: "+254711100004", email: "vb_http@test.com", countyId, status: "pending", consentGiven: true })
    .returning();
  volunteerBId = vB.id;
});

afterAll(async () => {
  if (aspirantAId) await db.delete(aspirantsTable).where(eq(aspirantsTable.id, aspirantAId));
  if (aspirantBId) await db.delete(aspirantsTable).where(eq(aspirantsTable.id, aspirantBId));
  if (messageAId) await db.delete(contactMessagesTable).where(eq(contactMessagesTable.id, messageAId));
  if (messageBId) await db.delete(contactMessagesTable).where(eq(contactMessagesTable.id, messageBId));
  if (volunteerAId) await db.delete(volunteersTable).where(eq(volunteersTable.id, volunteerAId));
  if (volunteerBId) await db.delete(volunteersTable).where(eq(volunteersTable.id, volunteerBId));
  // Delete user_roles before tenants (CASCADE not guaranteed on user_roles.tenantId)
  if (userAId) await db.delete(userRolesTable).where(eq(userRolesTable.userId, userAId));
  if (userBId) await db.delete(userRolesTable).where(eq(userRolesTable.userId, userBId));
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  if (userAId) await db.delete(usersTable).where(eq(usersTable.id, userAId));
  if (userBId) await db.delete(usersTable).where(eq(usersTable.id, userBId));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asMemberA() { mockAuth.userId = USER_A_CLERK_ID; }
function asMemberB() { mockAuth.userId = USER_B_CLERK_ID; }

// ─── Aspirants ────────────────────────────────────────────────────────────────

describe("HTTP /api/aspirants — tenant isolation", () => {
  it("GET / for campaign A does not include campaign B aspirant", async () => {
    asMemberA();
    const res = await request(app).get("/api/aspirants");
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((a: any) => a.id);
    expect(ids).toContain(aspirantAId);
    expect(ids).not.toContain(aspirantBId);
  });

  it("GET /:id for campaign A returns 404 for campaign B aspirant", async () => {
    asMemberA();
    const res = await request(app).get(`/api/aspirants/${aspirantBId}`);
    expect(res.status).toBe(404);
  });

  it("GET / for campaign B does not include campaign A aspirant", async () => {
    asMemberB();
    const res = await request(app).get("/api/aspirants");
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((a: any) => a.id);
    expect(ids).toContain(aspirantBId);
    expect(ids).not.toContain(aspirantAId);
  });

  it("GET /:id for campaign B returns 404 for campaign A aspirant", async () => {
    asMemberB();
    const res = await request(app).get(`/api/aspirants/${aspirantAId}`);
    expect(res.status).toBe(404);
  });
});

// ─── Contact Messages ─────────────────────────────────────────────────────────

describe("HTTP /api/contact-messages — tenant isolation", () => {
  it("GET / for campaign A does not include campaign B message", async () => {
    asMemberA();
    const res = await request(app).get("/api/contact-messages");
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((m: any) => m.id);
    expect(ids).toContain(messageAId);
    expect(ids).not.toContain(messageBId);
  });

  it("GET /:id for campaign A is blocked for campaign B message (403 RBAC or 404 not found)", async () => {
    asMemberA();
    const res = await request(app).get(`/api/contact-messages/${messageBId}`);
    // 403: RBAC fires first; 404: tenant filter fires first.
    // Both are correct — cross-tenant access is denied at the HTTP layer.
    expect([403, 404]).toContain(res.status);
  });

  it("PATCH on campaign B message from campaign A session is blocked (403 or 404)", async () => {
    asMemberA();
    const res = await request(app)
      .patch(`/api/contact-messages/${messageBId}`)
      .send({ status: "read" });
    expect([403, 404]).toContain(res.status);
  });
});

// ─── Volunteers ───────────────────────────────────────────────────────────────

describe("HTTP /api/volunteers — tenant isolation", () => {
  it("GET / for campaign A does not include campaign B volunteer", async () => {
    asMemberA();
    const res = await request(app).get("/api/volunteers");
    expect(res.status).toBe(200);
    const ids = (res.body.data ?? []).map((v: any) => v.id);
    expect(ids).toContain(volunteerAId);
    expect(ids).not.toContain(volunteerBId);
  });

  it("GET /:id for campaign A returns 404 for campaign B volunteer", async () => {
    asMemberA();
    const res = await request(app).get(`/api/volunteers/${volunteerBId}`);
    expect(res.status).toBe(404);
  });

  it("POST /suspend on campaign B volunteer from campaign A session is blocked", async () => {
    asMemberA();
    const res = await request(app)
      .post(`/api/volunteers/${volunteerBId}/suspend`)
      .send({ reason: "cross-tenant test" });
    // 403 (RBAC may trigger first) or 404 (tenant filter)
    expect([403, 404]).toContain(res.status);
  });
});

// ─── Config branding (public) ─────────────────────────────────────────────────

describe("HTTP /api/config/branding — public access", () => {
  it("returns 200 with X-Tenant-Slug header and no auth", async () => {
    // unauthenticated — getAuth returns no userId
    mockAuth.userId = "";

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", tenantASlug);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("campaignName");
  });

  it("returns 200 with default branding when no slug provided", async () => {
    mockAuth.userId = "";

    const res = await request(app).get("/api/config/branding");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("campaignName");
  });
});
