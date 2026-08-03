/**
 * Custom domain uniqueness tests.
 *
 * Verifies that two campaigns cannot claim the same custom domain concurrently.
 * The DB unique constraint on tenantsTable.customDomain is the source of truth;
 * the API surface (PATCH /api/config/domain) exposes this as HTTP 409.
 *
 * Strategy:
 *  - Real DB (dev database) — the unique constraint is on the actual schema,
 *    not a mock. This confirms the constraint exists AND the error code is wired
 *    to the correct HTTP status.
 *  - DNS resolution is mocked so tests don't need real CNAME records.
 *  - TLS provisioning is mocked as a no-op.
 *  - Clerk auth is mocked to return controllable userId + orgId.
 *  - The test user is granted super-admin (which bypasses requireRoles checks).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/custom-domain-uniqueness.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// ─── Mutable auth — set per test ──────────────────────────────────────────────
const mockAuth = { userId: "user_test_domain", orgId: null as string | null };

// ─── Mutable DNS result — default to verified (resolveCname returns PORTAL_DOMAIN) ─
let _dnsResult: string[] = ["ushindi.app"];

// ─── Mock Clerk BEFORE any app import ────────────────────────────────────────
vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(
      () => (_req: any, _res: any, next: any) => next(),
    ),
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

// ─── Mock DNS so CNAME verification doesn't need real records ────────────────
// The factory must use a stable reference; we control the result via _dnsResult.
vi.mock("dns", () => ({
  promises: {
    resolveCname: vi.fn(async (_hostname: string) => _dnsResult),
  },
}));

// ─── Mock TLS provisioning (fire-and-forget in the route handler) ─────────────
vi.mock("../src/lib/tlsCert", () => ({
  triggerTlsProvisioning: vi.fn(() => Promise.resolve()),
}));

// ─── App and DB imports (after all mocks are registered) ─────────────────────
import request from "supertest";
import { db } from "@workspace/db";
import { tenantsTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let orgAId: string;
let orgBId: string;
let tenantAId: string;
let tenantBId: string;
let testUserId: string;

// Unique domain per test run so parallel CI runs don't collide
const ts = Date.now();
const SHARED_DOMAIN = `vote-test-${ts}.example.ke`;
const ALT_DOMAIN_A  = `results-a-${ts}.example.ke`;
const ALT_DOMAIN_B  = `results-b-${ts}.example.ke`;

beforeAll(async () => {
  process.env.PORTAL_DOMAIN = "ushindi.app";

  orgAId = `org_domain_A_${ts}`;
  orgBId = `org_domain_B_${ts}`;

  // Custom domains are a paid feature, and a stored plan alone does not grant
  // entitlement — the effective plan needs an active subscription or an
  // unexpired override. Give both fixtures a manual grant so these tests
  // exercise domain uniqueness rather than billing.
  const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [tA] = await db
    .insert(tenantsTable)
    .values({ clerkOrgId: orgAId, name: "Domain Test Tenant A", slug: `domain-a-${ts}`, plan: "pro", planOverrideUntil: paidUntil })
    .returning();
  tenantAId = tA.id;

  const [tB] = await db
    .insert(tenantsTable)
    .values({ clerkOrgId: orgBId, name: "Domain Test Tenant B", slug: `domain-b-${ts}`, plan: "pro", planOverrideUntil: paidUntil })
    .returning();
  tenantBId = tB.id;

  // Upsert the test user so the RBAC middleware can find them
  const [testUser] = await db
    .insert(usersTable)
    .values({
      clerkId:  "user_test_domain",
      email:    "domain_test@uniqueness.test",
      fullName: "Domain Test User",
      status:   "active",
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { email: "domain_test@uniqueness.test" },
    })
    .returning();
  testUserId = testUser.id;

  // Grant super-admin in both tenants — super-admin bypasses all requireRoles checks
  const [superAdmin] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "super-admin"))
    .limit(1);

  if (superAdmin) {
    await db
      .insert(userRolesTable)
      .values({ userId: testUserId, roleId: superAdmin.id, tenantId: tenantAId })
      .onConflictDoNothing();
    await db
      .insert(userRolesTable)
      .values({ userId: testUserId, roleId: superAdmin.id, tenantId: tenantBId })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  mockAuth.orgId = null;
  if (testUserId) await db.delete(userRolesTable).where(eq(userRolesTable.userId, testUserId));
  if (tenantAId)  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId)  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  // Leave the test user row (reused via onConflictDoUpdate in future runs)
});

beforeEach(() => {
  // Default: DNS is verified
  _dnsResult = ["ushindi.app"];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asOrgA() { mockAuth.orgId = orgAId; }
function asOrgB() { mockAuth.orgId = orgBId; }

async function patchDomain(domain: string | null) {
  return request(app)
    .patch("/api/config/domain")
    .set("Content-Type", "application/json")
    .send({ customDomain: domain });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Custom domain uniqueness — PATCH /api/config/domain", () => {
  it("Campaign A can register a custom domain that is not yet taken", async () => {
    asOrgA();
    const res = await patchDomain(ALT_DOMAIN_A);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBe(ALT_DOMAIN_A);
  });

  it("Campaign B can register a different custom domain simultaneously", async () => {
    asOrgB();
    const res = await patchDomain(ALT_DOMAIN_B);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBe(ALT_DOMAIN_B);
  });

  it("Campaign A can clear its own domain without error", async () => {
    asOrgA();
    const res = await patchDomain(null);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBeNull();
  });

  it("Campaign A registers the shared domain after clearing", async () => {
    asOrgA();
    const res = await patchDomain(SHARED_DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBe(SHARED_DOMAIN);
  });

  it("Campaign B gets 409 when attempting to claim a domain already owned by Campaign A", async () => {
    // Campaign A already holds SHARED_DOMAIN from the previous test.
    // The DB unique constraint on tenantsTable.customDomain must block this.
    asOrgB();
    const res = await patchDomain(SHARED_DOMAIN);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered to another campaign/i);
  });

  it("Campaign A can re-register its own domain (idempotent update — no conflict)", async () => {
    // Updating a row to its current value must not trigger a unique-constraint error.
    asOrgA();
    const res = await patchDomain(SHARED_DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBe(SHARED_DOMAIN);
  });

  it("Campaign A releases the shared domain, then Campaign B can claim it", async () => {
    asOrgA();
    const clear = await patchDomain(null);
    expect(clear.status).toBe(200);

    asOrgB();
    const claim = await patchDomain(SHARED_DOMAIN);
    expect(claim.status).toBe(200);
    expect(claim.body.customDomain).toBe(SHARED_DOMAIN);
  });

  it("Returns 422 when the CNAME record is not yet pointing at the platform", async () => {
    // Simulate DNS not yet configured: resolveCname returns a different target
    _dnsResult = ["some-other-host.example.com"];
    asOrgA();
    const res = await patchDomain(`unverified-${ts}.example.ke`);
    expect(res.status).toBe(422);
    expect(res.body.dnsVerified).toBe(false);
  });

  it("Returns 400 for a malformed domain string", async () => {
    asOrgA();
    const res = await patchDomain("not a domain!");
    expect(res.status).toBe(400);
  });

  it("Returns 403 when the JWT carries no orgId (resolveTenant blocks access)", async () => {
    mockAuth.orgId = null;
    const res = await patchDomain(SHARED_DOMAIN);
    expect(res.status).toBe(403);
  });
});
