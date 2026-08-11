/**
 * Integration tests: Global-Admin Tenant Bypass — Unregistered Org Spoofing
 *
 * Security property under test:
 *   resolveTenant uses the DB (isGlobalAdmin flag on the users row) to decide
 *   whether to skip the membership requirement. A caller who presents an orgId
 *   in their JWT that does not match any tenant row must still be denied if they
 *   are not a genuine global admin. The global-admin path is not reachable by
 *   ordinary users regardless of what their JWT claims.
 *
 * Scenarios:
 *   1. Normal user (isGlobalAdmin = false) with no campaign memberships and an
 *      unregistered orgId in their JWT → 403 "don't belong to a campaign yet"
 *   2. Normal user (isGlobalAdmin = false) with no memberships and NO orgId
 *      → same 403 (baseline, proving the JWT claim is irrelevant)
 *   3. Global admin (isGlobalAdmin = true) with no memberships and an
 *      unregistered orgId → NOT 403 (passes resolveTenant; may return other
 *      status codes depending on downstream handler)
 *   4. Global admin (isGlobalAdmin = true) with no memberships and no orgId
 *      → same NOT-403 (confirming membership is not required for operators)
 *
 * Route under test: GET /api/election-results/submissions
 *   Uses requireAuth → resolveTenant → requireRoles so it exercises the full
 *   middleware stack. A 403 from resolveTenant carries "don't belong" text; a
 *   later RBAC 403 carries "Forbidden" text — the tests distinguish them.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/unregistered-org-bypass.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable state (set per test) ─────────────────────────────────────────────
let _mockUserId: string | null = null;
/** Extra JWT claims such as orgId — proves they are irrelevant to the bypass. */
let _mockAuthExtras: Record<string, unknown> = {};
/** Local users row returned for the authenticated Clerk user. */
let _mockUserRow: {
  id: string;
  isGlobalAdmin: boolean;
  activeTenantId: string | null;
} | null = null;
/** Tenant ids the caller holds via user_roles. */
let _mockMembershipTenantIds: string[] = [];
/** Tenant row returned for tenantsTable queries (used when operator has an active tenant). */
let _mockTenant: Record<string, unknown> | null = null;

// ─── Mock Clerk ────────────────────────────────────────────────────────────────
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

  const tenantsTable   = makeTable("tenants");
  const usersTable     = makeTable("users");
  const userRolesTable = makeTable("user_roles");
  const rolesTable     = makeTable("roles");

  function makeQueryBuilder() {
    let _table: string | null = null;
    let _joined = false;

    const qb: any = {
      from(t: any)      { _table = t?.__tableName ?? null; return qb; },
      where()            { return qb; },
      innerJoin()        { _joined = true; return qb; },
      leftJoin()         { return qb; },
      orderBy()          { return qb; },
      offset()           { return qb; },
      groupBy()          { return qb; },
      limit(_n: number) {
        if (_table === "users")   return Promise.resolve(_mockUserRow ? [_mockUserRow] : []);
        if (_table === "tenants") return Promise.resolve(_mockTenant  ? [_mockTenant]  : []);
        return Promise.resolve([]);
      },
      then(resolve: any, reject: any) {
        if (_table === "user_roles") {
          // resolveTenant (no join) → returns membership tenant ids.
          // resolveActor  (with join) → returns role rows; global admins bypass
          // this query so it only runs for regular members. Return empty [] to
          // produce level 999 / no roles — this test only cares about the
          // resolveTenant layer, not downstream RBAC.
          const rows = _joined
            ? []
            : _mockMembershipTenantIds.map((tenantId) => ({ tenantId }));
          return Promise.resolve(rows).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select:         (_fields?: unknown) => makeQueryBuilder(),
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
    eq:      (..._a: any[]) => ({}),
    and:     (..._a: any[]) => ({}),
    or:      (..._a: any[]) => ({}),
    isNull:  (..._a: any[]) => ({}),
    isNotNull: (..._a: any[]) => ({}),
    desc:    (_c: any)      => ({}),
    count:   ()             => ({}),
    sum:     ()             => ({}),
    inArray: ()             => ({}),
    gte:     ()             => ({}),
    lte:     ()             => ({}),
    sql: Object.assign(
      (_tpl: TemplateStringsArray, ..._vals: any[]) => ({}),
      { raw: (_s: string) => ({}) },
    ),
  };
});

// Import app AFTER mocks are registered
const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A regular user row — isGlobalAdmin is false. */
const REGULAR_USER = {
  id: "user-uuid-regular",
  isGlobalAdmin: false,
  activeTenantId: null,
};

/** A global admin row — isGlobalAdmin is true. */
const GLOBAL_ADMIN_USER = {
  id: "user-uuid-global-admin",
  isGlobalAdmin: true,
  activeTenantId: null,
};

/** Protected route: requireAuth → resolveTenant → requireLevel(5) */
const PROTECTED_ROUTE = "/api/election-results/submissions";

beforeEach(() => {
  _mockUserId             = null;
  _mockAuthExtras         = {};
  _mockUserRow            = null;
  _mockMembershipTenantIds = [];
  _mockTenant             = null;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. REGULAR USER — unregistered org must not grant access
// ═══════════════════════════════════════════════════════════════════════════════

describe("Regular user with unregistered org → 403 from resolveTenant", () => {
  it("regular user with no memberships and an unregistered orgId receives 403 'don't belong'", async () => {
    _mockUserId    = "clerk-regular-spoof-org";
    _mockAuthExtras = { orgId: "org_unregistered_attacker_controlled" };
    _mockUserRow   = REGULAR_USER;
    _mockMembershipTenantIds = []; // no campaign memberships

    const res = await request(app).get(PROTECTED_ROUTE);

    expect(res.status).toBe(403);
    // Confirm it's the resolveTenant 403, not a downstream RBAC 403
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("regular user with no memberships and NO orgId receives the same 403 (orgId is irrelevant)", async () => {
    _mockUserId    = "clerk-regular-no-org";
    _mockAuthExtras = {}; // no orgId at all
    _mockUserRow   = REGULAR_USER;
    _mockMembershipTenantIds = [];

    const res = await request(app).get(PROTECTED_ROUTE);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/don't belong to a campaign/i);
  });

  it("regular user with memberships but an unregistered orgId is resolved via membership (not blocked)", async () => {
    // The unregistered org has no effect — membership still determines context.
    _mockUserId    = "clerk-regular-member-with-bad-org";
    _mockAuthExtras = { orgId: "org_something_unrelated" };
    _mockUserRow   = REGULAR_USER;
    _mockMembershipTenantIds = ["tenant-real-uuid"]; // has a real membership
    _mockTenant    = {
      id: "tenant-real-uuid",
      slug: "real-campaign",
      name: "Real Campaign",
      plan: "standard",
      isSuspended: false,
      customDomain: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const res = await request(app).get(PROTECTED_ROUTE);

    // resolveTenant passes; may get RBAC 403 (no roles) or a handler error —
    // the critical guarantee is it is NOT the "don't belong" 403.
    expect(res.body.error ?? "").not.toMatch(/don't belong to a campaign/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GLOBAL ADMIN — bypass works regardless of orgId
// ═══════════════════════════════════════════════════════════════════════════════

describe("Global admin with unregistered org → resolveTenant passes", () => {
  it("global admin with an unregistered orgId is NOT blocked by resolveTenant", async () => {
    _mockUserId    = "clerk-global-admin-unregistered-org";
    _mockAuthExtras = { orgId: "org_unregistered_does_not_matter" };
    _mockUserRow   = GLOBAL_ADMIN_USER;
    _mockMembershipTenantIds = []; // operators hold no memberships

    const res = await request(app).get(PROTECTED_ROUTE);

    // resolveTenant allows through (isGlobalAdmin = true, no membership check).
    // Downstream RBAC grants platform_admin / level 0 to global admins, so
    // this endpoint must also pass RBAC. The handler may return 200 or a 4xx
    // from business logic, but never the "don't belong" or "Forbidden" 403.
    expect(res.status).not.toBe(401);
    expect(res.body.error ?? "").not.toMatch(/don't belong to a campaign/i);
    expect(res.body.error ?? "").not.toMatch(/Forbidden/i);
  });

  it("global admin with no orgId in JWT is also NOT blocked by resolveTenant", async () => {
    _mockUserId    = "clerk-global-admin-no-org";
    _mockAuthExtras = {}; // no orgId
    _mockUserRow   = GLOBAL_ADMIN_USER;
    _mockMembershipTenantIds = [];

    const res = await request(app).get(PROTECTED_ROUTE);

    expect(res.status).not.toBe(401);
    expect(res.body.error ?? "").not.toMatch(/don't belong to a campaign/i);
    expect(res.body.error ?? "").not.toMatch(/Forbidden/i);
  });

  it("global admin with an entered campaign has tenant context without needing a membership", async () => {
    const ENTERED_TENANT = {
      id: "tenant-entered-uuid",
      slug: "entered-campaign",
      name: "Entered Campaign",
      plan: "standard",
      isSuspended: false,
      customDomain: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    _mockUserId    = "clerk-global-admin-with-tenant";
    _mockAuthExtras = { orgId: "org_unregistered_irrelevant" };
    _mockUserRow   = {
      id: "user-uuid-global-admin",
      isGlobalAdmin: true,
      activeTenantId: "tenant-entered-uuid",
    };
    _mockMembershipTenantIds = [];
    _mockTenant    = ENTERED_TENANT;

    const res = await request(app).get(PROTECTED_ROUTE);

    expect(res.status).not.toBe(401);
    expect(res.body.error ?? "").not.toMatch(/don't belong to a campaign/i);
    expect(res.body.error ?? "").not.toMatch(/Forbidden/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. UNAUTHENTICATED — baseline to confirm 401 still applies
// ═══════════════════════════════════════════════════════════════════════════════

describe("Unauthenticated requests → 401 regardless of headers", () => {
  it("no session at all returns 401", async () => {
    // _mockUserId stays null → getAuth returns {}
    const res = await request(app).get(PROTECTED_ROUTE);
    expect(res.status).toBe(401);
  });
});
