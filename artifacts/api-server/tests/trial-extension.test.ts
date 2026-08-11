/**
 * Manual trial extension tests — PATCH /api/platform/tenants/:id/trial.
 *
 * Sales extends trials by hand ("they lost a week to the IEBC roll"), and the
 * failure modes are all quiet ones: extending from today silently shortens a
 * trial that still had time on it, extending a campaign that was already
 * downgraded leaves them on Free with a future override that grants nothing,
 * and extending a paying customer writes an expiry that Stripe overrules. Each
 * of those looks like success in the UI, so each is asserted here.
 *
 * Also covers the surface the operator reads before acting: the tenant list
 * must distinguish a trial from a paid plan of the same name.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/trial-extension.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const mockAuth = { userId: "" as string | null };

const ts = Date.now();
const OPERATOR_CLERK_ID = `user_trial_operator_${ts}`;
const OUTSIDER_CLERK_ID = `user_trial_outsider_${ts}`;
const OPERATOR_EMAIL = `operator-${ts}@trial.test`;
const OUTSIDER_EMAIL = `outsider-${ts}@trial.test`;

const EMAILS: Record<string, string> = {
  [OPERATOR_CLERK_ID]: OPERATOR_EMAIL,
  [OUTSIDER_CLERK_ID]: OUTSIDER_EMAIL,
};

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
  clerkUserName: vi.fn(async () => null),
  clerkUserIdsByEmail: vi.fn(async () => []),
  clerkVerifiedPrimaryEmail: vi.fn(async () => null),
}));

vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ status: "skipped" })),
  sendEmailAsync: vi.fn(),
}));

import request from "supertest";
import { db } from "@workspace/db";
import { tenantsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const { default: app } = await import("../src/app");

const DAY = 86_400_000;

let trialTenantId: string;
let lapsedTenantId: string;
let payingTenantId: string;
let operatorUserId: string;
let outsiderUserId: string;

function asOperator() {
  mockAuth.userId = OPERATOR_CLERK_ID;
}

/** Days from now until a stored expiry, rounded the way the resolver rounds. */
function daysFromNow(until: Date | string | null): number | null {
  if (!until) return null;
  return Math.ceil((new Date(until).getTime() - Date.now()) / DAY);
}

async function readTenant(id: string) {
  const [row] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
  return row;
}

function extend(tenantId: string, body: unknown) {
  return request(app)
    .patch(`/api/platform/tenants/${tenantId}/trial`)
    .set("Content-Type", "application/json")
    .send(body as any);
}

beforeAll(async () => {
  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: OPERATOR_CLERK_ID,
      email: OPERATOR_EMAIL,
      fullName: "Trial Operator",
      status: "active",
      isGlobalAdmin: true,
      activeTenantId: null,
    })
    .returning();
  operatorUserId = operator.id;

  // No platform standing and no campaign roles — the refusal case.
  const [outsider] = await db
    .insert(usersTable)
    .values({
      clerkId: OUTSIDER_CLERK_ID,
      email: OUTSIDER_EMAIL,
      fullName: "Trial Outsider",
      status: "active",
      isGlobalAdmin: false,
      activeTenantId: null,
    })
    .returning();
  outsiderUserId = outsider.id;

  const [trialTenant] = await db
    .insert(tenantsTable)
    .values({ name: "Trial Running", slug: `trial-running-${ts}`, plan: "free" })
    .returning();
  trialTenantId = trialTenant.id;

  const [lapsedTenant] = await db
    .insert(tenantsTable)
    .values({ name: "Trial Lapsed", slug: `trial-lapsed-${ts}`, plan: "free" })
    .returning();
  lapsedTenantId = lapsedTenant.id;

  const [payingTenant] = await db
    .insert(tenantsTable)
    .values({ name: "Trial Paying", slug: `trial-paying-${ts}`, plan: "pro" })
    .returning();
  payingTenantId = payingTenant.id;
});

afterAll(async () => {
  const tenantIds = [trialTenantId, lapsedTenantId, payingTenantId].filter(Boolean);
  if (tenantIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.tenantId, tenantIds));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  }
  await db
    .delete(usersTable)
    .where(inArray(usersTable.id, [operatorUserId, outsiderUserId].filter(Boolean)));
});

beforeEach(async () => {
  asOperator();

  // Each test asserts on the rows *it* produced, so clear what earlier ones left.
  await db
    .delete(auditLogsTable)
    .where(inArray(auditLogsTable.tenantId, [trialTenantId, lapsedTenantId, payingTenantId]));

  // A trial with 5 days still on the clock.
  await db
    .update(tenantsTable)
    .set({
      plan: "pro",
      planOverrideUntil: new Date(Date.now() + 5 * DAY),
      stripeSubscriptionStatus: null,
      trialUsed: true,
    })
    .where(eq(tenantsTable.id, trialTenantId));

  // A trial the expiry cron already ran on: downgraded to Free, override cleared.
  await db
    .update(tenantsTable)
    .set({
      plan: "free",
      planOverrideUntil: null,
      stripeSubscriptionStatus: null,
      trialUsed: true,
    })
    .where(eq(tenantsTable.id, lapsedTenantId));

  // A campaign that converted — Stripe grants the plan, not the override.
  await db
    .update(tenantsTable)
    .set({
      plan: "pro",
      planOverrideUntil: null,
      stripeSubscriptionStatus: "active",
      trialUsed: true,
    })
    .where(eq(tenantsTable.id, payingTenantId));
});

describe("Extending a trial that is still running", () => {
  it("adds the days on top of the time remaining instead of restarting from today", async () => {
    const res = await extend(trialTenantId, { days: 7 });
    expect(res.status).toBe(200);

    // 5 days left + 7 granted = 12. Extending from "now" would give 7 and
    // quietly cost the campaign the 5 days it already had.
    const row = await readTenant(trialTenantId);
    expect(daysFromNow(row.planOverrideUntil)).toBe(12);
    expect(row.plan).toBe("pro");
  });

  it("keeps the campaign readable as a trial in the platform tenant list", async () => {
    await extend(trialTenantId, { days: 7 });

    const res = await request(app).get("/api/platform/tenants");
    expect(res.status).toBe(200);

    const row = res.body.find((t: any) => t.id === trialTenantId);
    expect(row).toBeDefined();
    // A stored plan of "pro" is indistinguishable from a paying customer, so
    // the list has to carry the trial flag itself.
    expect(row.isTrial).toBe(true);
    expect(row.trialDaysLeft).toBe(12);
    expect(row.effectivePlan).toBe("pro");
  });

  it("records exactly one audit entry naming the old and new expiry", async () => {
    const before = await readTenant(trialTenantId);
    const res = await extend(trialTenantId, { days: 3 });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, "platform.tenant.trial-extend"),
          eq(auditLogsTable.tenantId, trialTenantId),
        ),
      );
    expect(rows).toHaveLength(1);
    // The audit helper stores structured context as the entry's new_value JSON.
    const details = JSON.parse(rows[0].newValue as string);
    expect(details.days).toBe(3);
    expect(new Date(details.previousTrialEndsAt).getTime()).toBe(
      new Date(before.planOverrideUntil!).getTime(),
    );
    expect(new Date(details.trialEndsAt).getTime()).toBeGreaterThan(
      new Date(details.previousTrialEndsAt).getTime(),
    );
  });
});

describe("Extending a trial that already expired", () => {
  it("puts the Pro tier back rather than extending Free", async () => {
    const res = await extend(lapsedTenantId, { days: 10 });
    expect(res.status).toBe(200);

    const row = await readTenant(lapsedTenantId);
    // An override alone would leave them on Free with a future expiry that
    // grants nothing — the operator would see "extended" and the campaign
    // would still be capped.
    expect(row.plan).toBe("pro");
    expect(daysFromNow(row.planOverrideUntil)).toBe(10);
  });
});

describe("Extending is refused where it would not take effect", () => {
  it("refuses a campaign with an active Stripe subscription and changes nothing", async () => {
    const res = await extend(payingTenantId, { days: 7 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stripe/i);

    const row = await readTenant(payingTenantId);
    expect(row.planOverrideUntil).toBeNull();
  });

  it("rejects a day count outside the allowed window", async () => {
    expect((await extend(trialTenantId, { days: 0 })).status).toBe(400);
    expect((await extend(trialTenantId, { days: 91 })).status).toBe(400);
    expect((await extend(trialTenantId, {})).status).toBe(400);

    // Nothing was written by any of the rejected attempts.
    const row = await readTenant(trialTenantId);
    expect(daysFromNow(row.planOverrideUntil)).toBe(5);
  });

  it("404s for a campaign that does not exist", async () => {
    const res = await extend("00000000-0000-0000-0000-000000000000", { days: 7 });
    expect(res.status).toBe(404);
  });

  it("refuses a caller without platform standing", async () => {
    mockAuth.userId = OUTSIDER_CLERK_ID;
    const res = await extend(trialTenantId, { days: 7 });
    expect(res.status).toBe(403);

    const row = await readTenant(trialTenantId);
    expect(daysFromNow(row.planOverrideUntil)).toBe(5);
  });
});
