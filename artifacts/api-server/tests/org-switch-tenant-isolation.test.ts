/**
 * Campaign-switch tenant isolation test.
 *
 * Simulates a user who belongs to TWO campaigns switching between them:
 *   1. Enter campaign A → API resolves tenant A
 *   2. Switch to campaign B → API resolves tenant B
 *   3. Switch back to A → API resolves tenant A again
 *   4. Exit entirely → neutral response, no fallback to a previous campaign
 *
 * Switching is done through PUT /api/users/me/active-campaign, which persists
 * the choice on the user row. No data from a previous campaign may bleed
 * through, and entering a campaign you do NOT belong to must be refused.
 *
 * Uses the GET /api/config/branding endpoint because:
 *  - It resolves the tenant via resolveTenantMixed → resolveTenant (membership)
 *  - It requires no specific role — any authenticated session can read branding
 *  - It returns clearly tenant-scoped data (candidateName, etc.)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/org-switch-tenant-isolation.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mutable auth state ────────────────────────────────────────────────────────
const mockAuth = { userId: "user_test_orgswitch" };

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

// ─── App and DB imports (after mocks are registered) ─────────────────────────
import request from "supertest";
import { db } from "@workspace/db";
import { tenantsTable, brandingTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let tenantAId: string;
let tenantBId: string;
let tenantCId: string; // a campaign the test user does NOT belong to
let brandingAId: string;
let brandingBId: string;
let testUserId: string;

const CANDIDATE_A = "Alice Kamau For Campaign A";
const CANDIDATE_B = "Bob Otieno For Campaign B";

beforeAll(async () => {
  const ts = Date.now();

  const [tA] = await db
    .insert(tenantsTable)
    .values({ name: "Switch Tenant A", slug: `switch-a-${ts}`, plan: "free" })
    .returning();
  tenantAId = tA.id;

  const [tB] = await db
    .insert(tenantsTable)
    .values({ name: "Switch Tenant B", slug: `switch-b-${ts}`, plan: "free" })
    .returning();
  tenantBId = tB.id;

  const [tC] = await db
    .insert(tenantsTable)
    .values({ name: "Switch Tenant C", slug: `switch-c-${ts}`, plan: "free" })
    .returning();
  tenantCId = tC.id;

  // Seed branding rows with distinct candidate names so assertions are unambiguous
  const [bA] = await db
    .insert(brandingTable)
    .values({ tenantId: tenantAId, candidateName: CANDIDATE_A })
    .returning();
  brandingAId = bA.id;

  const [bB] = await db
    .insert(brandingTable)
    .values({ tenantId: tenantBId, candidateName: CANDIDATE_B })
    .returning();
  brandingBId = bB.id;

  // The test user belongs to campaigns A and B — never C.
  const [user] = await db
    .insert(usersTable)
    .values({
      clerkId: mockAuth.userId,
      email: `orgswitch-${ts}@test.invalid`,
      fullName: "Campaign Switch Test User",
      status: "active",
      activeTenantId: null,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { activeTenantId: null },
    })
    .returning();
  testUserId = user.id;

  const [superAdmin] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "super-admin"))
    .limit(1);

  if (superAdmin) {
    await db.insert(userRolesTable)
      .values({ userId: testUserId, roleId: superAdmin.id, tenantId: tenantAId })
      .onConflictDoNothing();
    await db.insert(userRolesTable)
      .values({ userId: testUserId, roleId: superAdmin.id, tenantId: tenantBId })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  if (testUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, testUserId));
    await db.delete(usersTable).where(eq(usersTable.id, testUserId));
  }
  if (brandingAId) await db.delete(brandingTable).where(eq(brandingTable.id, brandingAId));
  if (brandingBId) await db.delete(brandingTable).where(eq(brandingTable.id, brandingBId));
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  if (tenantCId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantCId));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function enterCampaign(tenantId: string | null) {
  return request(app)
    .put("/api/users/me/active-campaign")
    .set("Content-Type", "application/json")
    .send({ tenantId });
}

async function branding() {
  return request(app).get("/api/config/branding");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Campaign switch → tenant resolution follows the entered campaign", () => {
  it("Entering campaign A resolves tenant A's branding", async () => {
    const enter = await enterCampaign(tenantAId);
    expect(enter.status).toBe(200);
    expect(enter.body.activeTenant?.id).toBe(tenantAId);

    const res = await branding();
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(true);
    expect(res.body.candidateName).toBe(CANDIDATE_A);
  });

  it("Switching to campaign B resolves tenant B's branding, not A's", async () => {
    const enter = await enterCampaign(tenantBId);
    expect(enter.status).toBe(200);

    const res = await branding();
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe(CANDIDATE_B);
    expect(res.body.candidateName).not.toBe(CANDIDATE_A);
  });

  it("Switching back to A resolves tenant A again — no bleed from B", async () => {
    const enter = await enterCampaign(tenantAId);
    expect(enter.status).toBe(200);

    const res = await branding();
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe(CANDIDATE_A);
    expect(res.body.candidateName).not.toBe(CANDIDATE_B);
  });

  it("Alternating A → B → A multiple times never returns the wrong tenant's data", async () => {
    const sequence = [tenantAId, tenantBId, tenantAId, tenantBId, tenantAId];
    const expected = [CANDIDATE_A, CANDIDATE_B, CANDIDATE_A, CANDIDATE_B, CANDIDATE_A];

    for (let i = 0; i < sequence.length; i++) {
      await enterCampaign(sequence[i]);
      const res = await branding();
      expect(res.status).toBe(200);
      expect(res.body.candidateName).toBe(expected[i]);
    }
  });

  it("Entering a campaign the user does NOT belong to is refused with 403", async () => {
    const enter = await enterCampaign(tenantCId);
    expect(enter.status).toBe(403);
    expect(enter.body.error).toMatch(/not a member/i);

    // Context must be unchanged — still whichever campaign was entered before.
    const res = await branding();
    expect(res.status).toBe(200);
  });

  it("Exiting entirely returns neutral branding — no fallback to a previous campaign", async () => {
    await enterCampaign(tenantAId);
    const exit = await enterCampaign(null);
    expect(exit.status).toBe(200);
    expect(exit.body.activeTenant).toBeNull();

    const res = await branding();
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(false);
    expect(res.body.candidateName).not.toBe(CANDIDATE_A);
    expect(res.body.candidateName).not.toBe(CANDIDATE_B);
  });
});
