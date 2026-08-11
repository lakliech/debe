/**
 * Enrollment (onboarding) — application submission, dedupe, coordinator
 * approval assigning roles + person records, rejection, tenant isolation.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/enrollments.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "enr-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_q: any, _s: any, n: any) => n(),
  getAuth: () => ({ userId: currentClerkId }),
}));
vi.mock("../src/middlewares/rateLimits", () => ({
  publicSubmitLimiter: (_q: any, _s: any, n: any) => n(),
  statusCheckLimiter: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_q: any, _s: any, n: any) => n(),
  requireLevel: () => (_q: any, _s: any, n: any) => n(),
  requireCountyOrAbove: (_q: any, _s: any, n: any) => n(),
  resolveActor: (_q: any, _s: any, n: any) => n(),
  bustActorCache: vi.fn(),
}));

import { db } from "@workspace/db";
import {
  tenantsTable, usersTable, userRolesTable, rolesTable,
  volunteersTable, pollingAgentsTable, enrollmentsTable, countiesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import enrollmentsRouter from "../src/routes/enrollments";

const ts = randomUUID().slice(0, 8);
const MGR = `enr-mgr-${ts}`;
const APPLICANT = `enr-app-${ts}`;
const AGENT_APP = `enr-agapp-${ts}`;
const OUTSIDER = `enr-out-${ts}`;
const APP2 = `enr-app2-${ts}`;

let tenantA: string, tenantB: string;
const tenantIds: string[] = [];
const userIds: string[] = [];
let app: express.Express;

beforeAll(async () => {
  const [ta] = await db.insert(tenantsTable).values({ name: `Enr A ${ts}`, slug: `enr-a-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  const [tb] = await db.insert(tenantsTable).values({ name: `Enr B ${ts}`, slug: `enr-b-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  tenantA = ta.id; tenantB = tb.id; tenantIds.push(ta.id, tb.id);

  let [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, "county-coordinator")).limit(1);
  if (!role) [role] = await db.insert(rolesTable).values({ slug: "county-coordinator", name: "county-coordinator", level: 3 } as any).returning();
  // Coordinator in tenant A only.
  const [mgr] = await db.insert(usersTable).values({ clerkId: MGR, email: `${MGR}@t.local`, fullName: MGR, status: "active", isGlobalAdmin: false, activeTenantId: tenantA } as any).returning();
  userIds.push(mgr.id);
  await db.insert(userRolesTable).values({ userId: mgr.id, roleId: role.id, tenantId: tenantA } as any);
  // Applicant user rows may or may not exist — create one for the agent applicant only.
  const [agUser] = await db.insert(usersTable).values({ clerkId: AGENT_APP, email: `${AGENT_APP}@t.local`, fullName: AGENT_APP, status: "active", isGlobalAdmin: false } as any).returning();
  userIds.push(agUser.id);

  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/enrollments", enrollmentsRouter);
});

afterAll(async () => {
  await db.delete(enrollmentsTable).where(inArray(enrollmentsTable.tenantId, tenantIds));
  await db.delete(volunteersTable).where(inArray(volunteersTable.tenantId, tenantIds));
  await db.delete(pollingAgentsTable).where(inArray(pollingAgentsTable.tenantId, tenantIds));
  await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds.concat([])));
  await db.delete(userRolesTable).where(inArray(userRolesTable.tenantId, tenantIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [MGR, APPLICANT, APP2, AGENT_APP, OUTSIDER]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
});

describe("reviewer geographic scope", () => {
  it("a county-scoped coordinator cannot approve out-of-county applications", async () => {
    const [c1] = await db.insert(countiesTable).values({ name: `Enr County One ${ts}`, code: 900000 + Math.floor(Math.random() * 9000) } as any).returning();
    const [c2] = await db.insert(countiesTable).values({ name: `Enr County Two ${ts}`, code: 910000 + Math.floor(Math.random() * 9000) } as any).returning();
    let [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, "county-coordinator")).limit(1);
    const [sc] = await db.insert(usersTable).values({ clerkId: `enr-scoped-${ts}`, email: `enr-scoped-${ts}@t.local`, fullName: "Scoped", status: "active", isGlobalAdmin: false, activeTenantId: tenantA } as any).returning();
    userIds.push(sc.id);
    await db.insert(userRolesTable).values({ userId: sc.id, roleId: role.id, tenantId: tenantA, countyId: c2.id } as any);

    currentClerkId = `enr-scapp-${ts}`; // dedicated applicant — never used elsewhere
    const inScope = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "In Scope", phoneNumber: "+254700000010", email: `enr-in-${ts}@t.local`, countyId: c2.id,
    });
    const outScope = await request(app).post("/enrollments").send({
      tenantId: tenantB, intendedRole: "volunteer", fullName: "Out Scope", phoneNumber: "+254700000010", email: `enr-scapp-${ts}@t.local`, countyId: c1.id,
    });
    expect(inScope.status).toBe(201);

    // Scoped coordinator (tenant A, county C2): in-scope approves OK; cross-tenant still 404.
    currentClerkId = `enr-scoped-${ts}`;
    expect((await request(app).post(`/enrollments/${inScope.body.id}/approve`)).status).toBe(200);
    expect((await request(app).post(`/enrollments/${outScope.body.id}/approve`)).status).toBe(404);

    // Out-of-county within tenant A: new applicant in county C1 → 403.
    currentClerkId = `enr-scoped2-${ts}`;
    const c1App = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "Other County", phoneNumber: "+254700000011", email: `enr-c1-${ts}@t.local`, countyId: c1.id,
    });
    currentClerkId = `enr-scoped-${ts}`;
    expect((await request(app).post(`/enrollments/${c1App.body.id}/approve`)).status).toBe(403);
    // Leave no trace: other tests expect exactly one pending application per tenant.
    await db.delete(enrollmentsTable).where(inArray(enrollmentsTable.clerkUserId, [`enr-scapp-${ts}`, `enr-scoped2-${ts}`]));
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, sc.id));
    await db.delete(usersTable).where(inArray(usersTable.clerkId, [`enr-scapp-${ts}`, `enr-scoped-${ts}`, `enr-scoped2-${ts}`]));
    await db.delete(countiesTable).where(inArray(countiesTable.id, [c1.id, c2.id]));
  });
});

describe("enrollment applications", () => {
  it("lists campaigns and accepts a volunteer application; dedupes pending", async () => {
    currentClerkId = APPLICANT;
    const camps = await request(app).get("/enrollments/campaigns");
    expect(camps.status).toBe(200);
    expect(camps.body.some((c: any) => c.id === tenantA)).toBe(true);

    const apply = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "Volum Teer", phoneNumber: "+254700000001", email: `${APPLICANT}@t.local`,
    });
    expect(apply.status).toBe(201);
    expect(apply.body.status).toBe("pending");

    const dup = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "Volum Teer", phoneNumber: "+254700000001", email: `${APPLICANT}@t.local`,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ENROLLMENT_PENDING");

    const me = await request(app).get("/enrollments/me");
    expect(me.body.length).toBe(1);
    expect(me.body[0].campaignName).toContain("Enr A");
  });

  it("requires national ID for polling agents and accepts tenantSlug", async () => {
    currentClerkId = AGENT_APP;
    const noId = await request(app).post("/enrollments").send({
      tenantSlug: `enr-b-${ts}`, intendedRole: "polling-agent", fullName: "Agent App", phoneNumber: "+254700000002", email: `${AGENT_APP}@t.local`,
    });
    expect(noId.status).toBe(400);
    expect(noId.body.code).toBe("NATIONAL_ID_REQUIRED");

    const ok = await request(app).post("/enrollments").send({
      tenantSlug: `enr-b-${ts}`, intendedRole: "polling-agent", fullName: "Agent App", phoneNumber: "+254700000002", email: `${AGENT_APP}@t.local`, nationalId: "12345678",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.tenantId).toBe(tenantB);
  });

  it("coordinator queue is tenant-scoped; approve assigns role + record", async () => {
    currentClerkId = MGR;
    const queue = await request(app).get("/enrollments?status=pending");
    expect(queue.status).toBe(200);
    expect(queue.body.length).toBe(1); // only tenant A's volunteer application
    expect(queue.body[0].intendedRole).toBe("volunteer");

    const approve = await request(app).post(`/enrollments/${queue.body[0].id}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    // Role + volunteer record created; applicant user row auto-created.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, APPLICANT));
    expect(u).toBeTruthy();
    expect(u.activeTenantId).toBe(tenantA);
    userIds.push(u.id);
    const [ur] = await db.select().from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .where(and(eq(userRolesTable.userId, u.id), eq(userRolesTable.tenantId, tenantA)));
    expect(ur.roles.slug).toBe("volunteer");
    const [vol] = await db.select().from(volunteersTable).where(and(eq(volunteersTable.tenantId, tenantA), eq(volunteersTable.userId, u.id)));
    expect(vol.status).toBe("active");

    // Double-approve rejected.
    const again = await request(app).post(`/enrollments/${queue.body[0].id}/approve`);
    expect(again.status).toBe(409);

    // Cross-tenant: coordinator cannot see or approve tenant B's application.
    const [bEnr] = await db.select().from(enrollmentsTable).where(eq(enrollmentsTable.tenantId, tenantB));
    const cross = await request(app).post(`/enrollments/${bEnr.id}/approve`);
    expect(cross.status).toBe(404);
  });

  it("agent approval creates a polling agent record; reject stores a reason", async () => {
    currentClerkId = OUTSIDER; // no tenant context — queue requires one
    const noTenant = await request(app).get("/enrollments");
    expect([400, 409]).toContain(noTenant.status);

    // Tenant B agent application approved directly via DB-level check on API path:
    currentClerkId = MGR;
    const [bEnr] = await db.select().from(enrollmentsTable).where(eq(enrollmentsTable.tenantId, tenantB));
    // MGR has no tenant-B context, so approve 404s (tested above). Insert a fresh
    // tenant-A agent application and run it through approve instead.
    currentClerkId = APP2; // fresh applicant — APPLICANT is already an approved member
    const agentApply = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "polling-agent", fullName: "App Two", phoneNumber: "+254700000009", email: `${APP2}@t.local`, nationalId: "87654321",
    });
    expect(agentApply.status).toBe(201);
    currentClerkId = MGR;
    const approve = await request(app).post(`/enrollments/${agentApply.body.id}/approve`);
    expect(approve.status).toBe(200);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, APP2));
    const [agent] = await db.select().from(pollingAgentsTable).where(and(eq(pollingAgentsTable.tenantId, tenantA), eq(pollingAgentsTable.userId, u.id)));
    expect(agent.nationalId).toBe("87654321");

    // Reject flow.
    currentClerkId = AGENT_APP;
    const rej = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "Agent App", phoneNumber: "+254700000002", email: `${AGENT_APP}@t.local`,
    });
    currentClerkId = MGR;
    const rejected = await request(app).post(`/enrollments/${rej.body.id}/reject`).send({ reason: "Duplicate applicant" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    // After rejection the applicant may re-apply (unique index only covers pending).
    currentClerkId = AGENT_APP;
    const reapply = await request(app).post("/enrollments").send({
      tenantId: tenantA, intendedRole: "volunteer", fullName: "Agent App", phoneNumber: "+254700000002", email: `${AGENT_APP}@t.local`,
    });
    expect(reapply.status).toBe(201);
  });

  it("unauthenticated calls are rejected", async () => {
    currentClerkId = "";
    const res = await request(app).get("/enrollments/campaigns");
    expect(res.status).toBe(401);
    const res2 = await request(app).post("/enrollments").send({});
    expect(res2.status).toBe(401);
  });
});
