/**
 * Smoke test: hero copy branding round-trip.
 *
 * Verifies that saving heroSubtagline (and the other hero copy fields) via
 * PATCH /api/config/branding actually persists to the database and is
 * returned by the next GET /api/config/branding call.
 *
 * Two key scenarios:
 *  1. Saving a non-empty heroSubtagline → GET returns the saved value.
 *  2. Saving an empty string → API normalises it to null (GET returns null),
 *     which signals TenantHome to show the static default instead of an
 *     empty paragraph.
 *
 * Strategy:
 *  - Real database (dev DB) so the full upsert + select path is exercised.
 *  - Clerk auth and RBAC mocked to behave as a campaign-exec-director.
 *  - resolveTenant relies on the user's activeTenantId, switched per request
 *    by updating usersTable directly (matching how the switcher endpoint works).
 *  - DNS / TLS are not involved here, so no extra mocks are needed.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec vitest run tests/hero-copy-branding.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// ─── Mutable auth — mutated between tests ─────────────────────────────────────
const mockAuth = { userId: "user_hero_copy_test" };

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

// ─── App and DB imports (after all mocks are registered) ─────────────────────
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  brandingTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let tenantId: string;
let testUserId: string;

const ts = Date.now();
const TENANT_SLUG = `hero-copy-${ts}`;

beforeAll(async () => {
  // Create an isolated test tenant
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Hero Copy Test Campaign", slug: TENANT_SLUG })
    .returning();
  tenantId = tenant.id;

  // Upsert the test user
  const [user] = await db
    .insert(usersTable)
    .values({
      clerkId: mockAuth.userId,
      email: "hero_copy_test@smoke.test",
      fullName: "Hero Copy Tester",
      status: "active",
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { email: "hero_copy_test@smoke.test" },
    })
    .returning();
  testUserId = user.id;

  // Point the user's active tenant at our fixture tenant
  await db
    .update(usersTable)
    .set({ activeTenantId: tenantId })
    .where(eq(usersTable.id, testUserId));

  // Grant campaign-exec-director so requireRoles passes for PATCH /api/config/branding
  const [execRole] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "campaign-exec-director"))
    .limit(1);

  if (execRole) {
    await db
      .insert(userRolesTable)
      .values({ userId: testUserId, roleId: execRole.id, tenantId })
      .onConflictDoNothing();
  } else {
    // If the named role doesn't exist yet, fall back to super-admin
    const [superAdmin] = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.slug, "super-admin"))
      .limit(1);
    if (superAdmin) {
      await db
        .insert(userRolesTable)
        .values({ userId: testUserId, roleId: superAdmin.id, tenantId })
        .onConflictDoNothing();
    }
  }
});

afterAll(async () => {
  if (testUserId) {
    await db
      .update(usersTable)
      .set({ activeTenantId: null })
      .where(eq(usersTable.id, testUserId));
    await db
      .delete(userRolesTable)
      .where(eq(userRolesTable.userId, testUserId));
  }
  // Deleting the tenant cascades to branding rows
  if (tenantId) {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** PATCH /api/config/branding with the given body; returns the response. */
async function patchBranding(body: Record<string, unknown>) {
  return request(app)
    .patch("/api/config/branding")
    .set("Content-Type", "application/json")
    .send(body);
}

/** GET /api/config/branding resolved for our test tenant. */
async function getBranding() {
  // Authenticated GET — resolveTenantMixed uses the caller's activeTenantId
  return request(app)
    .get("/api/config/branding")
    .set("Content-Type", "application/json");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("hero copy — PATCH /api/config/branding → GET /api/config/branding", () => {

  it("saving a non-empty heroSubtagline persists and is returned on the next GET", async () => {
    const customSubtagline = "Empowering every Kenyan — one vote at a time.";

    // ── Admin saves new hero copy ─────────────────────────────────────────────
    const patchRes = await patchBranding({
      campaignName:    "Hero Test Campaign",
      candidateName:   "Test Candidate",
      heroSubtagline:  customSubtagline,
      primaryCtaLabel: "Read our Plan",
      primaryCtaUrl:   "/plan",
      secondaryCtaLabel: "Volunteer",
      secondaryCtaUrl:   "/volunteer",
    });
    expect(patchRes.status).toBe(200);
    // The PATCH response should echo the saved value
    expect(patchRes.body.heroSubtagline).toBe(customSubtagline);
    expect(patchRes.body.primaryCtaLabel).toBe("Read our Plan");

    // ── Public homepage fetches branding and gets the new copy ────────────────
    const getRes = await getBranding();
    expect(getRes.status).toBe(200);
    expect(getRes.body.heroSubtagline).toBe(customSubtagline);
    expect(getRes.body.primaryCtaLabel).toBe("Read our Plan");
    expect(getRes.body.primaryCtaUrl).toBe("/plan");
    expect(getRes.body.secondaryCtaLabel).toBe("Volunteer");
    expect(getRes.body.secondaryCtaUrl).toBe("/volunteer");
  });

  it("saving an empty heroSubtagline normalises to null so TenantHome shows the built-in default", async () => {
    // First, set a known value so this test isn't relying on an empty DB
    await patchBranding({ heroSubtagline: "Some previous tagline" });

    // ── Admin clears the field (leaves it blank) ──────────────────────────────
    const patchRes = await patchBranding({ heroSubtagline: "" });
    expect(patchRes.status).toBe(200);
    // The API must normalise "" → null; an empty string would cause TenantHome
    // to render an empty <p> because `"" || default` is short-circuit true for "".
    expect(patchRes.body.heroSubtagline).toBeNull();

    // ── GET confirms null is stored, not an empty string ─────────────────────
    const getRes = await getBranding();
    expect(getRes.status).toBe(200);
    expect(getRes.body.heroSubtagline).toBeNull();
    // TenantHome renders: branding.heroSubtagline || "Get informed, get involved…"
    // When null, the fallback text is used — no empty paragraph is rendered.
    // We assert the API side of this contract; TenantHome rendering is covered
    // separately in the ushindi-2027 test suite.
  });

  it("saving a null heroSubtagline also normalises to null", async () => {
    const patchRes = await patchBranding({ heroSubtagline: null });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.heroSubtagline).toBeNull();

    const getRes = await getBranding();
    expect(getRes.status).toBe(200);
    expect(getRes.body.heroSubtagline).toBeNull();
  });

  it("omitting heroSubtagline from the PATCH body does not overwrite an existing value", async () => {
    // Set a known value first
    const knownValue = "Persistent sub-tagline value.";
    await patchBranding({ heroSubtagline: knownValue });

    // Now send a PATCH that doesn't include heroSubtagline at all
    const patchRes = await patchBranding({ campaignName: "Updated Name Only" });
    expect(patchRes.status).toBe(200);

    // The field should be untouched in the DB
    const getRes = await getBranding();
    expect(getRes.status).toBe(200);
    expect(getRes.body.heroSubtagline).toBe(knownValue);
    expect(getRes.body.campaignName).toBe("Updated Name Only");
  });
});
