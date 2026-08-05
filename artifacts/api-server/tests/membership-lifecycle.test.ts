/**
 * Membership lifecycle tests — registration, campaign entry, and the
 * tenantless platform-operator invariant.
 *
 * What this covers (real DB, mocked Clerk session):
 *   A. Self-serve registration works end to end WITHOUT any Clerk
 *      organisation: the campaign, the founder's membership and their
 *      campaign super-admin role are created in one go, the founder's very
 *      next request lands inside the campaign, and a second registration is
 *      refused.
 *   B. A platform super admin with ZERO memberships can reach platform
 *      functions, enter an arbitrary campaign, act in it, and leave — and no
 *      membership record exists for them before, during, or after. This is
 *      the regression guard that stops platform authority from ever depending
 *      on belonging somewhere.
 *   C. A member cannot enter a campaign they do not belong to.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/membership-lifecycle.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mutable auth state — point at the desired user per test ─────────────────
const mockAuth = { userId: "user_test_founder" };

const ts = Date.now();
const FOUNDER_CLERK_ID = "user_test_founder";
const OPERATOR_CLERK_ID = "user_test_operator";
const INVITEE_CLERK_ID = "user_test_invitee";
const FOUNDER_EMAIL = `founder-${ts}@lifecycle.test`;
const OPERATOR_EMAIL = `operator-${ts}@lifecycle.test`;
const INVITEE_EMAIL = `invitee-${ts}@lifecycle.test`;

// Mutable Clerk directory — tests add entries to simulate accounts existing.
const EMAILS: Record<string, string> = { [FOUNDER_CLERK_ID]: FOUNDER_EMAIL };
const NAMES: Record<string, string> = { [FOUNDER_CLERK_ID]: "Lifecycle Founder" };
const IDS_BY_EMAIL: Record<string, string[]> = {};
const CAMPAIGN_SLUG = `lifecycle-${ts}`;
const CANDIDATE_NAME = "Lifecycle Test Candidate";

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

// ─── Mock the Clerk admin plane ───────────────────────────────────────────────
// Registration reads the caller's email/name from Clerk; privilege bootstrap
// re-verifies addresses. None of this may touch the network in tests, and none
// of it may involve Clerk Organisations — membership is app-owned now.
vi.mock("../src/lib/clerkAdmin", () => ({
  clerkUserEmail: vi.fn(async (id: string) => EMAILS[id] ?? null),
  clerkUserName: vi.fn(async (id: string) => NAMES[id] ?? null),
  clerkUserIdsByEmail: vi.fn(async (email: string) => IDS_BY_EMAIL[email] ?? []),
  clerkVerifiedPrimaryEmail: vi.fn(async () => null),
}));

// ─── Mock email sending (fire-and-forget in the handler) ─────────────────────
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
} from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let registeredTenantId: string;
let otherTenantId: string;
let founderUserId: string;
let operatorUserId: string;
let inviteeUserId: string;

function asFounder() { mockAuth.userId = FOUNDER_CLERK_ID; }
function asOperator() { mockAuth.userId = OPERATOR_CLERK_ID; }

async function membershipCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), isNotNull(userRolesTable.tenantId)));
  return rows.length;
}

beforeAll(async () => {
  // A campaign the founder does NOT belong to (for the refusal test).
  const [other] = await db
    .insert(tenantsTable)
    .values({ name: "Other Lifecycle Tenant", slug: `lifecycle-other-${ts}`, plan: "free" })
    .returning();
  otherTenantId = other.id;

  // The platform operator: global admin, no memberships anywhere, ever.
  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: OPERATOR_CLERK_ID,
      email: OPERATOR_EMAIL,
      fullName: "Lifecycle Operator",
      status: "active",
      isGlobalAdmin: true,
      activeTenantId: null,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { isGlobalAdmin: true, activeTenantId: null },
    })
    .returning();
  operatorUserId = operator.id;
});

afterAll(async () => {
  if (founderUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, founderUserId));
    await db.delete(usersTable).where(eq(usersTable.id, founderUserId));
  }
  if (operatorUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, operatorUserId));
    await db.delete(usersTable).where(eq(usersTable.id, operatorUserId));
  }
  if (inviteeUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, inviteeUserId));
    await db.delete(usersTable).where(eq(usersTable.id, inviteeUserId));
  }
  // Tenants cascade branding / onboarding / user_roles.
  if (registeredTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, registeredTenantId));
  if (otherTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. Self-serve registration — no Clerk organisation involved
// ═══════════════════════════════════════════════════════════════════════════════

describe("Self-serve registration owns membership in the app", () => {
  it("registers a campaign end to end and lands the founder inside it", async () => {
    asFounder();

    const res = await request(app)
      .post("/api/register")
      .set("Content-Type", "application/json")
      .send({
        campaignName: "Lifecycle Test Campaign",
        slug: CAMPAIGN_SLUG,
        candidateName: CANDIDATE_NAME,
        electionYear: 2027,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant.slug).toBe(CAMPAIGN_SLUG);
    registeredTenantId = res.body.tenant.id;

    // The tenant must not depend on any identity-provider workspace.
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, registeredTenantId))
      .limit(1);
    expect(tenant.clerkOrgId).toBeNull();

    // The founder's very next request resolves the campaign via membership.
    const me = await request(app).get("/api/users/me");
    expect(me.status).toBe(200);
    expect(me.body.activeTenant?.id).toBe(registeredTenantId);
    expect(me.body.isPlatformOperator).toBe(false);
    expect(me.body.campaigns).toHaveLength(1);
    expect(me.body.campaigns[0].id).toBe(registeredTenantId);
    expect(me.body.roles.map((r: any) => r.roleSlug)).toContain("super-admin");
    founderUserId = me.body.id;

    // Campaign-scoped data resolves too — stable privileges, no 403.
    const branding = await request(app).get("/api/config/branding");
    expect(branding.status).toBe(200);
    expect(branding.body.isTenant).toBe(true);
    expect(branding.body.candidateName).toBe(CANDIDATE_NAME);
  });

  it("refuses a second self-serve registration for the same founder", async () => {
    asFounder();

    const res = await request(app)
      .post("/api/register")
      .set("Content-Type", "application/json")
      .send({ campaignName: "Second Campaign", slug: `lifecycle-second-${ts}` });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already belong to a campaign/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. The tenantless platform-operator invariant
// ═══════════════════════════════════════════════════════════════════════════════

describe("Platform operator works with zero memberships, before/during/after entry", () => {
  it("reaches platform functions and holds no membership anywhere", async () => {
    asOperator();

    const tenants = await request(app).get("/api/platform/tenants");
    expect(tenants.status).toBe(200);
    expect(Array.isArray(tenants.body)).toBe(true);

    const me = await request(app).get("/api/users/me");
    expect(me.status).toBe(200);
    expect(me.body.isPlatformOperator).toBe(true);
    expect(me.body.activeTenant).toBeNull();
    expect(me.body.campaigns).toEqual([]);

    expect(await membershipCount(operatorUserId)).toBe(0);
  });

  it("enters an arbitrary campaign, acts in it, and is never enrolled", async () => {
    asOperator();

    const enter = await request(app)
      .put("/api/users/me/active-campaign")
      .set("Content-Type", "application/json")
      .send({ tenantId: registeredTenantId });
    expect(enter.status).toBe(200);
    expect(enter.body.activeTenant?.id).toBe(registeredTenantId);

    // Inside the campaign: operator-level access to campaign data.
    const branding = await request(app).get("/api/config/branding");
    expect(branding.status).toBe(200);
    expect(branding.body.candidateName).toBe(CANDIDATE_NAME);

    const me = await request(app).get("/api/users/me");
    expect(me.body.activeTenant?.id).toBe(registeredTenantId);
    // The campaigns list stays empty — entry is not membership.
    expect(me.body.campaigns).toEqual([]);

    // No membership record exists while inside the campaign.
    expect(await membershipCount(operatorUserId)).toBe(0);
  });

  it("leaves the campaign and still holds no membership", async () => {
    asOperator();

    const exit = await request(app)
      .put("/api/users/me/active-campaign")
      .set("Content-Type", "application/json")
      .send({ tenantId: null });
    expect(exit.status).toBe(200);
    expect(exit.body.activeTenant).toBeNull();

    const me = await request(app).get("/api/users/me");
    expect(me.body.activeTenant).toBeNull();

    // Campaign-scoped routes go back to the explicit "pick a campaign" state.
    const users = await request(app).get("/api/users");
    expect(users.status).toBe(409);
    expect(users.body.code).toBe("NO_CAMPAIGN_SELECTED");

    expect(await membershipCount(operatorUserId)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Platform invite — grants membership only to existing accounts
// ═══════════════════════════════════════════════════════════════════════════════

describe("Platform invite grants membership only to existing accounts", () => {
  it("returns 404 with a sign-up-first message when the email has no account", async () => {
    asOperator();

    const res = await request(app)
      .post(`/api/platform/tenants/${registeredTenantId}/invite`)
      .set("Content-Type", "application/json")
      .send({ adminEmail: `ghost-${ts}@lifecycle.test` });

    // No silent pending grant — the admin is told to get them signed up first.
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no account exists/i);
  });

  it("grants campaign super-admin membership when the invitee has an account", async () => {
    EMAILS[INVITEE_CLERK_ID] = INVITEE_EMAIL;
    NAMES[INVITEE_CLERK_ID] = "Lifecycle Invitee";
    IDS_BY_EMAIL[INVITEE_EMAIL] = [INVITEE_CLERK_ID];

    asOperator();

    const res = await request(app)
      .post(`/api/platform/tenants/${registeredTenantId}/invite`)
      .set("Content-Type", "application/json")
      .send({ adminEmail: INVITEE_EMAIL });

    expect(res.status).toBe(200);

    // A local user row was resolved/created — as an ordinary user, never an admin.
    const [invitee] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, INVITEE_CLERK_ID))
      .limit(1);
    expect(invitee).toBeTruthy();
    expect(invitee.isGlobalAdmin).toBeFalsy();
    inviteeUserId = invitee.id;

    // …holding Super Administrator membership of the invited campaign.
    const grants = await db
      .select({ slug: rolesTable.slug })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
      .where(
        and(
          eq(userRolesTable.userId, inviteeUserId),
          eq(userRolesTable.tenantId, registeredTenantId),
        ),
      );
    expect(grants.map((g) => g.slug)).toContain("super-admin");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Membership is enforced for campaign users
// ═══════════════════════════════════════════════════════════════════════════════

describe("Campaign entry requires membership", () => {
  it("a member cannot enter a campaign they do not belong to", async () => {
    asFounder();

    const res = await request(app)
      .put("/api/users/me/active-campaign")
      .set("Content-Type", "application/json")
      .send({ tenantId: otherTenantId });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });
});
