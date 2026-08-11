/**
 * Tenant integration provisioning — M-PESA & WhatsApp credentials.
 * Verifies: masked reads (secrets never returned), encryption at rest,
 * upsert/rotate, disconnect, tenant isolation.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/integrations.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "int-none";
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

import { db } from "@workspace/db";
import { tenantsTable, usersTable, userRolesTable, rolesTable, tenantMpesaConfigsTable, tenantWhatsappConfigsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import { decryptSecret } from "../src/lib/mpesa";
import integrationsRouter from "../src/routes/integrations";

const ts = randomUUID().slice(0, 8);
const ADMIN = `int-admin-${ts}`;
let tenantA: string, tenantB: string;
let app: express.Express;

beforeAll(async () => {
  const [ta] = await db.insert(tenantsTable).values({ name: `Int A ${ts}`, slug: `int-a-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  const [tb] = await db.insert(tenantsTable).values({ name: `Int B ${ts}`, slug: `int-b-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  tenantA = ta.id; tenantB = tb.id;
  // Tenant context comes from user_roles membership — the admin needs one.
  let [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, "super-admin")).limit(1);
  if (!role) [role] = await db.insert(rolesTable).values({ slug: "super-admin", name: "super-admin", level: 1 } as any).returning();
  const [admin] = await db.insert(usersTable).values({ clerkId: ADMIN, email: `${ADMIN}@t.local`, fullName: ADMIN, status: "active", isGlobalAdmin: false, activeTenantId: tenantA } as any).returning();
  await db.insert(userRolesTable).values({ userId: admin.id, roleId: role.id, tenantId: tenantA } as any);

  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/integrations", integrationsRouter);
});

afterAll(async () => {
  await db.delete(tenantMpesaConfigsTable).where(inArray(tenantMpesaConfigsTable.tenantId, [tenantA, tenantB]));
  await db.delete(tenantWhatsappConfigsTable).where(inArray(tenantWhatsappConfigsTable.tenantId, [tenantA, tenantB]));
  await db.delete(userRolesTable).where(inArray(userRolesTable.tenantId, [tenantA, tenantB]));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [ADMIN, `int-b-${ts}`]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
});

describe("integration provisioning", () => {
  it("starts unconfigured; provisioning M-PESA encrypts secrets at rest", async () => {
    currentClerkId = ADMIN;
    const empty = await request(app).get("/integrations/");
    expect(empty.body.mpesa.configured).toBe(false);

    const put = await request(app).put("/integrations/mpesa").send({
      shortcode: "600123", consumerKey: "ck-test-12345", consumerSecret: "cs-test-secret", passkey: "pk-test-passkey", environment: "sandbox",
    });
    expect(put.status).toBe(200);
    expect(put.body.configured).toBe(true);

    // At rest: ciphertext, not plaintext.
    const [row] = await db.select().from(tenantMpesaConfigsTable).where(eq(tenantMpesaConfigsTable.tenantId, tenantA));
    expect(row.consumerSecret).not.toBe("cs-test-secret");
    expect(row.passkey).not.toBe("pk-test-passkey");
    expect(decryptSecret(row.consumerSecret)).toBe("cs-test-secret");
    expect(decryptSecret(row.passkey)).toBe("pk-test-passkey");

    // Read back: no secrets, consumer key masked.
    const after = await request(app).get("/integrations/");
    expect(after.body.mpesa.configured).toBe(true);
    expect(after.body.mpesa.shortcode).toBe("600123");
    expect(after.body.mpesa.consumerKey).toBe("…2345");
    expect(JSON.stringify(after.body)).not.toContain("cs-test-secret");
    expect(JSON.stringify(after.body)).not.toContain("pk-test-passkey");
  });

  it("rotating credentials overwrites the row (one config per tenant)", async () => {
    currentClerkId = ADMIN;
    await request(app).put("/integrations/mpesa").send({
      shortcode: "600999", consumerKey: "ck-rotated-99", consumerSecret: "cs-rotated", passkey: "pk-rotated", environment: "production",
    });
    const rows = await db.select().from(tenantMpesaConfigsTable).where(eq(tenantMpesaConfigsTable.tenantId, tenantA));
    expect(rows.length).toBe(1);
    expect(rows[0].shortcode).toBe("600999");
    expect(decryptSecret(rows[0].consumerSecret)).toBe("cs-rotated");
  });

  it("provisions WhatsApp, mirrors sender identity onto the tenant, and masks the token", async () => {
    currentClerkId = ADMIN;
    const put = await request(app).put("/integrations/whatsapp").send({
      phoneNumberId: "109876543210", businessAccountId: "555000111", accessToken: "EAAG-super-secret-token-123456",
    });
    expect(put.status).toBe(200);

    const [row] = await db.select().from(tenantWhatsappConfigsTable).where(eq(tenantWhatsappConfigsTable.tenantId, tenantA));
    expect(row.accessToken).not.toContain("EAAG");
    expect(decryptSecret(row.accessToken)).toBe("EAAG-super-secret-token-123456");

    const [tenant] = await db.select({ pnid: tenantsTable.whatsappPhoneNumberId }).from(tenantsTable).where(eq(tenantsTable.id, tenantA));
    expect(tenant.pnid).toBe("109876543210");

    const after = await request(app).get("/integrations/");
    expect(after.body.whatsapp.configured).toBe(true);
    expect(JSON.stringify(after.body)).not.toContain("EAAG");
  });

  it("rejects invalid payloads and isolates tenants", async () => {
    currentClerkId = ADMIN;
    const bad = await request(app).put("/integrations/mpesa").send({ shortcode: "abc", consumerKey: "x", consumerSecret: "x", passkey: "x", environment: "live" });
    expect(bad.status).toBe(400);

    // Tenant B has no configs and cannot see tenant A's.
    const [bAdmin] = await db.insert(usersTable).values({ clerkId: `int-b-${ts}`, email: `int-b-${ts}@t.local`, fullName: "B", status: "active", isGlobalAdmin: false, activeTenantId: tenantB } as any).returning();
    const [bRole] = await db.select().from(rolesTable).where(eq(rolesTable.slug, "super-admin")).limit(1);
    await db.insert(userRolesTable).values({ userId: bAdmin.id, roleId: bRole.id, tenantId: tenantB } as any);
    currentClerkId = `int-b-${ts}`;
    const bView = await request(app).get("/integrations/");
    expect(bView.body.mpesa.configured).toBe(false);
    expect(bView.body.whatsapp.configured).toBe(false);
    await db.delete(usersTable).where(eq(usersTable.id, bAdmin.id));
  });

  it("disconnect removes the config and clears the tenant sender identity", async () => {
    currentClerkId = ADMIN;
    const del = await request(app).delete("/integrations/whatsapp");
    expect(del.status).toBe(200);
    const [gone] = await db.select().from(tenantWhatsappConfigsTable).where(eq(tenantWhatsappConfigsTable.tenantId, tenantA));
    expect(gone).toBeUndefined();
    const [tenant] = await db.select({ pnid: tenantsTable.whatsappPhoneNumberId }).from(tenantsTable).where(eq(tenantsTable.id, tenantA));
    expect(tenant.pnid).toBeNull();
    const unknown = await request(app).delete("/integrations/pigeon");
    expect(unknown.status).toBe(404);
  });
});
