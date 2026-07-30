/**
 * Org-switch tenant isolation test.
 *
 * Simulates the mobile agent app's org-switch flow:
 *   1. User activates org A → JWT carries orgId = A
 *   2. User switches to org B → JWT carries orgId = B
 *   3. User switches back to org A → JWT carries orgId = A
 *
 * Each JWT change must cause the API to resolve a different tenant.
 * No data from a previous org should bleed through.
 *
 * Uses the GET /api/config/branding endpoint because:
 *  - It resolves the tenant from JWT.orgId via resolveTenantMixed → resolveTenant
 *  - It requires no specific role — any authenticated session can read branding
 *  - It returns clearly tenant-scoped data (candidateName, etc.)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/org-switch-tenant-isolation.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mutable auth state — point at the desired org per test ──────────────────
const mockAuth = {
  userId: "user_test_orgswitch",
  orgId: null as string | null,
};

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
import { tenantsTable, brandingTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let orgAId: string;
let orgBId: string;
let tenantAId: string;
let tenantBId: string;
let brandingAId: string;
let brandingBId: string;

const CANDIDATE_A = "Alice Kamau For Org A";
const CANDIDATE_B = "Bob Otieno For Org B";

beforeAll(async () => {
  const ts = Date.now();
  orgAId = `org_switch_A_${ts}`;
  orgBId = `org_switch_B_${ts}`;

  const [tA] = await db
    .insert(tenantsTable)
    .values({
      clerkOrgId: orgAId,
      name: "OrgSwitch Tenant A",
      slug: `orgswitch-a-${ts}`,
      plan: "free",
    })
    .returning();
  tenantAId = tA.id;

  const [tB] = await db
    .insert(tenantsTable)
    .values({
      clerkOrgId: orgBId,
      name: "OrgSwitch Tenant B",
      slug: `orgswitch-b-${ts}`,
      plan: "free",
    })
    .returning();
  tenantBId = tB.id;

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
});

afterAll(async () => {
  mockAuth.orgId = null;
  if (brandingAId) await db.delete(brandingTable).where(eq(brandingTable.id, brandingAId));
  if (brandingBId) await db.delete(brandingTable).where(eq(brandingTable.id, brandingBId));
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function activateOrg(orgId: string) {
  mockAuth.orgId = orgId;
}
function clearOrg() {
  mockAuth.orgId = null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Org-switch → tenant resolution uses JWT orgId, not cached state", () => {
  it("JWT with orgId=A resolves tenant A's branding", async () => {
    activateOrg(orgAId);
    const res = await request(app).get("/api/config/branding");
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(true);
    expect(res.body.candidateName).toBe(CANDIDATE_A);
  });

  it("Switching JWT to orgId=B resolves tenant B's branding, not A's", async () => {
    activateOrg(orgBId);
    const res = await request(app).get("/api/config/branding");
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(true);
    expect(res.body.candidateName).toBe(CANDIDATE_B);
    // Explicitly assert A's data is not present
    expect(res.body.candidateName).not.toBe(CANDIDATE_A);
  });

  it("Switching JWT back to orgId=A resolves tenant A again — no bleed from B", async () => {
    activateOrg(orgAId);
    const res = await request(app).get("/api/config/branding");
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(true);
    expect(res.body.candidateName).toBe(CANDIDATE_A);
    expect(res.body.candidateName).not.toBe(CANDIDATE_B);
  });

  it("Alternating A → B → A multiple times never returns the wrong tenant's data", async () => {
    const sequence = [orgAId, orgBId, orgAId, orgBId, orgAId];
    const expected = [CANDIDATE_A, CANDIDATE_B, CANDIDATE_A, CANDIDATE_B, CANDIDATE_A];

    for (let i = 0; i < sequence.length; i++) {
      activateOrg(sequence[i]);
      const res = await request(app).get("/api/config/branding");
      expect(res.status).toBe(200);
      expect(res.body.candidateName).toBe(expected[i]);
    }
  });

  it("JWT with no orgId returns 403 — no fallback to a previous org", async () => {
    clearOrg();
    const res = await request(app).get("/api/config/branding");
    // resolveTenant returns 403 when orgId is missing from JWT (no active org)
    expect(res.status).toBe(403);
  });

  it("JWT with an unregistered orgId returns 403 — unknown org never falls through", async () => {
    activateOrg("org_not_in_db_9999");
    const res = await request(app).get("/api/config/branding");
    expect(res.status).toBe(403);
  });
});
