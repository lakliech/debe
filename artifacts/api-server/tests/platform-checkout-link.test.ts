/**
 * Platform-initiated subscription creation: checkout-link generation and the
 * Stripe-active guard on manual plan grants. Stripe lib is mocked — these
 * tests cover validation, state guards, and wiring, not Stripe itself.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/platform-checkout-link.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "pbx-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_q: any, _s: any, n: any) => n(),
  getAuth: () => ({ userId: currentClerkId }),
}));
vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_q: any, _s: any, n: any) => n(),
  requireLevel: () => (_q: any, _s: any, n: any) => n(),
  requireCountyOrAbove: (_q: any, _s: any, n: any) => n(),
  resolveActor: (_q: any, _s: any, n: any) => n(),
  bustActorCache: vi.fn(),
}));
vi.mock("../src/lib/platformAudit", () => ({ recordPlatformAction: vi.fn(async () => {}) }));
const checkoutCalls: any[] = [];
const ensureCustomerCalls: any[] = [];
vi.mock("../src/lib/stripe", () => ({
  stripeConfigured: () => true,
  priceIdFor: (tier: string) => (tier === "enterprise" ? null : "price_pro_123"),
  ensureCustomer: vi.fn(async (args: any) => {
    ensureCustomerCalls.push(args);
    return "cus_test_123";
  }),
  createCheckoutSession: vi.fn(async (args: any) => {
    // The delay widens the locked critical section so a concurrent request is
    // guaranteed to contend for the advisory lock instead of arriving after
    // it was released — without it the concurrency test would be a coin flip.
    await new Promise((r) => setTimeout(r, 50));
    checkoutCalls.push(args);
    return { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" };
  }),
  expireOpenCheckoutSessions: vi.fn(async () => 1),
  platformUrl: () => "https://debe.ke",
}));

import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import platformBillingRouter from "../src/routes/platformBilling";

const ts = randomUUID().slice(0, 8);
let tenantFree: string, tenantStripe: string, tenantNoEmail: string;
let tenantPastDue: string, tenantUnpaid: string, tenantIncomplete: string, tenantCanceled: string;
let tenantRace: string;
let app: express.Express;

beforeAll(async () => {
  currentClerkId = `pbx-admin-${ts}`;
  const mk = (slug: string, extra: any) =>
    db.insert(tenantsTable).values({ name: slug, slug, plan: "free", seatType: "presidential", ...extra } as any).returning();
  [tenantFree] = (await mk(`pbx-free-${ts}`, { billingEmail: "billing@campaign.ke" })).map((t: any) => t.id);
  [tenantStripe] = (await mk(`pbx-stripe-${ts}`, { billingEmail: "b@c.ke", stripeSubscriptionStatus: "active", stripeSubscriptionId: "sub_1", plan: "pro" })).map((t: any) => t.id);
  [tenantNoEmail] = (await mk(`pbx-noemail-${ts}`, {})).map((t: any) => t.id);
  // Nonterminal Stripe states: the subscription is still alive and can recover
  // via Stripe retries/webhooks, so platform-side overrides must be refused.
  [tenantPastDue] = (await mk(`pbx-pastdue-${ts}`, { billingEmail: "pd@c.ke", stripeSubscriptionStatus: "past_due", stripeSubscriptionId: "sub_pd", plan: "pro" })).map((t: any) => t.id);
  [tenantUnpaid] = (await mk(`pbx-unpaid-${ts}`, { billingEmail: "up@c.ke", stripeSubscriptionStatus: "unpaid", stripeSubscriptionId: "sub_up", plan: "pro" })).map((t: any) => t.id);
  [tenantIncomplete] = (await mk(`pbx-incomplete-${ts}`, { billingEmail: "inc@c.ke", stripeSubscriptionStatus: "incomplete", stripeSubscriptionId: "sub_inc" })).map((t: any) => t.id);
  // Terminal state: canceled subscriptions no longer recover, so overrides are safe.
  [tenantCanceled] = (await mk(`pbx-canceled-${ts}`, { billingEmail: "cx@c.ke", stripeSubscriptionStatus: "canceled", stripeSubscriptionId: "sub_cx", plan: "pro" })).map((t: any) => t.id);
  // No stripeCustomerId — the worst case for the double-customer race.
  [tenantRace] = (await mk(`pbx-race-${ts}`, { billingEmail: "race@c.ke" })).map((t: any) => t.id);

  app = express();
  app.use(express.json());
  app.use("/platform", platformBillingRouter);
});

afterAll(async () => {
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantFree, tenantStripe, tenantNoEmail, tenantPastDue, tenantUnpaid, tenantIncomplete, tenantCanceled, tenantRace]));
});

describe("platform checkout-link", () => {
  it("generates a Stripe checkout link for a campaign with a billing email", async () => {
    const res = await request(app).post(`/platform/tenants/${tenantFree}/checkout-link`).send({ tier: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("checkout.stripe.com");
    expect(checkoutCalls[0].priceId).toBe("price_pro_123");
    expect(checkoutCalls[0].tenantId).toBe(tenantFree);
    // Payer-facing redirect (public app root, not the signed-in settings
    // page — tenant portals are domain-based, so no /:slug path exists),
    // explicit 24h expiry contract.
    expect(checkoutCalls[0].successUrl).toBe("https://debe.ke/?checkout=success");
    expect(checkoutCalls[0].cancelUrl).toBe("https://debe.ke/?checkout=cancelled");
    expect(typeof checkoutCalls[0].expiresAt).toBe("number");
    expect(res.body.expiresAt).toBeTruthy();
    // ensureCustomer persisted the Stripe customer id on the tenant
    const [t] = await db.select({ c: tenantsTable.stripeCustomerId }).from(tenantsTable).where(eq(tenantsTable.id, tenantFree));
    expect(t.c).toBe("cus_test_123");
  });

  it("409s when the campaign already has an active Stripe subscription", async () => {
    const res = await request(app).post(`/platform/tenants/${tenantStripe}/checkout-link`).send({ tier: "pro" });
    expect(res.status).toBe(409);
  });

  it("400s when no billing email is on file; 503 when the tier has no Stripe price", async () => {
    const noEmail = await request(app).post(`/platform/tenants/${tenantNoEmail}/checkout-link`).send({ tier: "pro" });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toMatch(/billing email/i);

    const noPrice = await request(app).post(`/platform/tenants/${tenantFree}/checkout-link`).send({ tier: "enterprise" });
    expect(noPrice.status).toBe(503);

    const badTier = await request(app).post(`/platform/tenants/${tenantFree}/checkout-link`).send({ tier: "free" });
    expect(badTier.status).toBe(400);
  });

  it("409s checkout links for every nonterminal Stripe status, not just active", async () => {
    // past_due / unpaid / incomplete subscriptions are still alive in Stripe
    // and can recover via retries — a second checkout would double-bill.
    for (const [label, id] of [["past_due", tenantPastDue], ["unpaid", tenantUnpaid], ["incomplete", tenantIncomplete]] as const) {
      const res = await request(app).post(`/platform/tenants/${id}/checkout-link`).send({ tier: "pro" });
      expect(res.status, label).toBe(409);
      expect(res.body.error, label).toMatch(/stripe/i);
    }
    // Terminal states are safe: a canceled subscription can be replaced.
    const ok = await request(app).post(`/platform/tenants/${tenantCanceled}/checkout-link`).send({ tier: "pro" });
    expect(ok.status).toBe(200);
  });

  it("manual plan grant is refused while a Stripe subscription is active", async () => {
    const res = await request(app).patch(`/platform/tenants/${tenantStripe}/plan`).send({ plan: "enterprise", months: 12 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stripe/i);

    // Delinquent and incomplete subscriptions are Stripe-owned too — a manual
    // grant would be silently overwritten when the next webhook lands.
    for (const [label, id] of [["past_due", tenantPastDue], ["unpaid", tenantUnpaid], ["incomplete", tenantIncomplete]] as const) {
      const refused = await request(app).patch(`/platform/tenants/${id}/plan`).send({ plan: "free" });
      expect(refused.status, label).toBe(409);
      expect(refused.body.error, label).toMatch(/stripe/i);
    }

    // …but still works for non-Stripe campaigns
    const ok = await request(app).patch(`/platform/tenants/${tenantFree}/plan`).send({ plan: "pro", months: 6 });
    expect(ok.status).toBe(200);
    const [t] = await db.select({ plan: tenantsTable.plan, until: tenantsTable.planOverrideUntil })
      .from(tenantsTable).where(eq(tenantsTable.id, tenantFree));
    expect(t.plan).toBe("pro");
    expect(t.until).toBeTruthy();
  });

  it("two simultaneous first-time link requests produce exactly one payable session", async () => {
    // Regression: the advisory lock must be taken BEFORE ensureCustomer. Two
    // concurrent requests with no stripeCustomerId must not each create a
    // Stripe customer — the loser would be unable to expire the winner's open
    // session and both links would stay payable (double subscription).
    const callsBefore = checkoutCalls.filter((c) => c.tenantId === tenantRace).length;
    const ensureBefore = ensureCustomerCalls.filter((c) => c.tenantId === tenantRace).length;

    const [a, b] = await Promise.all([
      request(app).post(`/platform/tenants/${tenantRace}/checkout-link`).send({ tier: "pro" }),
      request(app).post(`/platform/tenants/${tenantRace}/checkout-link`).send({ tier: "pro" }),
    ]);

    // One wins the lock and issues the link; the other is turned away.
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const callsAfter = checkoutCalls.filter((c) => c.tenantId === tenantRace).length;
    const ensureAfter = ensureCustomerCalls.filter((c) => c.tenantId === tenantRace).length;
    expect(callsAfter - callsBefore).toBe(1);
    expect(ensureAfter - ensureBefore).toBe(1);

    // The tenant row ends with exactly one customer id — no overwrite race.
    const [t] = await db
      .select({ c: tenantsTable.stripeCustomerId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantRace));
    expect(t.c).toBe("cus_test_123");
  });
});
