/**
 * Tenant isolation tests — membership-based resolution edge cases.
 *
 * Security property under test:
 *   An authenticated caller's tenant is ALWAYS resolved from their app-owned
 *   membership (user_roles) plus the campaign they explicitly entered — never
 *   from the X-Tenant-Slug header, the ?tenant= query param, a JWT org id, or
 *   the legacy SEED_CLERK_ORG_ID env var. Those are valid only for
 *   unauthenticated (public) routes. An authenticated caller with no matching
 *   membership must never get access to another campaign's data.
 *
 * How the tests distinguish which resolution path was taken:
 *   resolveTenant  (authenticated) returns:
 *     403 "You don't belong to a campaign yet …"   ← no memberships
 *     403 "This campaign account has been …"        ← tenant suspended
 *     200 neutral branding                          ← several memberships, none entered
 *     200 tenant branding                           ← happy path
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
 *   - Authenticated → delegates to resolveTenant (membership-only)
 *   - Unauthenticated → delegates to resolveTenantPublic (header/param)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/tenant-isolation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable state ─────────────────────────────────────────────────────────────
let _mockUserId: string | null = null;
/** Extra JWT claims to inject (e.g. orgId — to prove it is now ignored). */
let _mockAuthExtras: Record<string, unknown> = {};
/** Local users row for the caller. */
let _mockUserRow: {
  id: string;
  isGlobalAdmin: boolean;
  activeTenantId: string | null;
} | null = null;
/** Campaign ids the caller belongs to via user_roles. */
let _mockMembershipTenantIds: string[] = [];
/**
 * Tenant row returned for ALL tenantsTable queries.
 * The real WHERE clause is not honoured by the mock — callers must ensure
 * the row they set matches the tenant the middleware should resolve.
 */
let _mockTenant: Record<string, unknown> | null = null;

// ─── Mock Clerk ─────────────────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: (_req: any) => {
    if (!_mockUserId) return {};
    return { userId: _mockUserId, ..._mockAuthExtras };
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
          return Promise.resolve(_mockUserRow ? [_mockUserRow] : []);
        }
        return Promise.resolve([]);
      },
      then(resolve: any, reject: any) {
        // Support awaiting the builder directly (no .limit())
        if (_table === "user_roles") {
          return Promise.resolve(
            _mockMembershipTenantIds.map((tenantId) => ({ tenantId })),
          ).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),
    selectDistinct: (_fields?: unknown) => makeQueryBuilder(),
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
  slug: "campaign-b",
  name: "Campaign B",
  plan: "standard",
  isSuspended: false,
  customDomain: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MEMBER = { id: "user-uuid-member", isGlobalAdmin: false, activeTenantId: null };

beforeEach(() => {
  _mockUserId = null;
  _mockAuthExtras = {};
  _mockUserRow = null;
  _mockMembershipTenantIds = [];
  _mockTenant = null;
  // The legacy seed-org bypass is removed; keep the var unset unless a test
  // explicitly proves it no longer grants access.
  delete process.env.SEED_CLERK_ORG_ID;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTHENTICATED PATH — membership only; headers, params and JWT orgs ignored
// ═══════════════════════════════════════════════════════════════════════════════

describe("Authenticated requests resolve tenant from membership only", () => {
  it("member of no campaign gets 403 'don't belong' even when X-Tenant-Slug is present", async () => {
    _mockUserId = "user-no-campaign";
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = [];
    _mockTenant = TENANT_A; // slug would have resolved fine via the public path

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-a");

    // 403 from the membership path, not 404 from the public slug path.
    // Receiving 404 here would be a security bug (header spoofing).
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("single membership resolves that campaign; X-Tenant-Slug is ignored", async () => {
    _mockUserId = "user-member-a";
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = ["tenant-a-uuid"];
    _mockTenant = TENANT_A;

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "campaign-b"); // different campaign — must be ignored

    expect(res.status).toBe(200);
  });

  it("a JWT org id is ignored — membership is the only tenant source", async () => {
    // Regression guard: tokens once carried the tenant via orgId. A token
    // naming an org must now mean NOTHING — only user_roles decides.
    _mockUserId = "user-member-a";
    _mockAuthExtras = { orgId: "org_attacker_controlled" };
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = ["tenant-a-uuid"];
    _mockTenant = TENANT_A;

    const res = await request(app).get("/api/config/branding");

    // Resolved via membership (200), not rejected for an unregistered org.
    expect(res.status).toBe(200);
  });

  it("a JWT org id does not help a caller with no memberships", async () => {
    _mockUserId = "user-no-campaign";
    _mockAuthExtras = { orgId: "org_campaign_a" };
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = [];
    _mockTenant = TENANT_A;

    const res = await request(app).get("/api/config/branding");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("member of a suspended campaign gets 403 'suspended'", async () => {
    _mockUserId = "user-suspended-campaign";
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = ["tenant-a-uuid"];
    _mockTenant = { ...TENANT_A, isSuspended: true };

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "some-other-campaign"); // irrelevant — membership path used

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it("?tenant= query param is ignored for authenticated requests", async () => {
    _mockUserId = "user-no-campaign";
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = [];
    _mockTenant = TENANT_A;

    const res = await request(app)
      .get("/api/config/branding")
      .query({ tenant: "campaign-a" }); // query param — must be ignored

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("member of several campaigns who has entered none gets NEUTRAL branding — no arbitrary pick", async () => {
    _mockUserId = "user-multi-campaign";
    _mockUserRow = MEMBER; // activeTenantId null
    _mockMembershipTenantIds = ["tenant-a-uuid", "tenant-b-uuid"];
    _mockTenant = TENANT_A; // must NOT be picked automatically

    const res = await request(app).get("/api/config/branding");

    // No tenant context → neutral defaults, not tenant A's data.
    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(false);
    expect(res.body.candidateName).toBe("Your Candidate");
  });

  it("SEED_CLERK_ORG_ID no longer grants access (legacy bypass removed)", async () => {
    // The dev-only fallback used to resolve a tenant for any authenticated
    // caller with no org. Setting it must now make no difference whatsoever.
    process.env.SEED_CLERK_ORG_ID = "org_campaign_a";
    _mockUserId = "user-no-campaign";
    _mockUserRow = MEMBER;
    _mockMembershipTenantIds = [];
    _mockTenant = TENANT_A;

    const res = await request(app).get("/api/config/branding");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("platform operator with an entered campaign resolves it without any membership", async () => {
    _mockUserId = "user-operator";
    _mockUserRow = { id: "user-uuid-operator", isGlobalAdmin: true, activeTenantId: "tenant-a-uuid" };
    _mockMembershipTenantIds = []; // operators hold no memberships, ever
    _mockTenant = TENANT_A;

    const res = await request(app).get("/api/config/branding");

    expect(res.status).toBe(200);
  });

  it("platform operator with no entered campaign gets neutral branding, not a guessed tenant", async () => {
    _mockUserId = "user-operator";
    _mockUserRow = { id: "user-uuid-operator", isGlobalAdmin: true, activeTenantId: null };
    _mockMembershipTenantIds = [];
    _mockTenant = TENANT_A; // must NOT be attached for them

    const res = await request(app).get("/api/config/branding");

    expect(res.status).toBe(200);
    expect(res.body.isTenant).toBe(false);
    expect(res.body.candidateName).toBe("Your Candidate");
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
