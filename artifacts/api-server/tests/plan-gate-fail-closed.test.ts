/**
 * A capacity gate that cannot count must refuse, not wave the request through.
 *
 * The first version of this middleware caught counting errors and called
 * next(), which is how the agent cap shipped as a no-op: the counter threw on
 * every request, the throw was swallowed, and the Free plan quietly allowed
 * unlimited agents. Refusing is recoverable — the operator retries. Failing
 * open removes the product boundary and nothing in the response says so.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/plan-gate-fail-closed.test.ts
 */

import { vi, describe, it, expect } from "vitest";

// The platform super admin bypasses every gate; this suite is about the
// ordinary campaign, so keep the override out of the way.
vi.mock("../src/lib/platformOverride", () => ({
  hasPlatformOverride: vi.fn(async () => false),
}));

import { requireCapacity } from "../src/middlewares/requirePlan";

const FREE_TENANT = { id: "00000000-0000-0000-0000-000000000000", plan: "free", planOverrideUntil: null };

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const brokenCounter = async () => {
  throw new Error("relation \"polling_agents\" does not exist");
};

describe("requireCapacity when the count fails", () => {
  it("refuses the request instead of allowing it", async () => {
    const req: any = { tenant: FREE_TENANT, method: "POST" };
    const res = fakeRes();
    const next = vi.fn();

    await requireCapacity("maxAgents", brokenCounter, "polling agents")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ feature: "maxAgents", retryable: true });
  });

  it("says the limit could not be checked rather than blaming the plan", async () => {
    const req: any = { tenant: FREE_TENANT, method: "POST" };
    const res = fakeRes();

    await requireCapacity("maxAgents", brokenCounter, "polling agents")(req, res, vi.fn());

    // 402 would tell the campaign to pay for something they may already have.
    expect(res.statusCode).not.toBe(402);
    expect(String(res.body.error)).toMatch(/try again/i);
  });

  it("still allows the request when the plan has no cap at all", async () => {
    // A stored "pro" only grants Pro while the grant is live, so the override
    // has to be in the future for this to be an uncapped campaign.
    const paid = { ...FREE_TENANT, plan: "pro", planOverrideUntil: new Date(Date.now() + 86_400_000) };
    const req: any = { tenant: paid, method: "POST" };
    const res = fakeRes();
    const next = vi.fn();

    // Unlimited plans never reach the counter, so a broken counter is moot.
    await requireCapacity("maxAgents", brokenCounter, "polling agents")(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });
});
