/**
 * Public portal URL / slug-resolution tests + DNS CNAME verification tests.
 *
 * What this covers:
 *
 *  Slug rename — public portal URL correctness (Host-header path):
 *   1. Host: <old>.ushindi.app → 200 correct branding BEFORE rename
 *   2. POST /api/settings/domain-requests + PATCH /api/platform/requests/domain/:id
 *      performs the real slug change (same code path as production)
 *   3. Host: <old>.ushindi.app → 404 AFTER rename (old URL must die immediately)
 *   4. Host: <new>.ushindi.app → 200 correct branding AFTER rename
 *   5. X-Forwarded-Host: <old>.ushindi.app → 404 (proxy-header path)
 *   6. X-Forwarded-Host: <new>.ushindi.app → 200 (proxy-header path)
 *
 *  verifyCname unit-level (through the HTTP surface; not exported):
 *   7. Correct CNAME target → PATCH 200
 *   8. Wrong CNAME target   → PATCH 422
 *   9. DNS timeout / error  → fail-safe PATCH 422 (not 500)
 *   10. Trailing-dot CNAME value → normalised → accepted
 *
 *  Integration — PATCH /api/config/domain:
 *   11. 422 + human-readable hint + dnsVerified:false when CNAME is absent
 *   12. Domain NOT persisted to DB when CNAME verification fails
 *
 *  Integration — POST /api/config/domain/check:
 *   13. 400 when no custom domain is configured
 *   14. dnsVerified:false when stored domain loses its CNAME record
 *   15. dnsVerified:true when CNAME is correctly configured
 *   16. dnsVerified:false when CNAME points at the wrong host
 *
 * Strategy:
 *  - PORTAL_DOMAIN is set via process.env BEFORE any app import so the
 *    module-level constant in config.ts and the host-extraction middleware
 *    in app.ts both capture the intended value.
 *  - Public portal branding lookups (slug tests) use unauthenticated requests
 *    with Host: <slug>.ushindi.app — the same path taken by the real portal.
 *    The app middleware extracts the slug from the Host header and writes it to
 *    X-Tenant-Slug; resolveTenantMixed then delegates to resolveTenantPublic
 *    which does the DB lookup by slug.
 *  - The slug rename goes through the real API:
 *      POST /api/settings/domain-requests  (campaign admin)
 *      PATCH /api/platform/requests/domain/:id  (platform admin, requireLevel(0))
 *    The test user is marked isGlobalAdmin = true so requireLevel(0) passes.
 *  - DNS resolution is mocked so tests don't need real CNAME records.
 *  - TLS provisioning is mocked as a no-op.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/config.domain.test.ts
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// ─── Set env FIRST — module-level captures in config.ts and app.ts read this ──
process.env.PORTAL_DOMAIN = "ushindi.app";

// ─── Auth toggle ──────────────────────────────────────────────────────────────
// Public portal (slug) tests need unauthenticated requests so resolveTenantMixed
// delegates to resolveTenantPublic (Host → X-Tenant-Slug → slug DB lookup).
// Admin API calls (slug-change request + approval) need authenticated requests.
const mockAuth = { userId: "user_cfg_domain_test" };
let _asPublic = false; // when true, getAuth returns {} (unauthenticated)

// ─── DNS toggle ───────────────────────────────────────────────────────────────
const dns = {
  records:     ["ushindi.app"] as string[],
  shouldThrow: false,
};

// ─── Mock Clerk BEFORE any app import ─────────────────────────────────────────
vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(
      () => (_req: any, _res: any, next: any) => next(),
    ),
    getAuth: vi.fn((_req: any) => (_asPublic ? {} : mockAuth)),
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

// ─── Mock DNS ─────────────────────────────────────────────────────────────────
vi.mock("dns", () => ({
  promises: {
    resolveCname: vi.fn(async (_hostname: string) => {
      if (dns.shouldThrow) {
        const err: any = new Error("queryA ETIMEOUT");
        err.code = "ETIMEOUT";
        throw err;
      }
      return dns.records;
    }),
  },
}));

// ─── Mock TLS provisioning ────────────────────────────────────────────────────
vi.mock("../src/lib/tlsCert", () => ({
  triggerTlsProvisioning: vi.fn(() => Promise.resolve()),
}));

// ─── App and DB — imported AFTER all mocks and env vars are set ───────────────
import request from "supertest";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  brandingTable,
  domainChangeRequestsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
let tenantId:   string;
let testUserId: string;

const ts       = Date.now();
const SLUG_OLD = `cfg-old-${ts}`;
const SLUG_NEW = `cfg-new-${ts}`;
// Unique domain per run so concurrent CI jobs don't collide
const DOMAIN   = `vote-cfg-${ts}.example.ke`;

beforeAll(async () => {
  // Unexpired paid override so the plan gate on custom-domain routes passes
  const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [t] = await db
    .insert(tenantsTable)
    .values({
      name:              "Domain Config Test Tenant",
      slug:              SLUG_OLD,
      plan:              "pro",
      planOverrideUntil: paidUntil,
    })
    .returning();
  tenantId = t.id;

  // Insert branding so GET /api/config/branding returns real campaign data
  await db.insert(brandingTable).values({
    tenantId,
    campaignName:  "Config Test Campaign",
    candidateName: "Test Candidate",
    positionTitle: "Governor",
    partyName:     "Test Party",
    primaryColor:  "209 88% 50%",
    secondaryColor:"0 0% 8%",
    tagline:       "Config Test Tagline",
    electionYear:  2027,
    electionLevel: "Gubernatorial",
    mpesaPaybill:  "000000",
  });

  // Upsert the test user and set isGlobalAdmin = true so requireLevel(0)
  // (the platform approval route) is satisfied without a separate platform_admin
  // role grant.  isGlobalAdmin bypasses the role table entirely and sets
  // actorLevel = 0 in resolveActor().
  // Use a clerkId-derived email to avoid collisions with other test files
  // that use the same human-readable email string.
  const testEmail = `${mockAuth.userId}@test.local`;
  const [u] = await db
    .insert(usersTable)
    .values({
      clerkId:       mockAuth.userId,
      email:         testEmail,
      fullName:      "Domain Config Tester",
      status:        "active",
      isGlobalAdmin: true,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set:    {
        email:         testEmail,
        isGlobalAdmin: true,
      },
    })
    .returning();
  testUserId = u.id;

  // Enter the test tenant so authenticated routes (resolveTenant) resolve it
  await db
    .update(usersTable)
    .set({ activeTenantId: tenantId })
    .where(eq(usersTable.id, testUserId));

  // Also grant super-admin for requireRoles guards on the config/domain routes
  const [superAdmin] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "super-admin"))
    .limit(1);

  if (superAdmin) {
    await db
      .insert(userRolesTable)
      .values({ userId: testUserId, roleId: superAdmin.id, tenantId })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  // Restore the slug to SLUG_OLD in case a test left it as SLUG_NEW
  await db
    .update(tenantsTable)
    .set({ slug: SLUG_OLD })
    .where(eq(tenantsTable.id, tenantId));

  if (testUserId) {
    // Clear isGlobalAdmin so this shared user doesn't affect other tests
    await db
      .update(usersTable)
      .set({ activeTenantId: null, isGlobalAdmin: false })
      .where(eq(usersTable.id, testUserId));
    await db
      .delete(userRolesTable)
      .where(eq(userRolesTable.userId, testUserId));
  }
  if (tenantId) {
    await db
      .delete(domainChangeRequestsTable)
      .where(eq(domainChangeRequestsTable.tenantId, tenantId));
    await db
      .delete(brandingTable)
      .where(eq(brandingTable.tenantId, tenantId));
    await db
      .update(tenantsTable)
      .set({ customDomain: null })
      .where(eq(tenantsTable.id, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

beforeEach(() => {
  _asPublic       = false;      // authenticated by default
  dns.records     = ["ushindi.app"];
  dns.shouldThrow = false;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Public portal branding lookup via subdomain Host header (unauthenticated). */
function portalBranding(slug: string) {
  _asPublic = true;
  return request(app)
    .get("/api/config/branding")
    .set("Host", `${slug}.ushindi.app`);
}

/** Public portal branding lookup via X-Forwarded-Host (proxy path, unauthenticated). */
function portalBrandingXFH(slug: string) {
  _asPublic = true;
  return request(app)
    .get("/api/config/branding")
    .set("X-Forwarded-Host", `${slug}.ushindi.app`);
}

/** Campaign admin submits a slug change request. Authenticated. */
function submitSlugRequest(newSlug: string) {
  _asPublic = false;
  return request(app)
    .post("/api/settings/domain-requests")
    .set("Content-Type", "application/json")
    .send({ kind: "slug", requestedValue: newSlug });
}

/** Platform admin approves a domain-change request. Authenticated. */
function approveRequest(requestId: string) {
  _asPublic = false;
  return request(app)
    .patch(`/api/platform/requests/domain/${requestId}`)
    .set("Content-Type", "application/json")
    .send({ approve: true });
}

/** Patch custom domain (for CNAME tests). Authenticated. */
function patchDomain(domain: string | null) {
  _asPublic = false;
  return request(app)
    .patch("/api/config/domain")
    .set("Content-Type", "application/json")
    .send({ customDomain: domain });
}

/** Re-check DNS for currently stored domain. Authenticated. */
function checkDomain() {
  _asPublic = false;
  return request(app)
    .post("/api/config/domain/check")
    .set("Content-Type", "application/json")
    .send();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slug rename — public portal URL correctness via Host header
// ═══════════════════════════════════════════════════════════════════════════════

describe("Slug rename — public portal URL always shows the correct campaign", () => {
  it("Host: <old>.ushindi.app resolves to correct branding before rename", async () => {
    const res = await portalBranding(SLUG_OLD);
    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Config Test Campaign");
    expect(res.body.candidateName).toBe("Test Candidate");
    expect(res.body.isTenant).toBe(true);
  });

  it("campaign admin can submit a slug-change request via settings route", async () => {
    const res = await submitSlugRequest(SLUG_NEW);
    expect(res.status).toBe(201);
    expect(res.body.request.kind).toBe("slug");
    expect(res.body.request.requestedValue).toBe(SLUG_NEW);
  });

  it("platform admin approves the slug change via the domain-requests route", async () => {
    // Retrieve the pending request created in the previous test
    const [pending] = await db
      .select({ id: domainChangeRequestsTable.id })
      .from(domainChangeRequestsTable)
      .where(
        and(
          eq(domainChangeRequestsTable.tenantId, tenantId),
          eq(domainChangeRequestsTable.status, "pending"),
        ),
      )
      .limit(1);

    expect(pending, "pending slug-change request must exist").toBeTruthy();

    const res = await approveRequest(pending.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(new RegExp(SLUG_NEW, "i"));
  });

  it("Host: <old>.ushindi.app returns 404 immediately after the slug is renamed", async () => {
    // The slug was changed to SLUG_NEW in the previous test.
    // The DB has no row for SLUG_OLD any more — the old URL must die immediately
    // with no caching or stale data.
    const res = await portalBranding(SLUG_OLD);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("Host: <new>.ushindi.app returns the correct campaign branding after rename", async () => {
    const res = await portalBranding(SLUG_NEW);
    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Config Test Campaign");
    expect(res.body.candidateName).toBe("Test Candidate");
    expect(res.body.isTenant).toBe(true);
  });

  it("X-Forwarded-Host: <old>.ushindi.app returns 404 (proxy path) after rename", async () => {
    // Proxy-header path: Express honours X-Forwarded-Host when trust proxy is set.
    // The middleware extracts the slug from the forwarded host just as it does
    // from the direct Host header, so old proxy URLs must also 404.
    const res = await portalBrandingXFH(SLUG_OLD);
    expect(res.status).toBe(404);
  });

  it("X-Forwarded-Host: <new>.ushindi.app returns correct branding (proxy path)", async () => {
    const res = await portalBrandingXFH(SLUG_NEW);
    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Config Test Campaign");
  });

  it("old URL does not serve a different campaign's data after rename", async () => {
    // The old slug is orphaned.  resolveTenantPublic must return 404 — it must
    // never fall through to neutral branding of a different tenant.
    const res = await portalBranding(SLUG_OLD);
    if (res.status === 200) {
      // If neutral is returned (no tenant found), isTenant must be false and
      // the campaign name must not belong to our tenant.
      expect(res.body.isTenant).toBe(false);
      expect(res.body.campaignName).not.toBe("Config Test Campaign");
    } else {
      expect(res.status).toBe(404);
    }
  });

  afterAll(async () => {
    // Restore SLUG_OLD for the CNAME tests that follow and for afterAll cleanup.
    await db
      .update(tenantsTable)
      .set({ slug: SLUG_OLD })
      .where(eq(tenantsTable.id, tenantId));
    // Clear any pending domain-change requests left by earlier tests
    await db
      .delete(domainChangeRequestsTable)
      .where(eq(domainChangeRequestsTable.tenantId, tenantId));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyCname — correct CNAME target
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyCname — correct CNAME target", () => {
  it("accepts the domain when CNAME points exactly at PORTAL_DOMAIN", async () => {
    dns.records = ["ushindi.app"];

    const res = await patchDomain(DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body.customDomain).toBe(DOMAIN);
    expect(res.body.dnsVerified).toBe(true);
  });

  it("accepts the domain when CNAME points at a subdomain of PORTAL_DOMAIN", async () => {
    dns.records = ["edge.ushindi.app"];

    await patchDomain(null);
    const res = await patchDomain(`vote-sub-${ts}.example.ke`);
    expect(res.status).toBe(200);
    expect(res.body.dnsVerified).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyCname — wrong CNAME target
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyCname — wrong CNAME target", () => {
  it("rejects the domain when CNAME points at a different host", async () => {
    dns.records = ["some-other-host.example.com"];

    await patchDomain(null);
    const res = await patchDomain(`wrong-cname-${ts}.example.ke`);
    expect(res.status).toBe(422);
    expect(res.body.dnsVerified).toBe(false);
    expect(res.body.error).toMatch(/CNAME not yet detected/i);
  });

  it("rejects the domain when the CNAME response is empty", async () => {
    dns.records = [];

    await patchDomain(null);
    const res = await patchDomain(`empty-cname-${ts}.example.ke`);
    expect(res.status).toBe(422);
    expect(res.body.dnsVerified).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyCname — DNS timeout / error (fail-safe)
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyCname — DNS error is fail-safe (no 500 leakage)", () => {
  it("returns 422 when DNS resolution throws (timeout / NXDOMAIN)", async () => {
    dns.shouldThrow = true;

    await patchDomain(null);
    const res = await patchDomain(`timeout-domain-${ts}.example.ke`);

    // verifyCname catches the error and returns false; the route must respond
    // with 422, not 500, so no internal detail leaks to the client.
    expect(res.status).toBe(422);
    expect(res.body.dnsVerified).toBe(false);
    expect(res.body.error).toMatch(/CNAME not yet detected/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyCname — trailing-dot normalisation
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyCname — trailing-dot normalisation", () => {
  it("strips a trailing dot from the CNAME value before comparing", async () => {
    // Authoritative DNS responses often include a trailing dot on the FQDN.
    dns.records = ["ushindi.app."];

    await patchDomain(null);
    const res = await patchDomain(`trailing-dot-${ts}.example.ke`);

    expect(res.status).toBe(200);
    expect(res.body.dnsVerified).toBe(true);
  });

  it("handles a trailing dot on a subdomain CNAME value", async () => {
    dns.records = ["edge.ushindi.app."];

    await patchDomain(null);
    const res = await patchDomain(`trailing-sub-${ts}.example.ke`);

    expect(res.status).toBe(200);
    expect(res.body.dnsVerified).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: PATCH /api/config/domain — 422 when CNAME is absent
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/config/domain — 422 when CNAME is absent", () => {
  it("returns 422 with a human-readable hint when no CNAME record exists", async () => {
    dns.shouldThrow = true;

    await patchDomain(null);
    const domain = `no-cname-${ts}.example.ke`;
    const res = await patchDomain(domain);

    expect(res.status).toBe(422);
    expect(res.body.dnsVerified).toBe(false);
    expect(res.body.error).toMatch(/CNAME not yet detected/i);
    expect(res.body.hint).toMatch(new RegExp(domain));
    expect(res.body.hint).toMatch(/ushindi\.app/i);
  });

  it("does NOT persist the domain to the DB when CNAME verification fails", async () => {
    dns.shouldThrow = true;

    const domain = `unsaved-${ts}.example.ke`;
    await patchDomain(null);
    await patchDomain(domain); // should 422

    const [row] = await db
      .select({ customDomain: tenantsTable.customDomain })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    expect(row?.customDomain).not.toBe(domain);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: POST /api/config/domain/check
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/config/domain/check — live DNS re-check", () => {
  it("returns 400 when no custom domain is configured on the campaign", async () => {
    await patchDomain(null);

    const res = await checkDomain();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no custom domain/i);
  });

  it("returns dnsVerified: false when the stored domain loses its CNAME record", async () => {
    // Save a valid domain (DNS verified)
    dns.records = ["ushindi.app"];
    const domain = `check-test-${ts}.example.ke`;
    await patchDomain(null);
    const saveRes = await patchDomain(domain);
    expect(saveRes.status).toBe(200);

    // Simulate the CNAME being removed (e.g. after a slug rename broke DNS routing)
    dns.shouldThrow = true;

    const checkRes = await checkDomain();
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.dnsVerified).toBe(false);
    expect(checkRes.body.customDomain).toBe(domain);
  });

  it("returns dnsVerified: true when the CNAME is correctly configured", async () => {
    dns.records     = ["ushindi.app"];
    dns.shouldThrow = false;

    const checkRes = await checkDomain();
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.dnsVerified).toBe(true);
  });

  it("returns dnsVerified: false when CNAME points at the wrong host", async () => {
    dns.records     = ["attacker.example.com"];
    dns.shouldThrow = false;

    const checkRes = await checkDomain();
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.dnsVerified).toBe(false);
  });
});
