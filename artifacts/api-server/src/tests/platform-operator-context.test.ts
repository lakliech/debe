/**
 * Platform-operator context tests.
 *
 * A platform operator (global admin) has NO campaign of their own. The system
 * must never pick one for them: an inferred tenant is a DB query result, so it
 * silently changes as campaigns are added, suspended or removed — and with it
 * the operator's effective privileges.
 *
 * These tests pin the contract:
 *   - identity works with no campaign at all
 *   - campaign routes refuse cleanly (409) rather than 500 or wrong-tenant data
 *   - entering a campaign is explicit, and survives as request context
 *   - leaving returns the operator to no context
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mock Clerk BEFORE any app import ────────────────────────────────────────
// The operator deliberately has no orgId — that is the whole point.
const mockAuth = { userId: "user_test_operator", orgId: null as string | null };

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

import request from "supertest";
import { db } from "@workspace/db";
import { tenantsTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../app");

let operatorId: string;
let tenantOneId: string;
let tenantTwoId: string;

beforeAll(async () => {
  const ts = Date.now();

  // SEED_CLERK_ORG_ID would give the operator a campaign through the back door
  // and defeat the point of these tests.
  delete process.env.SEED_CLERK_ORG_ID;

  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: "user_test_operator",
      email: `operator_${ts}@platform.test`,
      fullName: "Platform Operator",
      status: "active",
      isGlobalAdmin: true,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { isGlobalAdmin: true, activeTenantId: null },
    })
    .returning();
  operatorId = operator.id;

  // Two campaigns, so a test can prove the operator lands in the one they
  // chose rather than whichever happens to sort first.
  const [t1] = await db
    .insert(tenantsTable)
    .values({
      clerkOrgId: `org_op_one_${ts}`,
      name: "Operator Campaign One",
      slug: `op-one-${ts}`,
      plan: "free",
    })
    .returning();
  tenantOneId = t1.id;

  const [t2] = await db
    .insert(tenantsTable)
    .values({
      clerkOrgId: `org_op_two_${ts}`,
      name: "Operator Campaign Two",
      slug: `op-two-${ts}`,
      plan: "free",
    })
    .returning();
  tenantTwoId = t2.id;

  // Platform role at tenant_id NULL — an operator's authority is not held
  // inside any campaign.
  const [platformRole] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "platform_admin"))
    .limit(1);
  if (!platformRole) throw new Error("platform_admin role missing — run the role seed first");

  await db
    .insert(userRolesTable)
    .values({ userId: operatorId, roleId: platformRole.id, tenantId: null })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.update(usersTable).set({ activeTenantId: null }).where(eq(usersTable.id, operatorId));
  await db.delete(userRolesTable).where(eq(userRolesTable.userId, operatorId));
  await db.delete(usersTable).where(eq(usersTable.id, operatorId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantOneId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantTwoId));
});

async function setActiveCampaign(tenantId: string | null) {
  return request(app).put("/api/platform/active-campaign").send({ tenantId });
}

describe("platform operator with no campaign", () => {
  it("can load their own identity", async () => {
    await setActiveCampaign(null);
    const res = await request(app).get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body.isGlobalAdmin).toBe(true);
    expect(res.body.isPlatformOperator).toBe(true);
    expect(res.body.activeTenant).toBeNull();
    // Their platform role must be visible even with no campaign in context —
    // otherwise the UI cannot tell them apart from a user with no access.
    expect(res.body.roles.map((r: any) => r.roleSlug)).toContain("platform_admin");
  });

  it("is never given a campaign it did not choose", async () => {
    await setActiveCampaign(null);
    const res = await request(app).get("/api/users/me");
    expect(res.body.activeTenant).toBeNull();
  });

  it("gets a clean 409 from campaign routes, not a 500", async () => {
    await setActiveCampaign(null);
    const res = await request(app).get("/api/volunteers");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_CAMPAIGN_SELECTED");
  });

  it("can still reach platform routes", async () => {
    await setActiveCampaign(null);
    const res = await request(app).get("/api/platform/tenants");
    expect(res.status).toBe(200);
  });
});

describe("entering and leaving a campaign", () => {
  it("puts the chosen campaign into context", async () => {
    const put = await setActiveCampaign(tenantTwoId);
    expect(put.status).toBe(200);
    expect(put.body.activeCampaign.id).toBe(tenantTwoId);

    const me = await request(app).get("/api/users/me");
    expect(me.body.activeTenant?.id).toBe(tenantTwoId);
  });

  it("unblocks campaign routes once a campaign is entered", async () => {
    await setActiveCampaign(tenantOneId);
    const res = await request(app).get("/api/volunteers");
    expect(res.status).toBe(200);
  });

  it("returns the operator to no context when they leave", async () => {
    await setActiveCampaign(tenantOneId);
    const exit = await setActiveCampaign(null);
    expect(exit.status).toBe(200);
    expect(exit.body.activeCampaign).toBeNull();

    const me = await request(app).get("/api/users/me");
    expect(me.body.activeTenant).toBeNull();
  });

  it("refuses a campaign that does not exist", async () => {
    const res = await setActiveCampaign("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("refuses a suspended campaign", async () => {
    await db
      .update(tenantsTable)
      .set({ isSuspended: true })
      .where(eq(tenantsTable.id, tenantTwoId));
    try {
      const res = await setActiveCampaign(tenantTwoId);
      expect(res.status).toBe(409);
    } finally {
      await db
        .update(tenantsTable)
        .set({ isSuspended: false })
        .where(eq(tenantsTable.id, tenantTwoId));
    }
  });
});
