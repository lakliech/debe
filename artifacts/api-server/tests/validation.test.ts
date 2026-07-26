/**
 * Validation tests: Zod schema enforcement on every validated POST/PATCH route
 *
 * Strategy:
 *  - Same mock setup as auth-rbac.test.ts (Clerk + DB mocked)
 *  - Each tested route gets three cases:
 *      1. Missing a required field  → HTTP 400 with an `errors` array
 *      2. Wrong field type          → HTTP 400 with an `errors` array
 *      3. Valid payload             → HTTP status is NOT 400 (validation passed;
 *         business-logic errors like 404/500 are acceptable in a mocked env)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/validation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable auth state ───────────────────────────────────────────────────────
let _mockAuthUserId: string | null = null;
let _mockUserRow: { id: string } | null = null;
let _mockRoles: Array<{ slug: string; level: number }> = [];

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
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

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const usersTable = {
    __tableName: "users",
    id: "id",
    clerkId: "clerkId",
    fullName: "fullName",
    email: "email",
  };
  const userRolesTable = { __tableName: "user_roles", userId: "userId", roleId: "roleId", id: "id" };
  const rolesTable = { __tableName: "roles", slug: "slug", level: "level", id: "id", name: "name" };

  const makeTable = (name: string) => ({ __tableName: name });

  function makeQueryBuilder() {
    let _table: string | null = null;
    const qb: any = {
      from(table: any) { _table = table?.__tableName ?? null; return qb; },
      where() { return qb; },
      innerJoin() { return qb; },
      orderBy() { return qb; },
      offset() { return qb; },
      groupBy() { return qb; },
      limit(n: number) {
        if (_table === "users") return Promise.resolve(_mockUserRow ? [_mockUserRow] : []);
        return Promise.resolve([]);
      },
      then(resolve: any, reject: any) {
        if (_table === "user_roles") return Promise.resolve([..._mockRoles]).then(resolve, reject);
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    db,
    usersTable,
    userRolesTable,
    rolesTable,
    // electionResults
    resultSubmissionsTable: makeTable("result_submissions"),
    submissionCandidateVotesTable: makeTable("submission_candidate_votes"),
    submissionFormImagesTable: makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable: makeTable("submission_corrections"),
    submissionOcrSuggestionsTable: makeTable("submission_ocr_suggestions"),
    candidatesTable: makeTable("candidates"),
    pollingStationsTable: makeTable("polling_stations"),
    pollingAgentsTable: makeTable("polling_agents"),
    // pollingAgentsMgmt
    agentTrainingCoursesTable: makeTable("agent_training_courses"),
    agentTrainingEnrollmentsTable: makeTable("agent_training_enrollments"),
    agentQuizQuestionsTable: makeTable("agent_quiz_questions"),
    agentQuizAttemptsTable: makeTable("agent_quiz_attempts"),
    agentElectionDayTable: makeTable("agent_election_day"),
    agentAllowancesTable: makeTable("agent_allowances"),
    agentReplacementsTable: makeTable("agent_replacements"),
    agentSyncStatusTable: makeTable("agent_sync_status"),
    // compliance
    dataSubjectRequestsTable: makeTable("data_subject_requests"),
    dataProcessingRecordsTable: makeTable("data_processing_records"),
    dpiaRegisterTable: makeTable("dpia_register"),
    vendorRegisterTable: makeTable("vendor_register"),
    dataBreachRegisterTable: makeTable("data_breach_register"),
    consentAuditTable: makeTable("consent_audit"),
    dataRetentionPoliciesTable: makeTable("data_retention_policies"),
    // reporting
    volunteersTable: makeTable("volunteers"),
    supportersTable: makeTable("supporters"),
    contributionsTable: makeTable("contributions"),
    expenditureRequestsTable: makeTable("expenditure_requests"),
    auditLogsTable: makeTable("audit_logs"),
    electionDisputesTable: makeTable("election_disputes"),
    electionIncidentReportsTable: makeTable("election_incident_reports"),
    exportAuditLogTable: makeTable("export_audit_log"),
    // misc
    tallySnapshotsTable: makeTable("tally_snapshots"),
    electionsTable: makeTable("elections"),
    // drizzle helpers
    eq: (..._args: any[]) => ({}),
    and: (..._args: any[]) => ({}),
    or: (..._args: any[]) => ({}),
    desc: (_col: any) => ({}),
    count: () => ({}),
    sum: () => ({}),
    inArray: () => ({}),
    ilike: () => ({}),
    gte: () => ({}),
    lte: () => ({}),
    sql: Object.assign(
      (_tpl: TemplateStringsArray, ..._vals: any[]) => ({}),
      { raw: (_s: string) => ({}) }
    ),
  };
});

// ─── App import (after mocks) ─────────────────────────────────────────────────
const { default: app } = await import("../src/app");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asUser(clerkId: string, roles: Array<{ slug: string; level: number }>) {
  _mockAuthUserId = clerkId;
  _mockUserRow = { id: "user-uuid-" + clerkId };
  _mockRoles = roles;
}

const ROLES = {
  campaignExec: { slug: "campaign-exec-director", level: 2 },
  pollingAgent: { slug: "polling-agent", level: 6 },
  dataOfficer:  { slug: "data-officer", level: 4 },
  financeManager: { slug: "finance-manager", level: 4 },
  pollingAgentSupervisor: { slug: "polling-agent-supervisor", level: 5 },
  resultVerifier: { slug: "result-verifier", level: 5 },
};

// Shared UUIDs used in valid payloads
const UUID1 = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";
const UUID3 = "00000000-0000-0000-0000-000000000003";

/**
 * Assert a response carries a Zod validation failure:
 *   HTTP 400 + body.errors is a non-empty array of {path, message} objects.
 */
function expectValidationError(res: any) {
  expect(res.status).toBe(400);
  expect(res.body).toHaveProperty("error", "Validation failed");
  expect(res.body).toHaveProperty("errors");
  expect(Array.isArray(res.body.errors)).toBe(true);
  expect(res.body.errors.length).toBeGreaterThan(0);
  // Each error should have at least a message field
  for (const err of res.body.errors) {
    expect(err).toHaveProperty("message");
  }
}

beforeEach(() => {
  _mockAuthUserId = null;
  _mockUserRow = null;
  _mockRoles = [];
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. electionResults — submissionBodySchema
//    POST /api/election-results/submissions
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions (submissionBodySchema)", () => {
  const ROUTE = "/api/election-results/submissions";

  beforeEach(() => asUser("u-er-sub", [ROLES.pollingAgent]));

  it("missing pollingStationId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      electionId: UUID2,
      agentId: UUID3,
    });
    expectValidationError(res);
  });

  it("missing electionId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      agentId: UUID3,
    });
    expectValidationError(res);
  });

  it("pollingStationId not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: "not-a-uuid",
      electionId: UUID2,
      agentId: UUID3,
    });
    expectValidationError(res);
  });

  it("totalVotesCast is a string instead of integer → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: UUID3,
      totalVotesCast: "five hundred", // wrong type
    });
    expectValidationError(res);
  });

  it("candidateVotes contains invalid voteCount → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: UUID3,
      candidateVotes: [{ candidateName: "Alice", voteCount: "lots" }], // string not int
    });
    expectValidationError(res);
  });

  it("valid minimal payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: UUID3,
    });
    expect(res.status).not.toBe(400);
  });

  it("valid full payload with candidateVotes → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: UUID3,
      registeredVoters: 500,
      totalVotesCast: 400,
      totalValidVotes: 390,
      rejectedBallots: 10,
      candidateVotes: [
        { candidateName: "Alice Wanjiku", voteCount: 250 },
        { candidateName: "Bob Otieno", voteCount: 140 },
      ],
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. electionResults — submissionBodySchema
//    POST /api/election-results/submissions/agent-submit
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions/agent-submit (submissionBodySchema)", () => {
  const ROUTE = "/api/election-results/submissions/agent-submit";

  beforeEach(() => asUser("u-er-as", [ROLES.pollingAgent]));

  it("empty body → 400 with errors (missing all required fields)", async () => {
    const res = await request(app).post(ROUTE).send({});
    expectValidationError(res);
  });

  it("agentId is not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: "not-a-uuid",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      pollingStationId: UUID1,
      electionId: UUID2,
      agentId: UUID3,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. electionResults — imageUploadSchema
//    POST /api/election-results/submissions/:id/images
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions/:id/images (imageUploadSchema)", () => {
  const ROUTE = `/api/election-results/submissions/${UUID1}/images`;

  beforeEach(() => asUser("u-er-img", [ROLES.pollingAgent]));

  it("missing imageType → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      objectPath: "/path/to/image.jpg",
    });
    expectValidationError(res);
  });

  it("imageType is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ imageType: "" });
    expectValidationError(res);
  });

  it("sizeBytes is a string instead of integer → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      imageType: "form_page_1",
      sizeBytes: "big",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      imageType: "form_page_1",
      objectPath: "/uploads/form.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 204800,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. electionResults — verifySchema
//    POST /api/election-results/submissions/:id/verify
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions/:id/verify (verifySchema)", () => {
  const ROUTE = `/api/election-results/submissions/${UUID1}/verify`;

  beforeEach(() => asUser("u-er-verify", [ROLES.resultVerifier]));

  it("missing action → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ toStatus: "constituency_verification" });
    expectValidationError(res);
  });

  it("missing toStatus → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ action: "approved" });
    expectValidationError(res);
  });

  it("action is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ action: "", toStatus: "county_verification" });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      action: "approved",
      toStatus: "constituency_verification",
      notes: "Looks good",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. electionResults — correctSchema
//    POST /api/election-results/submissions/:id/correct
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions/:id/correct (correctSchema)", () => {
  const ROUTE = `/api/election-results/submissions/${UUID1}/correct`;

  beforeEach(() => asUser("u-er-correct", [ROLES.resultVerifier]));

  it("missing fieldName → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      correctionReason: "Typo in count",
    });
    expectValidationError(res);
  });

  it("missing correctionReason → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      fieldName: "totalValidVotes",
    });
    expectValidationError(res);
  });

  it("evidenceUrl is not a valid URL → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      fieldName: "totalValidVotes",
      correctionReason: "Mis-tally on form",
      evidenceUrl: "not-a-url",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fieldName: "totalValidVotes",
      correctionReason: "Original tally had a transcription error",
      originalValue: "350",
      correctedValue: "360",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. electionResults — ocrReviewSchema
//    POST /api/election-results/submissions/:id/ocr/review
// ═══════════════════════════════════════════════════════════════════════════════

describe("electionResults — POST /submissions/:id/ocr/review (ocrReviewSchema)", () => {
  const ROUTE = `/api/election-results/submissions/${UUID1}/ocr/review`;

  beforeEach(() => asUser("u-er-ocr", [ROLES.resultVerifier]));

  it("missing suggestionId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ accepted: true });
    expectValidationError(res);
  });

  it("suggestionId not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      suggestionId: "not-a-uuid",
      accepted: true,
    });
    expectValidationError(res);
  });

  it("missing accepted → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ suggestionId: UUID2 });
    expectValidationError(res);
  });

  it("accepted is a string instead of boolean → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      suggestionId: UUID2,
      accepted: "yes",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      suggestionId: UUID2,
      accepted: false,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. pollingAgentsMgmt — createAgentSchema
//    POST /api/polling-agents/
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /polling-agents/ (createAgentSchema)", () => {
  const ROUTE = "/api/polling-agents/";

  beforeEach(() => asUser("u-pa-create", [ROLES.campaignExec]));

  it("missing fullName → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      phoneNumber: "+254700000001",
    });
    expectValidationError(res);
  });

  it("fullName is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ fullName: "" });
    expectValidationError(res);
  });

  it("email is not a valid email → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName: "Jane Mwangi",
      email: "not-an-email",
    });
    expectValidationError(res);
  });

  it("status is not an allowed enum value → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName: "Jane Mwangi",
      status: "on-leave", // not in enum
    });
    expectValidationError(res);
  });

  it("pollingStationId not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName: "Jane Mwangi",
      pollingStationId: "station-123", // not a UUID
    });
    expectValidationError(res);
  });

  it("valid minimal payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName: "Jane Mwangi",
    });
    expect(res.status).not.toBe(400);
  });

  it("valid full payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName: "Jane Mwangi",
      phoneNumber: "+254700000001",
      email: "jane@example.com",
      pollingStationId: UUID1,
      isBackup: false,
      status: "active",
      trainingStatus: "completed",
      accreditationStatus: "approved",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. pollingAgentsMgmt — patchAgentSchema
//    PATCH /api/polling-agents/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — PATCH /polling-agents/:id (patchAgentSchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}`;

  beforeEach(() => asUser("u-pa-patch", [ROLES.campaignExec]));

  it("email is not a valid email → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ email: "bad" });
    expectValidationError(res);
  });

  it("status is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ status: "unknown" });
    expectValidationError(res);
  });

  it("accreditationStatus is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ accreditationStatus: "waiting" });
    expectValidationError(res);
  });

  it("valid partial patch (status only) → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({ status: "inactive" });
    expect(res.status).not.toBe(400);
  });

  it("valid partial patch (email + phone) → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      email: "updated@example.com",
      phoneNumber: "+254711111111",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. pollingAgentsMgmt — createCourseSchema
//    POST /api/polling-agents/courses
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /polling-agents/courses (createCourseSchema)", () => {
  const ROUTE = "/api/polling-agents/courses";

  beforeEach(() => asUser("u-pa-course", [ROLES.campaignExec]));

  it("missing title → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      description: "A training module",
    });
    expectValidationError(res);
  });

  it("title is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ title: "" });
    expectValidationError(res);
  });

  it("passingScore is a string instead of number → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Election Day Procedures",
      passingScore: "eighty",
    });
    expectValidationError(res);
  });

  it("passingScore exceeds 100 → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Election Day Procedures",
      passingScore: 150,
    });
    expectValidationError(res);
  });

  it("question with fewer than 2 options → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Election Day Procedures",
      questions: [
        { questionText: "What is your role?", options: ["Agent"], correctIndex: 0 },
      ],
    });
    expectValidationError(res);
  });

  it("valid payload without questions → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Election Day Procedures",
      description: "Core training module",
      passingScore: 70,
      isRequired: true,
    });
    expect(res.status).not.toBe(400);
  });

  it("valid payload with questions → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Election Day Procedures",
      passingScore: 70,
      questions: [
        {
          questionText: "What time do polls open?",
          options: ["6am", "7am", "8am"],
          correctIndex: 0,
        },
      ],
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. pollingAgentsMgmt — quizAnswersSchema
//     POST /api/polling-agents/:id/training/:courseId/quiz
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /:id/training/:courseId/quiz (quizAnswersSchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}/training/${UUID2}/quiz`;

  beforeEach(() => asUser("u-pa-quiz", [ROLES.pollingAgent]));

  it("missing answers → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({});
    expectValidationError(res);
  });

  it("answers is not an array → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ answers: 3 });
    expectValidationError(res);
  });

  it("answers contains a non-integer → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ answers: [0, "one", 2] });
    expectValidationError(res);
  });

  it("valid payload (empty answers array) → not 400", async () => {
    const res = await request(app).post(ROUTE).send({ answers: [] });
    // route checks for empty questions and may return 400 from business logic — that is acceptable
    // the schema itself allows an empty array; we just confirm validation passes (not schema 400)
    const isSchemaError =
      res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });

  it("valid payload with answers → not 400 (schema passes)", async () => {
    const res = await request(app).post(ROUTE).send({ answers: [0, 1, 2] });
    const isSchemaError =
      res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. pollingAgentsMgmt — allowanceSchema
//     POST /api/polling-agents/:id/allowance
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /:id/allowance (allowanceSchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}/allowance`;

  beforeEach(() => asUser("u-pa-allow", [ROLES.campaignExec]));

  it("missing electionId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ amountKes: 5000 });
    expectValidationError(res);
  });

  it("electionId not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      electionId: "not-a-uuid",
      amountKes: 5000,
    });
    expectValidationError(res);
  });

  it("missing amountKes → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ electionId: UUID2 });
    expectValidationError(res);
  });

  it("amountKes is zero (not positive) → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      electionId: UUID2,
      amountKes: 0,
    });
    expectValidationError(res);
  });

  it("amountKes is a string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      electionId: UUID2,
      amountKes: "five thousand",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      electionId: UUID2,
      amountKes: 3500,
      paymentMethod: "mpesa",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. pollingAgentsMgmt — replacementSchema
//     POST /api/polling-agents/replacements
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /polling-agents/replacements (replacementSchema)", () => {
  const ROUTE = "/api/polling-agents/replacements";

  beforeEach(() => asUser("u-pa-replace", [ROLES.campaignExec]));

  it("missing originalAgentId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      replacementAgentId: UUID2,
      pollingStationId: UUID3,
      reason: "Agent fell ill",
    });
    expectValidationError(res);
  });

  it("missing reason → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      originalAgentId: UUID1,
      replacementAgentId: UUID2,
      pollingStationId: UUID3,
    });
    expectValidationError(res);
  });

  it("reason is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      originalAgentId: UUID1,
      replacementAgentId: UUID2,
      pollingStationId: UUID3,
      reason: "",
    });
    expectValidationError(res);
  });

  it("replacementAgentId not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      originalAgentId: UUID1,
      replacementAgentId: "not-a-uuid",
      pollingStationId: UUID3,
      reason: "Agent ill",
    });
    expectValidationError(res);
  });

  it("effectiveAt not a valid datetime → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      originalAgentId: UUID1,
      replacementAgentId: UUID2,
      pollingStationId: UUID3,
      reason: "Agent ill",
      effectiveAt: "not-a-date",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      originalAgentId: UUID1,
      replacementAgentId: UUID2,
      pollingStationId: UUID3,
      reason: "Primary agent fell ill on election day",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. pollingAgentsMgmt — allowanceApproveSchema
//     POST /api/polling-agents/:id/allowance/approve
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /:id/allowance/approve (allowanceApproveSchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}/allowance/approve`;

  beforeEach(() => asUser("u-pa-allow-approve", [ROLES.financeManager]));

  it("allowanceId provided but not a UUID → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ allowanceId: "not-a-uuid" });
    expectValidationError(res);
  });

  it("valid payload with no body (all optional) → not 400", async () => {
    const res = await request(app).post(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid payload with a UUID allowanceId → not 400", async () => {
    const res = await request(app).post(ROUTE).send({ allowanceId: UUID2 });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. pollingAgentsMgmt — replacementApproveSchema
//     PATCH /api/polling-agents/replacements/:rid/approve
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — PATCH /replacements/:rid/approve (replacementApproveSchema)", () => {
  const ROUTE = `/api/polling-agents/replacements/${UUID1}/approve`;

  beforeEach(() => asUser("u-pa-rep-approve", [ROLES.financeManager]));

  it("effectiveAt not a valid datetime → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ effectiveAt: "tomorrow morning" });
    expectValidationError(res);
  });

  it("effectiveAt is a date without time → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ effectiveAt: "2027-08-09" });
    expectValidationError(res);
  });

  it("valid empty body (all optional) → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid payload with effectiveAt → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      effectiveAt: "2027-08-09T06:00:00+03:00",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. pollingAgentsMgmt — syncHeartbeatSchema
//     POST /api/polling-agents/:id/sync-heartbeat
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — POST /:id/sync-heartbeat (syncHeartbeatSchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}/sync-heartbeat`;

  // sync-heartbeat only requires requireAuth (no role check)
  beforeEach(() => asUser("u-pa-heartbeat", [ROLES.pollingAgent]));

  it("syncStatus is invalid enum → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ syncStatus: "offline" });
    expectValidationError(res);
  });

  it("pendingSubmissions is negative → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ pendingSubmissions: -1 });
    expectValidationError(res);
  });

  it("pendingSubmissions is a string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ pendingSubmissions: "three" });
    expectValidationError(res);
  });

  it("batteryLevel above 100 → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ batteryLevel: 110 });
    expectValidationError(res);
  });

  it("batteryLevel below 0 → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ batteryLevel: -5 });
    expectValidationError(res);
  });

  it("valid empty body (all optional) → not 400", async () => {
    const res = await request(app).post(ROUTE).send({});
    const isSchemaError = res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });

  it("valid full heartbeat payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      deviceId: "device-abc-123",
      syncStatus: "pending",
      pendingSubmissions: 2,
      appVersion: "1.4.2",
      batteryLevel: 72,
      networkType: "4g",
    });
    const isSchemaError = res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. pollingAgentsMgmt — electionDaySchema
//     PATCH /api/polling-agents/:id/election-day
// ═══════════════════════════════════════════════════════════════════════════════

describe("pollingAgentsMgmt — PATCH /:id/election-day (electionDaySchema)", () => {
  const ROUTE = `/api/polling-agents/${UUID1}/election-day`;

  beforeEach(() => asUser("u-pa-eday", [ROLES.pollingAgentSupervisor]));

  it("missing electionId → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      attendanceStatus: "present",
    });
    expectValidationError(res);
  });

  it("electionId not a UUID → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      electionId: "2027-election",
    });
    expectValidationError(res);
  });

  it("attendanceStatus invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      electionId: UUID2,
      attendanceStatus: "late",
    });
    expectValidationError(res);
  });

  it("arrivedAt is not ISO datetime → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      electionId: UUID2,
      arrivedAt: "08:00 AM",
    });
    expectValidationError(res);
  });

  it("valid minimal payload → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({ electionId: UUID2 });
    expect(res.status).not.toBe(400);
  });

  it("valid full payload → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      electionId: UUID2,
      pollingStationId: UUID3,
      arrivedAt: "2027-08-09T06:00:00+03:00",
      attendanceStatus: "present",
      notes: "Arrived on time",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. compliance — createDataRequestSchema
//     POST /api/compliance/data-requests
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /data-requests (createDataRequestSchema)", () => {
  const ROUTE = "/api/compliance/data-requests";

  beforeEach(() => asUser("u-comp-dsr", [ROLES.dataOfficer]));

  it("missing requestType → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      subjectName: "Amina Hassan",
    });
    expectValidationError(res);
  });

  it("requestType is not an allowed enum value → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "delete-everything",
      subjectName: "Amina Hassan",
    });
    expectValidationError(res);
  });

  it("missing subjectName → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "access",
    });
    expectValidationError(res);
  });

  it("subjectName is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "erasure",
      subjectName: "",
    });
    expectValidationError(res);
  });

  it("subjectEmail is not a valid email → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "access",
      subjectName: "Amina Hassan",
      subjectEmail: "not-an-email",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "access",
      subjectName: "Amina Hassan",
      subjectEmail: "amina@example.com",
    });
    expect(res.status).not.toBe(400);
  });

  it("valid payload with all request types → not 400 (erasure)", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "erasure",
      subjectName: "John Doe",
      description: "Please delete all data",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. compliance — patchDataRequestSchema
//     PATCH /api/compliance/data-requests/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — PATCH /data-requests/:id (patchDataRequestSchema)", () => {
  const ROUTE = `/api/compliance/data-requests/${UUID1}`;

  beforeEach(() => asUser("u-comp-dsr-patch", [ROLES.dataOfficer]));

  it("status is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ status: "archived" });
    expectValidationError(res);
  });

  it("assignedTo is not a UUID → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      assignedTo: "user-one",
    });
    expectValidationError(res);
  });

  it("valid empty patch → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid status update → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      status: "in_progress",
      completionNotes: "Working on it",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. compliance — patchDpiaSchema
//     PATCH /api/compliance/dpia/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — PATCH /dpia/:id (patchDpiaSchema)", () => {
  const ROUTE = `/api/compliance/dpia/${UUID1}`;

  beforeEach(() => asUser("u-comp-dpia-patch", [ROLES.dataOfficer]));

  it("title is empty string → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ title: "" });
    expectValidationError(res);
  });

  it("riskLevel is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ riskLevel: "extreme" });
    expectValidationError(res);
  });

  it("status is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ status: "archived" });
    expectValidationError(res);
  });

  it("reviewedAt is not a YYYY-MM-DD date → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ reviewedAt: "January 2027" });
    expectValidationError(res);
  });

  it("valid empty patch → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid patch with status and riskLevel → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      status: "under_review",
      riskLevel: "high",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. compliance — createDpiaSchema
//     POST /api/compliance/dpia
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /dpia (createDpiaSchema)", () => {
  const ROUTE = "/api/compliance/dpia";

  beforeEach(() => asUser("u-comp-dpia", [ROLES.dataOfficer]));

  it("missing title → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      description: "Processing assessment",
    });
    expectValidationError(res);
  });

  it("title is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ title: "" });
    expectValidationError(res);
  });

  it("riskLevel is invalid enum → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Voter data DPIA",
      riskLevel: "extreme",
    });
    expectValidationError(res);
  });

  it("reviewedAt is not a valid date string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Voter data DPIA",
      reviewedAt: "January 2027", // should be YYYY-MM-DD
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Voter Registration Data DPIA",
      riskLevel: "high",
      status: "draft",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. compliance — createVendorSchema
//     POST /api/compliance/vendors
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /vendors (createVendorSchema)", () => {
  const ROUTE = "/api/compliance/vendors";

  beforeEach(() => asUser("u-comp-vendor", [ROLES.dataOfficer]));

  it("missing vendorName → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      vendorType: "cloud_storage",
    });
    expectValidationError(res);
  });

  it("vendorName is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ vendorName: "" });
    expectValidationError(res);
  });

  it("contractUrl is not a valid URL → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      vendorName: "CloudStore Ltd",
      contractUrl: "ftp://not-http",
    });
    // Note: Zod .url() accepts ftp, but let's test a clearly invalid value
    const res2 = await request(app).post(ROUTE).send({
      vendorName: "CloudStore Ltd",
      contractUrl: "not a url at all",
    });
    expectValidationError(res2);
  });

  it("riskRating is invalid enum → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      vendorName: "CloudStore Ltd",
      riskRating: "extreme",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      vendorName: "CloudStore Ltd",
      vendorType: "cloud_storage",
      riskRating: "medium",
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. compliance — patchVendorSchema
//     PATCH /api/compliance/vendors/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — PATCH /vendors/:id (patchVendorSchema)", () => {
  const ROUTE = `/api/compliance/vendors/${UUID1}`;

  beforeEach(() => asUser("u-comp-vendor-patch", [ROLES.dataOfficer]));

  it("vendorName is empty string → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ vendorName: "" });
    expectValidationError(res);
  });

  it("riskRating is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ riskRating: "unknown" });
    expectValidationError(res);
  });

  it("contractUrl is not a valid URL → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ contractUrl: "not a url" });
    expectValidationError(res);
  });

  it("isActive is a string instead of boolean → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ isActive: "yes" });
    expectValidationError(res);
  });

  it("valid empty patch → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid patch with riskRating and isActive → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      riskRating: "high",
      isActive: true,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19. compliance — createBreachSchema
//     POST /api/compliance/breaches
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /breaches (createBreachSchema)", () => {
  const ROUTE = "/api/compliance/breaches";

  beforeEach(() => asUser("u-comp-breach", [ROLES.dataOfficer]));

  it("missing title → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      severity: "high",
    });
    expectValidationError(res);
  });

  it("title is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ title: "" });
    expectValidationError(res);
  });

  it("severity is invalid enum → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Database leak",
      severity: "severe",
    });
    expectValidationError(res);
  });

  it("estimatedRecordsAffected is negative → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Database leak",
      estimatedRecordsAffected: -1,
    });
    expectValidationError(res);
  });

  it("discoveredAt is not a valid datetime → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Database leak",
      discoveredAt: "yesterday",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      title: "Unauthorised access to supporter data",
      severity: "critical",
      estimatedRecordsAffected: 250,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19. compliance — patchBreachSchema
//     PATCH /api/compliance/breaches/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — PATCH /breaches/:id (patchBreachSchema)", () => {
  const ROUTE = `/api/compliance/breaches/${UUID1}`;

  beforeEach(() => asUser("u-comp-breach-patch", [ROLES.dataOfficer]));

  it("status is invalid enum → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ status: "investigating" });
    expectValidationError(res);
  });

  it("assignedTo is not a UUID → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ assignedTo: "alice" });
    expectValidationError(res);
  });

  it("containedAt is not a valid datetime → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({
      containedAt: "2027-01-01", // date without time — invalid for datetime
    });
    expectValidationError(res);
  });

  it("valid empty patch → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid status update → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({
      status: "contained",
      remedialActions: "Patched the vulnerability",
      notifiedDpa: true,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 20. compliance — createProcessingRecordSchema
//     POST /api/compliance/processing-records
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /processing-records (createProcessingRecordSchema)", () => {
  const ROUTE = "/api/compliance/processing-records";

  beforeEach(() => asUser("u-comp-proc", [ROLES.dataOfficer]));

  it("missing processName → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      legalBasis: "Legitimate interest",
    });
    expectValidationError(res);
  });

  it("processName is empty string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ processName: "" });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      processName: "Voter registration processing",
      legalBasis: "Consent",
      dataCategories: ["name", "id_number"],
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 21. compliance — createRetentionPolicySchema
//     POST /api/compliance/retention-policies
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — POST /retention-policies (createRetentionPolicySchema)", () => {
  const ROUTE = "/api/compliance/retention-policies";

  beforeEach(() => asUser("u-comp-ret", [ROLES.dataOfficer]));

  it("missing dataCategory → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      retentionDays: 365,
    });
    expectValidationError(res);
  });

  it("missing retentionDays → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      dataCategory: "voter_records",
    });
    expectValidationError(res);
  });

  it("retentionDays is zero (not positive) → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      dataCategory: "voter_records",
      retentionDays: 0,
    });
    expectValidationError(res);
  });

  it("retentionDays is negative → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      dataCategory: "voter_records",
      retentionDays: -30,
    });
    expectValidationError(res);
  });

  it("retentionDays is a string → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      dataCategory: "voter_records",
      retentionDays: "one year",
    });
    expectValidationError(res);
  });

  it("valid payload → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      dataCategory: "voter_records",
      retentionDays: 365,
      legalBasis: "GDPR Article 17",
      autoDelete: false,
    });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 22. compliance — patchRetentionPolicySchema
//     PATCH /api/compliance/retention-policies/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("compliance — PATCH /retention-policies/:id (patchRetentionPolicySchema)", () => {
  const ROUTE = `/api/compliance/retention-policies/${UUID1}`;

  beforeEach(() => asUser("u-comp-ret-patch", [ROLES.dataOfficer]));

  it("retentionDays is zero → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ retentionDays: 0 });
    expectValidationError(res);
  });

  it("retentionDays is a float (not integer) → 400 with errors", async () => {
    const res = await request(app).patch(ROUTE).send({ retentionDays: 30.5 });
    expectValidationError(res);
  });

  it("valid empty patch → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({});
    expect(res.status).not.toBe(400);
  });

  it("valid retentionDays update → not 400", async () => {
    const res = await request(app).patch(ROUTE).send({ retentionDays: 730, isActive: true });
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 23. reporting — exportSchema
//     POST /api/reporting/export
// ═══════════════════════════════════════════════════════════════════════════════

describe("reporting — POST /export (exportSchema)", () => {
  const ROUTE = "/api/reporting/export";

  beforeEach(() => asUser("u-rep-export", [ROLES.financeManager]));

  it("missing reportId → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({ format: "csv" });
    expectValidationError(res);
  });

  it("reportId is not a valid enum value → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      reportId: "unknown-report",
      format: "csv",
    });
    expectValidationError(res);
  });

  it("format is not a valid enum value → 400 with errors", async () => {
    const res = await request(app).post(ROUTE).send({
      reportId: "volunteers",
      format: "pdf",
    });
    expectValidationError(res);
  });

  it("valid payload without format (defaults to csv) → not 400", async () => {
    const res = await request(app).post(ROUTE).send({
      reportId: "volunteers",
    });
    // May get 500 if actorId is null (audit log throws), but must not be schema 400
    const isSchemaError =
      res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });

  it("valid payload with csv format → not 400 (schema passes)", async () => {
    const res = await request(app).post(ROUTE).send({
      reportId: "polling-agents",
      format: "csv",
    });
    const isSchemaError =
      res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });

  it("valid payload with excel format → not 400 (schema passes)", async () => {
    const res = await request(app).post(ROUTE).send({
      reportId: "tally-summary",
      format: "excel",
    });
    const isSchemaError =
      res.status === 400 && res.body?.error === "Validation failed";
    expect(isSchemaError).toBe(false);
  });

  it("all valid reportIds pass schema validation", async () => {
    const validIds = [
      "volunteers", "supporters", "donations", "expenditure",
      "polling-agents", "polling-stations", "result-submissions", "tally-summary",
      "incidents", "disputes", "training-completions", "audit-log", "export-log",
      "county-coverage", "agent-allowances", "donor-summary",
      "event-attendance", "comms-reach", "rapid-response",
    ];

    for (const reportId of validIds) {
      const res = await request(app).post(ROUTE).send({ reportId, format: "csv" });
      const isSchemaError =
        res.status === 400 && res.body?.error === "Validation failed";
      expect(isSchemaError, `reportId="${reportId}" should not fail schema validation`).toBe(false);
    }
  });
});
