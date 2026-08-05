/**
 * Per-tenant M-Pesa configuration.
 *
 * A tenant with a row in tenant_mpesa_configs must get a Live adapter with
 * its OWN shortcode/credentials (secrets decrypted at read); tenants without
 * a row fall back to the env/sandbox adapter. The stk-push route must resolve
 * the adapter per request (not one shared module-level adapter).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/mpesa-tenant-config.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "mpesa-config-clerk" }),
}));

vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));

import { db } from "@workspace/db";
import {
  tenantsTable,
  tenantMpesaConfigsTable,
  mpesaTransactionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createMpesaAdapterForTenant,
  encryptSecret,
  decryptSecret,
  LiveMpesaAdapter,
  SandboxMpesaAdapter,
} from "../src/lib/mpesa";
import financeRouter from "../src/routes/finance";

const SLUG = `mpesa-cfg-${randomUUID().slice(0, 8)}`;
let configuredTenantId: string;
let plainTenantId: string;

beforeAll(async () => {
  // Guarantee the env fallback resolves to the sandbox adapter.
  delete process.env.MPESA_CONSUMER_KEY;
  delete process.env.MPESA_CONSUMER_SECRET;

  const [configured] = await db
    .insert(tenantsTable)
    .values({ name: "Configured Tenant", slug: `${SLUG}-a` })
    .returning();
  configuredTenantId = configured.id;

  const [plain] = await db
    .insert(tenantsTable)
    .values({ name: "Plain Tenant", slug: `${SLUG}-b` })
    .returning();
  plainTenantId = plain.id;

  await db.insert(tenantMpesaConfigsTable).values({
    tenantId: configuredTenantId,
    shortcode: "600999",
    consumerKey: "cfg-consumer-key",
    consumerSecret: encryptSecret("cfg-consumer-secret"),
    passkey: encryptSecret("cfg-passkey"),
    environment: "sandbox",
  });
});

afterAll(async () => {
  // Tenant cascade removes configs and M-Pesa transactions.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, configuredTenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, plainTenantId));
});

describe("credential encryption", () => {
  it("round-trips secrets and tolerates plaintext rows", () => {
    const enc = encryptSecret("top-secret-value");
    expect(enc).not.toContain("top-secret-value");
    expect(decryptSecret(enc)).toBe("top-secret-value");
    // Plaintext-seeded row (ops escape hatch) is read as-is.
    expect(decryptSecret("plaintext-secret")).toBe("plaintext-secret");
  });
});

describe("tenant-aware adapter factory", () => {
  it("uses the tenant's own config when a row exists", async () => {
    const adapter = await createMpesaAdapterForTenant(configuredTenantId);
    expect(adapter).toBeInstanceOf(LiveMpesaAdapter);
    expect((adapter as LiveMpesaAdapter).shortcode).toBe("600999");
    expect((adapter as LiveMpesaAdapter).environment).toBe("sandbox");
  });

  it("falls back to the sandbox adapter for tenants without a row", async () => {
    expect(await createMpesaAdapterForTenant(plainTenantId)).toBeInstanceOf(SandboxMpesaAdapter);
    expect(await createMpesaAdapterForTenant(undefined)).toBeInstanceOf(SandboxMpesaAdapter);
  });
});

describe("production fail-closed behaviour", () => {
  const saved: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) setEnv(key, value);
    for (const key of Object.keys(saved)) delete saved[key];
  };

  it("refuses the env fallback for an unconfigured tenant in production", async () => {
    try {
      setEnv("NODE_ENV", "production");
      // Even with LIVE platform env credentials present, an unconfigured
      // tenant must NOT be routed through them.
      setEnv("MPESA_CONSUMER_KEY", "live-platform-key");
      setEnv("MPESA_CONSUMER_SECRET", "live-platform-secret");

      const adapter = await createMpesaAdapterForTenant(plainTenantId);
      const res = await adapter.initiateStkPush({
        phoneNumber: "254712345678",
        amount: 100,
        accountReference: "REF",
        transactionDesc: "Test",
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not yet set up/i);
    } finally {
      restoreEnv();
    }
  });

  it("refuses a plaintext-seeded config row in production", async () => {
    try {
      setEnv("NODE_ENV", "production");
      await db.insert(tenantMpesaConfigsTable).values({
        tenantId: plainTenantId,
        shortcode: "600111",
        consumerKey: "plain-key",
        consumerSecret: "plaintext-secret", // no v1: prefix
        passkey: "plaintext-passkey",
        environment: "sandbox",
      });

      const adapter = await createMpesaAdapterForTenant(plainTenantId);
      const res = await adapter.initiateStkPush({
        phoneNumber: "254712345678",
        amount: 100,
        accountReference: "REF",
        transactionDesc: "Test",
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/temporarily unavailable/i);
    } finally {
      restoreEnv();
      await db.delete(tenantMpesaConfigsTable).where(eq(tenantMpesaConfigsTable.tenantId, plainTenantId));
    }
  });
});

describe("stk-push resolves the adapter per request", () => {
  it("persists the transaction against the resolved tenant", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.tenant = { id: plainTenantId };
      next();
    });
    app.use("/", financeRouter);

    const res = await request(app).post("/mpesa/stk-push").send({
      phoneNumber: "254712345678",
      amount: 100,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [txn] = await db
      .select()
      .from(mpesaTransactionsTable)
      .where(eq(mpesaTransactionsTable.checkoutRequestId, res.body.checkoutRequestId))
      .limit(1);
    expect(txn).toBeDefined();
    expect(txn.tenantId).toBe(plainTenantId);
    expect(txn.status).toBe("pending");
  });
});
