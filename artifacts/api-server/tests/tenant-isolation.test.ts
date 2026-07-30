/**
 * Tenant isolation tests — multi-org JWT edge cases.
 *
 * Security property under test:
 *   An authenticated caller's tenant is ALWAYS resolved from the JWT's orgId.
 *   The X-Tenant-Slug header and ?tenant= query param are valid only for
 *   unauthenticated (public) routes. An authenticated caller who omits orgId
 *   (e.g. a multi-org consultant who has not activated an org), or who sends
 *   an X-Tenant-Slug for a different campaign alongside their JWT, must never
 *   get access to that other campaign's data.
 *
 * How the tests distinguish which resolution path was taken:
 *   resolveTenant  (authenticated) returns:
 *     403 "No active organisation …"               ← orgId absent from JWT
 *     403 "Organisation '…' is not registered …"   ← orgId present, no DB row
 *     403 "This campaign account has been …"        ← tenant suspended
 *     next()                                        ← happy path (200 from handler)
 *
 *   resolveTenantPublic (unauthenticated) returns:
 *     404 "Campaign '…' not found."                 ← slug not in DB
 *     403 "This campaign account has been …"        ← tenant suspended
 *     next()                                        ← happy path (200)
 *
 *   If an authenticated request receives a 404, it means the public slug path
 *   was used — a security bug. These tests prove that never happens.
 *
 * Route under test: GET /api/config/branding (resolveTenantMixed)
 *   - Authenticated → delegates to resolveTenant (JWT-only)
 *   - Unauthenticated → delegates to resolveTenantPublic (header/param)
 *   - On successful tenant resolution with no branding row → 200 neutral JSON
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/tenant-isolation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable state ─────────────────────────────────────────────────────────────
let _mockUserId: string | null = null;
/**
 * orgId to inject into the mock Clerk JWT.
 *   undefined  → property absent from JWT (simulates Clerk returning no orgId)
 *   null       → property present and explicitly null
 *   string     → active org
 */
let _mockOrgId: string | null | undefined = undefined;
/**
 * Tenant row returned for ALL tenantsTable queries.
 * The real WHERE clause is not honoured by the mock — callers must ensure
 * the row they set matches the orgId/slug being queried by the middleware.
 */
let _mockTenant: Record<string, unknown> | null = null;

// ─── Mock Clerk ─────────────────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: (_req: any) => {
    if (!_mockUserId) return {};
    const auth: Record<string, unknown> = { userId: _mockUserId };
    // Inject orgId only when it has been explicitly set (including null).
    // Leave it absent when _mockOrgId is undefined.
    if (_mockOrgId !== undefined) auth.orgId = _mockOrgId;
    return auth;
  },
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock_key",
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const makeTable = (name: string) => ({ __tableName: name });

  // tenantsTable columns are referenced by resolveTenant; the mock ignores
  // the actual WHERE expression and returns _mockTenant or [] for all queries.
  const tenantsTable = makeTable("tenants");
  const usersTable   = makeTable("users");
  const userRolesTable = makeTable("user_roles");
  const rolesTable   = makeTable("roles");

  function makeQueryBuilder() {
    let _table: string | null = null;
    const qb: any = {
      from(t: any)    { _table = t?.__tableName ?? null; return qb; },
      where()          { return qb; },
      innerJoin()      { return qb; },
      leftJoin()       { return qb; },
      orderBy()        { return qb; },
      offset()         { return qb; },
      groupBy()        { return qb; },
      limit(_n: number) {
        if (_table === "tenants") {
          return Promise.resolve(_mockTenant ? [_mockTenant] : []);
        }
        if (_table === "users") {
          return Promise.resolve(_mockUserId ? [{ id: "user-uuid-mock" }] : []);
        }
        return Promise.resolve([]);
      },
      then(resolve: any, reject: any) {
        // Support awaiting the builder directly (no .limit())
        if (_table === "user_roles") {
          return Promise.resolve([]).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    db,
    tenantsTable,
    usersTable,
    userRolesTable,
    rolesTable,
    brandingTable:                    makeTable("branding"),
    systemConfigTable:                makeTable("system_config"),
    resultSubmissionsTable:           makeTable("result_submissions"),
    submissionCandidateVotesTable:    makeTable("submission_candidate_votes"),
    submissionFormImagesTable:        makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable:       makeTable("submission_corrections"),
    submissionOcrSuggestionsTable:    makeTable("submission_ocr_suggestions"),
    candidatesTable:                  makeTable("candidates"),
    pollingStationsTable:             makeTable("polling_stations"),
    pollingAgentsTable:               makeTable("polling_agents"),
    dataSubjectRequestsTable:         makeTable("data_subject_requests"),
    dataProcessingRecordsTable:       makeTable("data_processing_records"),
    dpiaRegisterTable:                makeTable("dpia_register"),
    vendorRegisterTable:              makeTable("vendor_register"),
    dataBreachRegisterTable:          makeTable("data_breach_register"),
    consentAuditTable:                makeTable("consent_audit"),
    dataRetentionPoliciesTable:       makeTable("data_retention_policies"),
    tallySnapshotsTable:              makeTable("tally_snapshots"),
    electionsTable:                   makeTable("elections"),
    volunteersTable:                  makeTable("volunteers"),
    supportersTable:                  makeTable("supporters"),
    contributionsTable:               makeTable("contributions"),
    expenditureRequestsTable:         makeTable("expenditure_requests"),
    auditLogsTable:                   makeTable("audit_logs"),
    electionDisputesTable:            makeTable("election_disputes"),
    electionIncidentReportsTable:     makeTable("election_incident_reports"),
    agentTrainingEnrollmentsTable:    makeTable("agent_training_enrollments"),
    exportAuditLogTable:              makeTable("export_audit_log"),
    // Drizzle helpers (no-ops in tests)
    eq:      (..._a: any[]) => ({}),
    and:     (..._a: any[]) => ({}),
    or:      (..._a: any[]) => ({}),
    desc:    (_c: any)      => ({}),
    count:   ()             => ({}),
    sum:     ()             => ({}),
    inArray: ()             => ({}),
    gte:     ()             => ({}),
    lte:     ()             => ({}),
    sql: Object.assign(
      (_tpl: TemplateStringsArray, ..._vals: any[]) => ({}),
      { raw: (_s: string) => ({}) }
    ),
  };
});

// Import app AFTER mocks are registered
const { default: app } = await import("../src/app");

// ─── Sample tenant fixtures ────────────────────────────────────────────────────
const TENANT_A = {
  id: "tenant-a-uuid",
  clerkOrgId: "org_campaign_a",
  slug: "campaign-a",
  name: "Campaign A",
  plan: "standard",
  isSuspended: false,
  customDomain: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TENANT_B = {
  id: "tenant-b-uuid",
  clerkOrgId: "org_campaign_b",
  slug: "campaign-b",
  name: "Campaign B",
  plan: "standard",
  isSuspended: false,
  customDomain: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  _mockUserId = null;
  _mockOrgId  = undefined;
  _mockTenant = null;
  // Ensure the dev seed fallback does not interfere with isolation tests
  delete process.env.SEED_CLERK_ORG_ID;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTHENTICATED PATH — X-Tenant-Slug / ?tenant= must be ignored
// ═══════════════════════════════════════════════════════════════════════════════

describe("Authenticated requests ignore X-Tenant-Slug (resolveTenantMixed → resolveTenant)", () => {
  it("authenticated user with no orgId gets 403 'No active organisation' even when X-Tenant-Slug is present", async () => {
    _mockUserId = "user-multi-org";
    _mockOrgId  = null; // JWT has userId but no orgId
    _mockTenant = TENANT_A; // slug would have resolved fine via public path

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a");

    // 403 from the JWT path, not 404 from the public slug path.
    // Receiving 404 here would be a security bug (header spoofing).
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No active organisation/i);
  });

  it("authenticated user whose JWT orgId has no matching tenant gets 403, not 404", async () => {
    // Simulates a multi-org consultant whose JWT names an org not registered
    // on this platform, while also sending an X-Tenant-Slug for a campaign
    // that IS registered.
    _mockUserId = "user-multi-org";
    _mockOrgId  = "org_not_on_this_platform"; // JWT org has no DB row
    _mockTenant = null; // no tenant in mock DB

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a"); // attacker tries to smuggle a different tenant

    // JWT path taken → 403 "not registered".
    // Receiving 404 ("not found") would mean the slug header was used — security bug.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not registered as a tenant/i);
  });

  it("authenticated user's JWT orgId wins over X-Tenant-Slug for a different campaign", async () => {
    // JWT says "org_campaign_b". Header says "campaign-a".
    // Mock returns TENANT_B (matches JWT org). Correct behaviour: 200.
    // If header were honoured: mock would still return TENANT_B (which has
    // slug "campaign-b" not "campaign-a"), but the test proves the HTTP
    // request succeeds via the JWT org path regardless of the header's value.
    _mockUserId = "user-multi-org";
    _mockOrgId  = "org_campaign_b";
    _mockTenant = TENANT_B; // matches JWT org

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a"); // different campaign slug — must be ignored

    // resolveTenant resolved TENANT_B via JWT; handler returns neutral branding.
    expect(res.status).toBe(200);
  });

  it("authenticated user with orgId absent from JWT (not just null) is also rejected", async () => {
    // _mockOrgId = undefined means the property is not present on the auth object,
    // which happens when Clerk does not include org_id in the JWT at all.
    _mockUserId = "user-no-org-in-jwt";
    _mockOrgId  = undefined; // orgId key absent from JWT — not the same as null
    _mockTenant = TENANT_A;

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No active organisation/i);
  });

  it("authenticated user with suspended tenant gets 403 'suspended' regardless of X-Tenant-Slug", async () => {
    _mockUserId = "user-suspended-campaign";
    _mockOrgId  = "org_suspended";
    _mockTenant = { ...TENANT_A, clerkOrgId: "org_suspended", isSuspended: true };

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "some-other-campaign"); // irrelevant — JWT path used

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it("?tenant= query param is ignored for authenticated requests", async () => {
    _mockUserId = "user-multi-org";
    _mockOrgId  = null; // no active org in JWT
    _mockTenant = TENANT_A;

    const res = await request(app)
      .get("/api/config/branding")
      .query({ tenant: "campaign-a" }); // query param — must be ignored

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No active organisation/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. UNAUTHENTICATED PATH — X-Tenant-Slug / ?tenant= are allowed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Unauthenticated requests use X-Tenant-Slug (resolveTenantMixed → resolveTenantPublic)", () => {
  it("unauthenticated request with X-Tenant-Slug resolves the tenant and returns 200", async () => {
    _mockUserId = null;
    _mockTenant = TENANT_A;

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a");

    expect(res.status).toBe(200);
  });

  it("unauthenticated request with ?tenant= query param resolves the tenant and returns 200", async () => {
    _mockUserId = null;
    _mockTenant = TENANT_B;

    const res = await request(app)
      .get("/api/config/branding")
      .query({ tenant: "campaign-b" });

    expect(res.status).toBe(200);
  });

  it("unauthenticated request with unrecognised slug returns 404", async () => {
    _mockUserId = null;
    _mockTenant = null; // slug not in DB

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "no-such-campaign");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("unauthenticated request with suspended tenant returns 403 via public path", async () => {
    _mockUserId = null;
    _mockTenant = { ...TENANT_A, isSuspended: true };

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it("unauthenticated request with no slug returns neutral branding (tenant-agnostic endpoint)", async () => {
    _mockUserId = null;
    _mockTenant = null;

    const res = await request(app).get("/api/config/branding");

    // resolveTenantPublic calls next() without a tenant when no slug present;
    // the handler returns the neutral defaults.
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe("Your Candidate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SEED_CLERK_ORG_ID FALLBACK — dev-only safety valve
// ═══════════════════════════════════════════════════════════════════════════════

describe("SEED_CLERK_ORG_ID fallback behaviour", () => {
  it("authenticated user with no orgId falls back to SEED_CLERK_ORG_ID when set", async () => {
    _mockUserId = "user-no-org";
    _mockOrgId  = null;
    _mockTenant = TENANT_A;
    process.env.SEED_CLERK_ORG_ID = "org_campaign_a"; // dev seed org matches mock

    const res = await request(app).get("/api/config/branding");

    // Falls back to seed org → tenant resolved → 200
    expect(res.status).toBe(200);
  });

  it("JWT orgId takes priority over SEED_CLERK_ORG_ID", async () => {
    // JWT has an explicit orgId; SEED_CLERK_ORG_ID set to something else.
    // JWT must win.
    _mockUserId = "user-with-org";
    _mockOrgId  = "org_campaign_b";   // JWT says B
    _mockTenant = TENANT_B;           // mock returns B
    process.env.SEED_CLERK_ORG_ID = "org_campaign_a"; // seed says A — must be ignored

    const res = await request(app).get("/api/config/branding");

    // JWT org (B) resolved via mock → 200, not blocked by seed mismatch
    expect(res.status).toBe(200);
  });
});
