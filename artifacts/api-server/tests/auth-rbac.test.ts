/**
 * Integration tests: Authentication and Role-Based Access Control
 *
 * Strategy:
 *  - @clerk/express is mocked so getAuth() returns a controllable userId
 *  - @workspace/db is mocked so resolveActor() can return any role set without a DB
 *  - The real Express app is imported; supertest drives HTTP requests
 *  - Expectations test HTTP status codes only (401 / 403 / !401&!403)
 *    because route handlers may return 400/500 when the DB mock returns no data;
 *    what matters is that RBAC fires at the right layer.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/auth-rbac.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable auth state (set per test) ────────────────────────────────────────
let _mockAuthUserId: string | null = null;
let _mockUserRow: { id: string; isGlobalAdmin: boolean; activeTenantId: string | null } | null = null;
let _mockRoles: Array<{ slug: string; level: number }> = [];

// The campaign every mocked actor belongs to. resolveTenant only attaches a
// tenant when app-owned membership (user_roles) says so — there is no JWT org
// fallback anymore.
const _TENANT = {
  id: "tenant-rbac-uuid",
  slug: "rbac-test-campaign",
  name: "RBAC Test Campaign",
  plan: "standard",
  isSuspended: false,
  customDomain: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock Clerk ────────────────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware:
    (_options?: unknown) =>
    (_req: any, _res: any, next: any) =>
      next(),
  getAuth: (_req: any) =>
    _mockAuthUserId ? { userId: _mockAuthUserId } : {},
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock_key",
}));

// ─── Mock Clerk Proxy middleware (local module) ────────────────────────────────
vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware:
    () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Mock DB ───────────────────────────────────────────────────────────────────
// Each call to db.select() creates a fresh builder that tracks which table
// was passed to .from() and returns appropriate mock data.
vi.mock("@workspace/db", () => {
  // Table sentinel objects — identified by __tableName in the builder
  const usersTable = {
    __tableName: "users",
    id: "id",
    clerkId: "clerkId",
    fullName: "fullName",
    email: "email",
  };
  const userRolesTable = {
    __tableName: "user_roles",
    userId: "userId",
    roleId: "roleId",
    id: "id",
  };
  const rolesTable = {
    __tableName: "roles",
    slug: "slug",
    level: "level",
    id: "id",
    name: "name",
  };

  // Generic sentinel tables for other DB entities — builders resolve to []
  const makeTable = (name: string) => ({ __tableName: name });

  function makeQueryBuilder() {
    let _table: string | null = null;
    // resolveTenant's membership query selects tenant ids from user_roles
    // WITHOUT joins; resolveActor's role query joins the roles table. The join
    // is what tells the two user_roles queries apart.
    let _joined = false;

    const qb: any = {
      from(table: any) {
        _table = table?.__tableName ?? null;
        return qb;
      },
      where() {
        return qb;
      },
      innerJoin() {
        _joined = true;
        return qb;
      },
      orderBy() {
        return qb;
      },
      offset() {
        return qb;
      },
      limit(n: number) {
        if (_table === "users") {
          return Promise.resolve(_mockUserRow ? [_mockUserRow] : []);
        }
        if (_table === "tenants") {
          return Promise.resolve([_TENANT]);
        }
        return Promise.resolve([]);
      },
      // Support awaiting the builder directly (e.g. roles query without .limit())
      then(resolve: any, reject: any) {
        if (_table === "user_roles") {
          const rows = _joined
            ? [..._mockRoles]
            : _mockUserRow
              ? [{ tenantId: _TENANT.id }]
              : [];
          return Promise.resolve(rows).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    db,
    usersTable,
    userRolesTable,
    rolesTable,
    tenantsTable: makeTable("tenants"),
    // Sentinel exports used in route files — queries will resolve to []
    resultSubmissionsTable: makeTable("result_submissions"),
    submissionCandidateVotesTable: makeTable("submission_candidate_votes"),
    submissionFormImagesTable: makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable: makeTable("submission_corrections"),
    submissionOcrSuggestionsTable: makeTable("submission_ocr_suggestions"),
    candidatesTable: makeTable("candidates"),
    pollingStationsTable: makeTable("polling_stations"),
    pollingAgentsTable: makeTable("polling_agents"),
    dataSubjectRequestsTable: makeTable("data_subject_requests"),
    dataProcessingRecordsTable: makeTable("data_processing_records"),
    dpiaRegisterTable: makeTable("dpia_register"),
    vendorRegisterTable: makeTable("vendor_register"),
    dataBreachRegisterTable: makeTable("data_breach_register"),
    consentAuditTable: makeTable("consent_audit"),
    dataRetentionPoliciesTable: makeTable("data_retention_policies"),
    tallySnapshotsTable: makeTable("tally_snapshots"),
    electionsTable: makeTable("elections"),
    volunteersTable: makeTable("volunteers"),
    supportersTable: makeTable("supporters"),
    contributionsTable: makeTable("contributions"),
    expenditureRequestsTable: makeTable("expenditure_requests"),
    auditLogsTable: makeTable("audit_logs"),
    electionDisputesTable: makeTable("election_disputes"),
    electionIncidentReportsTable: makeTable("election_incident_reports"),
    agentTrainingEnrollmentsTable: makeTable("agent_training_enrollments"),
    exportAuditLogTable: makeTable("export_audit_log"),
    // drizzle helpers used in routes
    eq: (..._args: any[]) => ({}),
    and: (..._args: any[]) => ({}),
    or: (..._args: any[]) => ({}),
    desc: (_col: any) => ({}),
    count: () => ({}),
    sum: () => ({}),
    inArray: () => ({}),
    gte: () => ({}),
    lte: () => ({}),
    sql: Object.assign(
      (_tpl: TemplateStringsArray, ..._vals: any[]) => ({}),
      { raw: (_s: string) => ({}) }
    ),
  };
});

// ─── Import app AFTER mocks are registered ────────────────────────────────────
// Dynamic import ensures mocks are resolved before module code runs
const { default: app } = await import("../src/app");

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Set up an authenticated actor with given role slugs. */
function asUser(
  clerkId: string,
  roles: Array<{ slug: string; level: number }>
) {
  _mockAuthUserId = clerkId;
  _mockUserRow = { id: "user-uuid-" + clerkId, isGlobalAdmin: false, activeTenantId: null };
  _mockRoles = roles;
}

/** Set up an unauthenticated request. */
function asAnonymous() {
  _mockAuthUserId = null;
  _mockUserRow = null;
  _mockRoles = [];
}

// Known role definitions (slug + level mirrors the real roles table)
const ROLES = {
  superAdmin: { slug: "super-admin", level: 1 },
  campaignExecDirector: { slug: "campaign-exec-director", level: 2 },
  nationalCampaignManager: { slug: "national-campaign-manager", level: 2 },
  returningOfficer: { slug: "returning-officer", level: 3 },
  countyCoordinator: { slug: "county-coordinator", level: 3 },
  constituencyCoordinator: { slug: "constituency-coordinator", level: 4 },
  pollingAgentSupervisor: { slug: "polling-agent-supervisor", level: 5 },
  resultVerifier: { slug: "result-verifier", level: 5 },
  pollingAgent: { slug: "polling-agent", level: 6 },
  dataOfficer: { slug: "data-officer", level: 4 },
  legalOfficer: { slug: "legal-officer", level: 4 },
  financeManager: { slug: "finance-manager", level: 4 },
  volunteer: { slug: "volunteer", level: 8 },
};

beforeEach(() => {
  asAnonymous();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. UNAUTHENTICATED → 401 for all sensitive route groups
// ═══════════════════════════════════════════════════════════════════════════════

describe("Unauthenticated requests → 401", () => {
  it("GET /api/election-results/submissions", async () => {
    asAnonymous();
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).toBe(401);
  });

  it("POST /api/election-results/submissions", async () => {
    asAnonymous();
    const res = await request(app).post("/api/election-results/submissions").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/election-results/submissions/agent-submit", async () => {
    asAnonymous();
    const res = await request(app)
      .post("/api/election-results/submissions/agent-submit")
      .send({});
    expect(res.status).toBe(401);
  });

  it("GET /api/tally/snapshot", async () => {
    asAnonymous();
    const res = await request(app).get("/api/tally/snapshot?electionId=abc");
    expect(res.status).toBe(401);
  });

  it("POST /api/tally/compute", async () => {
    asAnonymous();
    const res = await request(app).post("/api/tally/compute").send({});
    expect(res.status).toBe(401);
  });

  it("GET /api/compliance/breaches", async () => {
    asAnonymous();
    const res = await request(app).get("/api/compliance/breaches");
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/breaches", async () => {
    asAnonymous();
    const res = await request(app).post("/api/compliance/breaches").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/data-requests", async () => {
    asAnonymous();
    const res = await request(app).post("/api/compliance/data-requests").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/reporting/export", async () => {
    asAnonymous();
    const res = await request(app).post("/api/reporting/export").send({});
    expect(res.status).toBe(401);
  });

  it("GET /api/privileged-access/review", async () => {
    asAnonymous();
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).toBe(401);
  });

  it("GET /api/audit/logs", async () => {
    asAnonymous();
    const res = await request(app).get("/api/audit/logs");
    expect(res.status).toBe(401);
  });

  it("GET /api/finance/contributions", async () => {
    asAnonymous();
    const res = await request(app).get("/api/finance/contributions");
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. WRONG ROLE → 403
// ═══════════════════════════════════════════════════════════════════════════════

describe("Wrong role → 403", () => {
  it("volunteer cannot GET /api/election-results/submissions", async () => {
    asUser("clerk-vol-1", [ROLES.volunteer]);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).toBe(403);
  });

  it("volunteer cannot POST /api/election-results/submissions (agent-submit requires polling-agent or higher)", async () => {
    asUser("clerk-vol-2", [ROLES.volunteer]);
    const res = await request(app)
      .post("/api/election-results/submissions/agent-submit")
      .send({});
    expect(res.status).toBe(403);
  });

  it("volunteer cannot POST /api/compliance/breaches", async () => {
    asUser("clerk-vol-3", [ROLES.volunteer]);
    const res = await request(app)
      .post("/api/compliance/breaches")
      .send({ title: "breach" });
    expect(res.status).toBe(403);
  });

  it("volunteer cannot GET /api/compliance/breaches", async () => {
    asUser("clerk-vol-4", [ROLES.volunteer]);
    const res = await request(app).get("/api/compliance/breaches");
    expect(res.status).toBe(403);
  });

  it("polling-agent cannot GET /api/tally/snapshot (requires verifier-level roles)", async () => {
    asUser("clerk-agent-1", [ROLES.pollingAgent]);
    const res = await request(app).get("/api/tally/snapshot?electionId=abc");
    expect(res.status).toBe(403);
  });

  it("polling-agent cannot POST /api/tally/compute (requires campaign leadership)", async () => {
    asUser("clerk-agent-2", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/tally/compute")
      .send({ electionId: "some-id" });
    expect(res.status).toBe(403);
  });

  it("polling-agent cannot POST /api/reporting/export", async () => {
    asUser("clerk-agent-3", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "volunteers", format: "csv" });
    expect(res.status).toBe(403);
  });

  it("result-verifier cannot POST /api/reporting/export (export requires finance-manager or above)", async () => {
    asUser("clerk-verifier-1", [ROLES.resultVerifier]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "tally-summary", format: "csv" });
    expect(res.status).toBe(403);
  });

  it("volunteer cannot access /api/privileged-access/review", async () => {
    asUser("clerk-vol-5", [ROLES.volunteer]);
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).toBe(403);
  });

  it("polling-agent cannot POST /api/compliance/data-requests", async () => {
    asUser("clerk-agent-4", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/compliance/data-requests")
      .send({ requestType: "access", subjectName: "Test Person" });
    expect(res.status).toBe(403);
  });

  it("user with NO roles gets 403 (not 401) on authenticated endpoints", async () => {
    asUser("clerk-noroles", []);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CORRECT ROLE → passes RBAC (not 401 or 403)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Correct role → RBAC passes (not 401 or 403)", () => {
  it("polling-agent can POST /api/election-results/submissions", async () => {
    asUser("clerk-pa-1", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/election-results/submissions")
      .send({
        pollingStationId: "00000000-0000-0000-0000-000000000001",
        electionId: "00000000-0000-0000-0000-000000000002",
        agentId: "00000000-0000-0000-0000-000000000003",
      });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("polling-agent can POST /api/election-results/submissions/agent-submit", async () => {
    asUser("clerk-pa-2", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/election-results/submissions/agent-submit")
      .send({
        pollingStationId: "00000000-0000-0000-0000-000000000001",
        electionId: "00000000-0000-0000-0000-000000000002",
        agentId: "00000000-0000-0000-0000-000000000003",
      });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("result-verifier can GET /api/election-results/submissions", async () => {
    asUser("clerk-rv-1", [ROLES.resultVerifier]);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("county-coordinator can GET /api/tally/snapshot", async () => {
    asUser("clerk-cc-1", [ROLES.countyCoordinator]);
    const res = await request(app).get(
      "/api/tally/snapshot?electionId=00000000-0000-0000-0000-000000000001"
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("campaign-exec-director can POST /api/tally/compute", async () => {
    asUser("clerk-ced-1", [ROLES.campaignExecDirector]);
    const res = await request(app)
      .post("/api/tally/compute")
      .send({ electionId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("data-officer can GET /api/compliance/breaches", async () => {
    asUser("clerk-do-1", [ROLES.dataOfficer]);
    const res = await request(app).get("/api/compliance/breaches");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("data-officer can POST /api/compliance/breaches", async () => {
    asUser("clerk-do-2", [ROLES.dataOfficer]);
    const res = await request(app)
      .post("/api/compliance/breaches")
      .send({
        title: "Security breach",
        severity: "high",
      });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("legal-officer can POST /api/compliance/data-requests", async () => {
    asUser("clerk-lo-1", [ROLES.legalOfficer]);
    const res = await request(app)
      .post("/api/compliance/data-requests")
      .send({
        requestType: "access",
        subjectName: "John Doe",
        subjectEmail: "john@example.com",
      });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("finance-manager can POST /api/reporting/export", async () => {
    asUser("clerk-fm-1", [ROLES.financeManager]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "donations", format: "csv" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("campaign-exec-director can POST /api/reporting/export", async () => {
    asUser("clerk-ced-2", [ROLES.campaignExecDirector]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "tally-summary", format: "excel" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("campaign-exec-director can GET /api/privileged-access/review", async () => {
    asUser("clerk-ced-3", [ROLES.campaignExecDirector]);
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("data-officer can GET /api/privileged-access/review", async () => {
    asUser("clerk-do-3", [ROLES.dataOfficer]);
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super-admin bypasses all role checks on compliance routes", async () => {
    asUser("clerk-sa-1", [ROLES.superAdmin]);
    const res = await request(app).get("/api/compliance/breaches");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("super-admin bypasses all role checks on election-results routes", async () => {
    asUser("clerk-sa-2", [ROLES.superAdmin]);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FOUR-EYES PRIVILEGE CHECK LOGIC
//    Tests the business rule that no user may simultaneously hold roles from
//    two or more of the conflicting privilege groups.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Four-eyes privilege check logic", () => {
  /**
   * Extract violation data from GET /api/privileged-access/review.
   * Returns the parsed body (violations array) or throws.
   */
  async function getPrivilegeReview(roles: Array<{ slug: string; level: number }>) {
    // privileged-access/review endpoint queries all user-role assignments
    // Our DB mock returns _mockRoles for user_roles table queries.
    // The review endpoint does its own DB query, so we need to patch it differently.
    // We test the pure logic directly via the CONFLICTING_PRIVILEGE_GROUPS definition.
    return roles;
  }

  /**
   * Pure function mirroring the four-eyes check in privilegedAccess.ts.
   * Accepts a user's roles and the conflict rules, returns whether a violation exists.
   */
  function hasPrivilegeConflict(
    userRoles: string[],
    conflictRules: Array<{
      groups: Array<{ roles: string[] }>;
    }>
  ): boolean {
    for (const rule of conflictRules) {
      const groupsHeld = rule.groups.filter((g) =>
        g.roles.some((r) => userRoles.includes(r))
      );
      if (groupsHeld.length >= 2) return true;
    }
    return false;
  }

  const CONFLICTING_PRIVILEGE_GROUPS = [
    {
      name: "Tally + Finance + Audit",
      description:
        "No user may simultaneously alter verified results AND approve payments AND erase audit records.",
      groups: [
        {
          label: "Tally Verifiers",
          roles: ["national-tally-verifier", "county-verification-officer"],
        },
        {
          label: "Payment Approvers",
          roles: ["finance-manager", "returning-officer"],
        },
        {
          label: "Audit Managers",
          roles: ["campaign-exec-director", "super-admin"],
        },
      ],
    },
  ];

  it("detects conflict: user holds tally-verifier AND finance-manager roles", () => {
    const userRoles = ["county-verification-officer", "finance-manager"];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      true
    );
  });

  it("detects conflict: user holds tally-verifier AND campaign-exec-director (audit) roles", () => {
    const userRoles = [
      "national-tally-verifier",
      "campaign-exec-director",
    ];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      true
    );
  });

  it("detects conflict: user holds all three conflicting groups", () => {
    const userRoles = [
      "county-verification-officer",
      "returning-officer",
      "super-admin",
    ];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      true
    );
  });

  it("no conflict: user holds only tally-verifier role", () => {
    const userRoles = ["national-tally-verifier"];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      false
    );
  });

  it("no conflict: user holds only finance-manager role", () => {
    const userRoles = ["finance-manager"];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      false
    );
  });

  it("no conflict: user holds roles from only one group (polling-agent + result-verifier)", () => {
    const userRoles = ["polling-agent", "result-verifier"];
    expect(hasPrivilegeConflict(userRoles, CONFLICTING_PRIVILEGE_GROUPS)).toBe(
      false
    );
  });

  it("no conflict: empty role list", () => {
    expect(hasPrivilegeConflict([], CONFLICTING_PRIVILEGE_GROUPS)).toBe(false);
  });

  it("GET /api/privileged-access/review endpoint is accessible to campaign-exec-director", async () => {
    asUser("clerk-ced-4", [ROLES.campaignExecDirector]);
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("GET /api/privileged-access/review endpoint rejects polling-agent", async () => {
    asUser("clerk-pa-review", [ROLES.pollingAgent]);
    const res = await request(app).get("/api/privileged-access/review");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SUBMISSION ROLE BOUNDARIES
//    Verifies that only the correct roles can write vs. read submissions.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Election submission role boundaries", () => {
  const validSubmissionBody = {
    pollingStationId: "00000000-0000-0000-0000-000000000001",
    electionId: "00000000-0000-0000-0000-000000000002",
    agentId: "00000000-0000-0000-0000-000000000003",
  };

  it("polling-agent can submit (POST /submissions)", async () => {
    asUser("clerk-pa-submit", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/election-results/submissions")
      .send(validSubmissionBody);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("volunteer cannot submit (POST /submissions)", async () => {
    asUser("clerk-vol-submit", [ROLES.volunteer]);
    const res = await request(app)
      .post("/api/election-results/submissions")
      .send(validSubmissionBody);
    expect(res.status).toBe(403);
  });

  it("polling-agent cannot view submissions list (GET /submissions — requires verifier or above)", async () => {
    // polling-agent is NOT in canViewResults
    asUser("clerk-pa-view", [ROLES.pollingAgent]);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).toBe(403);
  });

  it("polling-agent-supervisor can view submissions list", async () => {
    asUser("clerk-pas-view", [ROLES.pollingAgentSupervisor]);
    const res = await request(app).get("/api/election-results/submissions");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("result-verifier can verify a submission (POST /submissions/:id/verify)", async () => {
    asUser("clerk-rv-verify", [ROLES.resultVerifier]);
    const res = await request(app)
      .post("/api/election-results/submissions/00000000-0000-0000-0000-000000000099/verify")
      .send({ action: "approved", toStatus: "constituency_verification" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("polling-agent cannot verify a submission (POST /submissions/:id/verify)", async () => {
    asUser("clerk-pa-verify", [ROLES.pollingAgent]);
    const res = await request(app)
      .post("/api/election-results/submissions/00000000-0000-0000-0000-000000000099/verify")
      .send({ action: "approved", toStatus: "constituency_verification" });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TALLY ROUTE ROLE BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tally route role boundaries", () => {
  it("returning-officer can GET /api/tally/snapshot", async () => {
    asUser("clerk-ro-1", [ROLES.returningOfficer]);
    const res = await request(app).get(
      "/api/tally/snapshot?electionId=00000000-0000-0000-0000-000000000001"
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("returning-officer can POST /api/tally/compute", async () => {
    asUser("clerk-ro-2", [ROLES.returningOfficer]);
    const res = await request(app)
      .post("/api/tally/compute")
      .send({ electionId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("county-coordinator can GET /api/tally/snapshot", async () => {
    asUser("clerk-cc-tally", [ROLES.countyCoordinator]);
    const res = await request(app).get(
      "/api/tally/snapshot?electionId=00000000-0000-0000-0000-000000000001"
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("county-coordinator cannot POST /api/tally/compute (requires leadership level)", async () => {
    asUser("clerk-cc-compute", [ROLES.countyCoordinator]);
    const res = await request(app)
      .post("/api/tally/compute")
      .send({ electionId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. COMPLIANCE ROUTE ROLE BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Compliance route role boundaries", () => {
  it("national-campaign-manager can view compliance but not manage breaches", async () => {
    asUser("clerk-ncm-1", [ROLES.nationalCampaignManager]);
    const viewRes = await request(app).get("/api/compliance/breaches");
    expect(viewRes.status).not.toBe(401);
    expect(viewRes.status).not.toBe(403);

    // POST /breaches requires canManageCompliance which excludes national-campaign-manager
    const writeRes = await request(app)
      .post("/api/compliance/breaches")
      .send({ title: "test" });
    expect(writeRes.status).toBe(403);
  });

  it("data-officer can manage (POST) compliance data", async () => {
    asUser("clerk-do-comp", [ROLES.dataOfficer]);
    const res = await request(app)
      .post("/api/compliance/dpia")
      .send({ title: "New DPIA", riskLevel: "medium" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("legal-officer can manage compliance data", async () => {
    asUser("clerk-lo-comp", [ROLES.legalOfficer]);
    const res = await request(app)
      .post("/api/compliance/vendors")
      .send({ vendorName: "ACME Corp" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. REPORTING / EXPORT ROLE BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reporting / export role boundaries", () => {
  it("county-coordinator can POST /api/reporting/export", async () => {
    asUser("clerk-cc-export", [ROLES.countyCoordinator]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "polling-stations", format: "csv" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("data-officer can POST /api/reporting/export", async () => {
    asUser("clerk-do-export", [ROLES.dataOfficer]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "audit-log", format: "csv" });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("polling-agent-supervisor cannot POST /api/reporting/export", async () => {
    asUser("clerk-pas-export", [ROLES.pollingAgentSupervisor]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "polling-agents", format: "csv" });
    expect(res.status).toBe(403);
  });

  it("constituency-coordinator cannot POST /api/reporting/export", async () => {
    asUser("clerk-consco-export", [ROLES.constituencyCoordinator]);
    const res = await request(app)
      .post("/api/reporting/export")
      .send({ reportId: "result-submissions", format: "csv" });
    expect(res.status).toBe(403);
  });
});
