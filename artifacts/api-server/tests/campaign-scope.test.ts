/**
 * Campaign scope — seat + geography rules.
 *
 * Unit coverage of normalizeScope (the seat→geography matrix) plus route
 * coverage of PATCH /api/settings/scope and the scope fields on
 * GET /api/settings/overview. Geography fixtures use the seeded shared
 * reference data (counties/constituencies/wards are global, not per-tenant).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/campaign-scope.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "scope-test-clerk" }),
}));

vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));

import { db } from "@workspace/db";
import { tenantsTable, countiesTable, constituenciesTable, wardsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { normalizeScope, ScopeValidationError } from "../src/lib/campaignScope";
import settingsRouter from "../src/routes/settings";
import platformRouter from "../src/routes/platform";

const SLUG = `scope-test-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let app: express.Express;
let county: { id: string; name: string };
let constituency: { id: string; name: string; countyId: string };
let ward: { id: string; name: string; constituencyId: string };

beforeAll(async () => {
  const [t] = await db.insert(tenantsTable).values({ name: "Scope Test", slug: SLUG }).returning();
  tenantId = t.id;

  // Real seeded geography: a county that has constituencies, one of which has wards.
  const [c] = await db
    .select({ id: countiesTable.id, name: countiesTable.name })
    .from(countiesTable)
    .innerJoin(constituenciesTable, eq(constituenciesTable.countyId, countiesTable.id))
    .limit(1);
  county = c;
  const [con] = await db
    .select({ id: constituenciesTable.id, name: constituenciesTable.name, countyId: constituenciesTable.countyId })
    .from(constituenciesTable)
    .innerJoin(wardsTable, eq(wardsTable.constituencyId, constituenciesTable.id))
    .where(eq(constituenciesTable.countyId, county.id))
    .limit(1);
  constituency = con;
  const [w] = await db
    .select({ id: wardsTable.id, name: wardsTable.name, constituencyId: wardsTable.constituencyId })
    .from(wardsTable)
    .where(eq(wardsTable.constituencyId, constituency.id))
    .limit(1);
  ward = w;

  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/settings", settingsRouter);
});

afterAll(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("normalizeScope", () => {
  it("presidential requires no geography and nulls any supplied", () => {
    const s = normalizeScope({
      seatType: "presidential",
      scopeCountyId: randomUUID(),
      scopeWardId: randomUUID(),
    });
    expect(s).toEqual({ seatType: "presidential", scopeCountyId: null, scopeConstituencyId: null, scopeWardId: null });
  });

  it.each(["gubernatorial", "senator", "women_rep"])("%s requires a county", (seat) => {
    expect(() => normalizeScope({ seatType: seat })).toThrow(ScopeValidationError);
    const countyId = randomUUID();
    const s = normalizeScope({ seatType: seat, scopeCountyId: countyId, scopeWardId: randomUUID() });
    expect(s.scopeCountyId).toBe(countyId);
    expect(s.scopeWardId).toBeNull(); // irrelevant level nulled
  });

  it("mp requires a constituency and nulls county/ward", () => {
    expect(() => normalizeScope({ seatType: "mp" })).toThrow(/constituency/i);
    const constituencyId = randomUUID();
    const s = normalizeScope({ seatType: "mp", scopeCountyId: randomUUID(), scopeConstituencyId: constituencyId });
    expect(s.scopeConstituencyId).toBe(constituencyId);
    expect(s.scopeCountyId).toBeNull();
  });

  it("mca requires a ward", () => {
    expect(() => normalizeScope({ seatType: "mca" })).toThrow(/ward/i);
    const wardId = randomUUID();
    expect(normalizeScope({ seatType: "mca", scopeWardId: wardId }).scopeWardId).toBe(wardId);
  });

  it("rejects unknown seats, missing seats, and malformed ids", () => {
    expect(() => normalizeScope({ seatType: "mayor" })).toThrow(ScopeValidationError);
    expect(() => normalizeScope({})).toThrow(ScopeValidationError);
    expect(() => normalizeScope({ seatType: "gubernatorial", scopeCountyId: "nairobi" })).toThrow(/valid id/i);
  });
});

describe("PATCH /settings/scope", () => {
  it("sets a presidential (national) scope", async () => {
    const res = await request(app).patch("/settings/scope").send({ seatType: "presidential" });
    expect(res.status).toBe(200);
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    expect(t.seatType).toBe("presidential");
    expect(t.scopeCountyId).toBeNull();
  });

  it("rejects a gubernatorial scope without a county", async () => {
    const res = await request(app).patch("/settings/scope").send({ seatType: "gubernatorial" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/county/i);
  });

  it("rejects a geography id that does not exist", async () => {
    const res = await request(app)
      .patch("/settings/scope")
      .send({ seatType: "gubernatorial", scopeCountyId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/county not found/i);
  });

  it("sets a county scope for senator", async () => {
    const res = await request(app)
      .patch("/settings/scope")
      .send({ seatType: "senator", scopeCountyId: county.id });
    expect(res.status).toBe(200);
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    expect(t.seatType).toBe("senator");
    expect(t.scopeCountyId).toBe(county.id);
    expect(t.scopeConstituencyId).toBeNull();
  });

  it("sets an mp scope from a constituency", async () => {
    const res = await request(app)
      .patch("/settings/scope")
      .send({ seatType: "mp", scopeConstituencyId: constituency.id });
    expect(res.status).toBe(200);
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    expect(t.scopeConstituencyId).toBe(constituency.id);
    expect(t.scopeCountyId).toBeNull();
  });

  it("sets an mca scope from a ward", async () => {
    const res = await request(app).patch("/settings/scope").send({ seatType: "mca", scopeWardId: ward.id });
    expect(res.status).toBe(200);
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    expect(t.scopeWardId).toBe(ward.id);
  });
});

describe("GET /settings/overview scope fields", () => {
  it("returns the seat and resolved geography chain", async () => {
    await request(app).patch("/settings/scope").send({ seatType: "mca", scopeWardId: ward.id });
    const res = await request(app).get("/settings/overview");
    expect(res.status).toBe(200);
    expect(res.body.campaign.seatType).toBe("mca");
    expect(res.body.campaign.scopeWard).toMatchObject({ id: ward.id, name: ward.name, constituencyId: ward.constituencyId });
    expect(res.body.campaign.scopeCounty).toBeNull();
  });
});

describe("POST /platform/tenants scope enforcement", () => {
  let platformApp: express.Express;
  beforeAll(() => {
    platformApp = express();
    platformApp.use(express.json());
    platformApp.use("/platform", platformRouter);
  });

  it("rejects a platform-provisioned tenant with no seat", async () => {
    const res = await request(platformApp)
      .post("/platform/tenants")
      .send({ name: "No Scope Co", slug: `no-scope-${randomUUID().slice(0, 8)}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/seat/i);
  });

  it("rejects an invalid seat/geography combination", async () => {
    const res = await request(platformApp)
      .post("/platform/tenants")
      .send({ name: "Bad Scope Co", slug: `bad-scope-${randomUUID().slice(0, 8)}`, seatType: "mca", scopeCountyId: county.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ward/i);
  });
});

describe("tenants_scope_valid database constraint", () => {
  const checkSlug = `check-test-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await db.execute(sql`DELETE FROM tenants WHERE slug LIKE ${checkSlug + "%"}`);
  });

  // Drizzle wraps driver errors: the PG constraint detail (including the
  // constraint name) lives on err.cause, not the wrapper's err.message.
  async function expectCheckViolation(promise: Promise<unknown>) {
    const err: any = await promise.then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/tenants_scope_valid/);
  }

  it("rejects a county seat with no county", async () => {
    await expectCheckViolation(
      db.execute(sql`INSERT INTO tenants (name, slug, seat_type) VALUES ('C', ${checkSlug + "-1"}, 'gubernatorial')`),
    );
  });

  it("rejects a presidential row pinned to a county (FK valid, CHECK violated)", async () => {
    await expectCheckViolation(
      db.execute(
        sql`INSERT INTO tenants (name, slug, seat_type, scope_county_id) VALUES ('C', ${checkSlug + "-2"}, 'presidential', ${county.id})`,
      ),
    );
  });

  it("accepts an mp row with only a constituency", async () => {
    await db.execute(
      sql`INSERT INTO tenants (name, slug, seat_type, scope_constituency_id) VALUES ('C', ${checkSlug + "-3"}, 'mp', ${constituency.id})`,
    );
    const [row] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, checkSlug + "-3"));
    expect(row).toBeDefined();
  });
});
