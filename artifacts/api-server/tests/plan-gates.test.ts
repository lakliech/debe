/**
 * Plan enforcement tests — a Free campaign is actually stopped, and the stop
 * is legible.
 *
 * What this covers (real DB, mocked Clerk session):
 *   A. Excel export is Pro-only, but CSV export stays free. The report
 *      exporter serves both from ONE route with the format in the body, so a
 *      whole-route gate would have quietly taken CSV away from Free campaigns.
 *   B. Polling-agent headcount stops at the Free cap, single create and bulk
 *      import alike. The import path is the one that can jump the cap in a
 *      single request, so it is checked against the whole batch.
 *   C. Every refusal answers 402 with the machine-readable body the UI needs
 *      to prompt an upgrade (feature, currentPlan, requiredPlan).
 *   D. A granted plan lifts the gate, and the grant is read through the
 *      effective-plan resolver — a lapsed override must NOT keep the feature.
 *   E. The database refuses a plan value outside the three sellable tiers.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/plan-gates.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const ts = Date.now();
const ADMIN_CLERK_ID = `user_plan_admin_${ts}`;
const ADMIN_EMAIL = `plan-admin-${ts}@gates.test`;

const mockAuth = { userId: ADMIN_CLERK_ID };

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
  clerkUserEmail: vi.fn(async () => ADMIN_EMAIL),
  clerkUserName: vi.fn(async () => "Plan Admin"),
  clerkUserIdsByEmail: vi.fn(async () => [ADMIN_CLERK_ID]),
  clerkVerifiedPrimaryEmail: vi.fn(async () => null),
}));

vi.mock("../src/lib/email", () => ({ sendEmailAsync: vi.fn() }));

import request from "supertest";
import {
  db,
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  pollingAgentsTable,
  pollingStationsTable,
  campaignStationProfilesTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { capacityViolation, countAgents } from "../src/middlewares/requirePlan";
import { PLANS } from "../src/lib/plans";

const { default: app } = await import("../src/app");

const FREE_AGENT_CAP = PLANS.free.maxAgents as number;
const FREE_STATION_CAP = PLANS.free.maxStations as number;

let tenantId: string;
let adminUserId: string;
/** Real stations from the seeded IEBC register — enough to fill the Free cap. */
let stationIds: string[] = [];
const insertedRoleIds: string[] = [];

async function ensureRole(slug: string, name: string, level: number): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name, level }).returning();
  insertedRoleIds.push(role.id);
  return role.id;
}

/** Put the campaign on a plan, expressed the way the platform grants them. */
async function setPlan(plan: "free" | "pro" | "enterprise", overrideUntil: Date | null) {
  await db
    .update(tenantsTable)
    .set({ plan, planOverrideUntil: overrideUntil })
    .where(eq(tenantsTable.id, tenantId));
}

/** Bring the campaign's agent roll to exactly `n` rows. */
async function setAgentCount(n: number) {
  await db.delete(pollingAgentsTable).where(eq(pollingAgentsTable.tenantId, tenantId));
  if (n === 0) return;
  await db.insert(pollingAgentsTable).values(
    Array.from({ length: n }, (_, i) => ({
      tenantId,
      fullName: `Seeded Agent ${i}`,
      phoneNumber: `+2547${String(10_000_000 + i).slice(0, 8)}`,
    })),
  );
}

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Plan Gates Campaign", slug: `plan-gates-${ts}`, plan: "free" })
    .returning();
  tenantId = tenant.id;

  const [admin] = await db
    .insert(usersTable)
    .values({
      clerkId: ADMIN_CLERK_ID,
      email: ADMIN_EMAIL,
      fullName: "Plan Admin",
      status: "active",
      isGlobalAdmin: false, // the platform override must not mask these gates
      activeTenantId: tenantId,
    })
    .returning();
  adminUserId = admin.id;

  // Holds both capabilities the gated routes require: exports and agent admin.
  const directorRole = await ensureRole("campaign-exec-director", "Campaign Executive Director", 1);
  await db.insert(userRolesTable).values({ userId: adminUserId, roleId: directorRole, tenantId });

  stationIds = (
    await db
      .select({ id: pollingStationsTable.id })
      .from(pollingStationsTable)
      .limit(FREE_STATION_CAP + 2)
  ).map((r) => r.id);
});

afterAll(async () => {
  await db.delete(campaignStationProfilesTable).where(eq(campaignStationProfilesTable.tenantId, tenantId));
  await db.delete(pollingAgentsTable).where(eq(pollingAgentsTable.tenantId, tenantId));
  await db.delete(userRolesTable).where(eq(userRolesTable.userId, adminUserId));
  await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (insertedRoleIds.length) {
    await db.delete(rolesTable).where(inArray(rolesTable.id, insertedRoleIds));
  }
});

beforeEach(async () => {
  await setPlan("free", null);
});

// ═══════════════════════════════════════════════════════════════════════════
// A + C. Excel is paid, CSV is not, and the refusal is machine-readable
// ═══════════════════════════════════════════════════════════════════════════

describe("Excel export gate", () => {
  const exportReq = (format: "csv" | "excel") =>
    request(app)
      .post("/api/reporting/export")
      .set("Content-Type", "application/json")
      .send({ reportId: "volunteers", format });

  it("refuses an Excel export on the Free plan with an upgrade-ready 402", async () => {
    const res = await exportReq("excel");

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      feature: "excelExport",
      currentPlan: "free",
      requiredPlan: "pro",
    });
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/pro/i);
  });

  it("still serves the same report as CSV on the Free plan", async () => {
    const res = await exportReq("csv");
    expect(res.status).toBe(200);
  });

  it("allows Excel once the campaign is on Pro", async () => {
    await setPlan("pro", new Date(Date.now() + 30 * 86_400_000));
    expect((await exportReq("excel")).status).toBe(200);
  });

  it("refuses Excel again once a Pro grant has lapsed", async () => {
    // Stored plan still says "pro" — entitlement must come from the resolver,
    // which reads an expired override as Free.
    await setPlan("pro", new Date(Date.now() - 86_400_000));
    const res = await exportReq("excel");

    expect(res.status).toBe(402);
    expect(res.body.currentPlan).toBe("free");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Agent headcount stops at the cap — single create and bulk import
// ═══════════════════════════════════════════════════════════════════════════

describe("Polling-agent capacity gate", () => {
  let phoneSeq = 0;
  const createAgent = (name: string) =>
    request(app)
      .post("/api/polling-agents/")
      .set("Content-Type", "application/json")
      .send({ fullName: name, phoneNumber: `+25470${String(1_000_000 + phoneSeq++)}` });

  it("allows a create while the campaign is under the Free cap", async () => {
    await setAgentCount(FREE_AGENT_CAP - 1);
    const res = await createAgent(`Under Cap ${ts}`);
    expect(res.status).toBe(201);
  });

  it("refuses the create that would exceed the Free cap", async () => {
    await setAgentCount(FREE_AGENT_CAP);
    const res = await createAgent(`Over Cap ${ts}`);

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ feature: "maxAgents", currentPlan: "free" });
    expect(res.body.error).toMatch(new RegExp(String(FREE_AGENT_CAP)));

    // The refusal is real — nothing was written.
    expect(await countAgents(tenantId)).toBe(FREE_AGENT_CAP);
  });

  it("lifts the cap entirely on Pro", async () => {
    await setAgentCount(FREE_AGENT_CAP);
    await setPlan("pro", new Date(Date.now() + 30 * 86_400_000));
    expect((await createAgent(`Pro Agent ${ts}`)).status).toBe(201);
  });

  it("refuses a bulk import that would jump the cap in one request", async () => {
    // The per-request gate alone would wave this through: the campaign is well
    // under the cap when the request arrives, and only over it afterwards.
    await setAgentCount(FREE_AGENT_CAP - 5);
    const violation = await capacityViolation(tenantId, "maxAgents", countAgents, "polling agents", 100);

    expect(violation).not.toBeNull();
    expect(violation).toMatchObject({
      feature: "maxAgents",
      currentPlan: "free",
      requiredPlan: "pro",
      limit: FREE_AGENT_CAP,
      incoming: 100,
    });
  });

  it("allows a bulk import that fits inside the remaining headroom", async () => {
    await setAgentCount(FREE_AGENT_CAP - 5);
    expect(
      await capacityViolation(tenantId, "maxAgents", countAgents, "polling agents", 5),
    ).toBeNull();
  });

  it("refuses a bulk import outright when the headcount can't be counted", async () => {
    // Returning null on a counting failure would read as "the batch fits" and
    // insert the whole import past the cap. It has to blow up instead.
    const brokenCount = async () => {
      throw new Error("count unavailable");
    };
    await expect(
      capacityViolation(tenantId, "maxAgents", brokenCount, "polling agents", 500),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2. Station coverage stops at the cap — but keeping existing stations
//     up to date never does
// ═══════════════════════════════════════════════════════════════════════════

describe("Polling-station capacity gate", () => {
  /** Cover `n` stations for this campaign, straight into the table. */
  async function setStationCount(n: number) {
    await db.delete(campaignStationProfilesTable).where(eq(campaignStationProfilesTable.tenantId, tenantId));
    if (n === 0) return;
    await db.insert(campaignStationProfilesTable).values(
      stationIds.slice(0, n).map((stationId) => ({ tenantId, stationId })),
    );
  }

  const profileStation = (stationId: string) =>
    request(app)
      .patch(`/api/polling-stations-mgmt/stations/${stationId}`)
      .set("Content-Type", "application/json")
      .send({ contactStatus: "contacted" });

  it("covers a new station while the campaign is under the Free cap", async () => {
    await setStationCount(FREE_STATION_CAP - 1);
    const res = await profileStation(stationIds[FREE_STATION_CAP - 1]);
    expect(res.status).toBe(200);
  });

  it("refuses the station that would exceed the Free cap", async () => {
    await setStationCount(FREE_STATION_CAP);
    const res = await profileStation(stationIds[FREE_STATION_CAP]);

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ feature: "maxStations", currentPlan: "free", requiredPlan: "pro" });
  });

  it("still lets a capped campaign update a station it already covers", async () => {
    await setStationCount(FREE_STATION_CAP);
    const res = await profileStation(stationIds[0]);
    expect(res.status).toBe(200);
  });

  it("refuses a bulk status update that would add more stations than fit", async () => {
    await setStationCount(FREE_STATION_CAP - 1);
    const res = await request(app)
      .post("/api/polling-stations-mgmt/stations/bulk-status")
      .set("Content-Type", "application/json")
      .send({
        stationIds: [stationIds[FREE_STATION_CAP - 1], stationIds[FREE_STATION_CAP]],
        contactStatus: "contacted",
      });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ feature: "maxStations", incoming: 2 });
  });

  it("lifts the station cap on Pro", async () => {
    await setStationCount(FREE_STATION_CAP);
    await setPlan("pro", new Date(Date.now() + 30 * 86_400_000));
    expect((await profileStation(stationIds[FREE_STATION_CAP])).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. The usage endpoint the upgrade banner reads
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/billing/usage", () => {
  it("reports the count and the cap so the banner can show '48 of 50'", async () => {
    await setAgentCount(FREE_AGENT_CAP - 2);
    const res = await request(app).get("/api/billing/usage");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: "free",
      planLabel: "Free",
      agents: FREE_AGENT_CAP - 2,
      maxAgents: FREE_AGENT_CAP,
    });
  });

  it("reports an uncapped plan as null, so the banner stays hidden", async () => {
    await setPlan("pro", new Date(Date.now() + 30 * 86_400_000));
    const res = await request(app).get("/api/billing/usage");

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("pro");
    expect(res.body.maxAgents).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. The three tiers are the only writable values
// ═══════════════════════════════════════════════════════════════════════════

describe("plan column", () => {
  it("rejects a tier outside free/pro/enterprise at the database level", async () => {
    await expect(
      db.execute(
        sql`UPDATE tenants SET plan = 'platinum' WHERE id = ${tenantId}::uuid`,
      ),
    ).rejects.toThrow();
  });

  it("accepts each of the three sellable tiers", async () => {
    for (const tier of ["free", "pro", "enterprise"] as const) {
      await setPlan(tier, null);
      const [row] = await db
        .select({ plan: tenantsTable.plan })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId))
        .limit(1);
      expect(row.plan).toBe(tier);
    }
  });
});
