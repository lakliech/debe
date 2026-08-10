/**
 * Public-portal contract tests — field-name mapping from HTTP body → DB insert.
 *
 * These tests catch regressions like "phone" vs "phoneNumber" or "type" vs
 * "requestType" being silently dropped before they reach the database.
 *
 * Strategy:
 *  - Mock the DB so no real Postgres connection is needed.
 *  - Capture the argument passed to db.insert().values() for each endpoint.
 *  - Assert HTTP 201 AND that the captured values contain the correct field names
 *    with the exact values sent by the client.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/public-portal-contracts.test.ts
 *
 * Covered endpoints (all unauthenticated):
 *  1. POST /api/public/volunteer-register  → phoneNumber, consentGiven
 *  2. POST /api/public/supporter-register  → phoneNumber, consentMarketing, consentSms, consentEmail
 *  3. POST /api/public/aspirants           → phoneNumber, nationalId, position, consentGiven
 *  4. POST /api/public/policy-submit       → title, content, submitterName
 *  5. POST /api/public/contact             → fullName (mapped from "name"), email, subject, message
 *  6. POST /api/data-requests              → requestType, fullName
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Shared mock state — must be declared with vi.hoisted() so the factory ───
// closures inside vi.mock() can access the same bindings that test code mutates.
const mockState = vi.hoisted(() => ({
  // Captured insert values (set by mock, read by tests)
  capturedInsertValues: null as Record<string, unknown> | null,
  // Queue of select-result rows — each shift() feeds one DB select call.
  // Tests push arrays onto this queue before sending a request.
  selectResultQueue: [] as Record<string, unknown>[][],
  // Tenant injected by the resolveTenant middleware mock (tests can override).
  testTenant: {
    id: "tenant-uuid-test",
    slug: "test-campaign",
    isSuspended: false,
    plan: "pro",
  } as Record<string, unknown> | null,
}));

// ─── Convenience aliases used throughout the test file ────────────────────────
function getCapturedInsertValues() { return mockState.capturedInsertValues; }

// ─── Mock rate limiter — bypass caps so tests never throttle ──────────────────
vi.mock("../src/middlewares/rateLimits", () => ({
  publicSubmitLimiter:  (_req: any, _res: any, next: any) => next(),
  statusCheckLimiter:   (_req: any, _res: any, next: any) => next(),
}));

// ─── Mock resolveTenant middleware — always inject a synthetic tenant ─────────
vi.mock("../src/middlewares/resolveTenant", () => ({
  resolveTenantPublic: (req: any, _res: any, next: any) => {
    if (mockState.testTenant) (req as any).tenant = mockState.testTenant;
    next();
  },
  resolveTenant: (req: any, _res: any, next: any) => {
    if (mockState.testTenant) (req as any).tenant = mockState.testTenant;
    next();
  },
  resolveTenantMixed: (req: any, _res: any, next: any) => {
    if (mockState.testTenant) (req as any).tenant = mockState.testTenant;
    next();
  },
  resolveTenantOptional: (req: any, _res: any, next: any) => {
    if (mockState.testTenant) (req as any).tenant = mockState.testTenant;
    next();
  },
  requireTenantContext: (_req: any, _res: any, next: any) => next(),
  assertTenant: (req: any) => (req as any).tenant,
  tenantFilter: (_table: any, _id: string) => ({}),
  NO_CAMPAIGN_SELECTED: "NO_CAMPAIGN_SELECTED",
}));

// ─── Mock Clerk (not needed for public routes, but app imports it) ────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware:
    (_options?: unknown) =>
    (_req: any, _res: any, next: any) =>
      next(),
  getAuth: (_req: any) => ({}),
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
  const makeTable = (name: string) => ({ __tableName: name });

  const usersTable    = makeTable("users");
  const userRolesTable = makeTable("user_roles");
  const rolesTable    = makeTable("roles");

  /**
   * Query builder that returns [] for every select, mimicking an empty database.
   * The aspirants endpoint does two selects before inserting:
   *   1. countiesTable  — resolve countyCode → countyId  (empty → skip)
   *   2. aspirantsTable — duplicate check               (empty → proceed)
   * Returning [] for both is safe.
   */
  function makeQueryBuilder() {
    const qb: any = {
      from()       { return qb; },
      where()      { return qb; },
      innerJoin()  { return qb; },
      leftJoin()   { return qb; },
      orderBy()    { return qb; },
      offset()     { return qb; },
      groupBy()    { return qb; },
      select()     { return qb; },
      limit() {
        const rows = mockState.selectResultQueue.length > 0 ? mockState.selectResultQueue.shift()! : [];
        return Promise.resolve(rows);
      },
      // then() is intentionally static — always returns [] — so background jobs
      // that await a query builder directly (count queries without .limit()) don't
      // accidentally drain the selectResultQueue intended for the route handler.
      then(resolve: any, reject: any) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),

    insert: (_table?: unknown) => ({
      values: (v: Record<string, unknown>) => {
        // Capture every insert so tests can assert field names.
        mockState.capturedInsertValues = v;
        return {
          returning: () =>
            Promise.resolve([
              { id: "mock-uuid-001", fullName: "Test User", status: "pending" },
            ]),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([]),
          }),
        };
      },
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
    // public portal tables
    volunteersTable:         makeTable("volunteers"),
    supportersTable:         makeTable("supporters"),
    aspirantsTable:          makeTable("aspirants"),
    policySubmissionsTable:  makeTable("policy_submissions"),
    contactMessagesTable:    makeTable("contact_messages"),
    dataSubjectRequestsTable: makeTable("data_subject_requests"),
    tenantsTable:            makeTable("tenants"),
    // tables referenced at module load (avoid undefined crashes)
    manifestoSectorsTable:   makeTable("manifesto_sectors"),
    manifestoItemsTable:     makeTable("manifesto_items"),
    countyPrioritiesTable:   makeTable("county_priorities"),
    faqItemsTable:           makeTable("faq_items"),
    factCheckItemsTable:     makeTable("fact_check_items"),
    newsArticlesTable:       makeTable("news_articles"),
    eventsTable:             makeTable("events"),
    countiesTable:           makeTable("counties"),
    brandingTable:           makeTable("branding"),
    resultSubmissionsTable:  makeTable("result_submissions"),
    submissionCandidateVotesTable: makeTable("submission_candidate_votes"),
    submissionFormImagesTable: makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable: makeTable("submission_corrections"),
    submissionOcrSuggestionsTable: makeTable("submission_ocr_suggestions"),
    candidatesTable:         makeTable("candidates"),
    pollingStationsTable:    makeTable("polling_stations"),
    pollingAgentsTable:      makeTable("polling_agents"),
    agentTrainingCoursesTable: makeTable("agent_training_courses"),
    agentTrainingEnrollmentsTable: makeTable("agent_training_enrollments"),
    agentQuizQuestionsTable: makeTable("agent_quiz_questions"),
    agentQuizAttemptsTable:  makeTable("agent_quiz_attempts"),
    agentElectionDayTable:   makeTable("agent_election_day"),
    agentAllowancesTable:    makeTable("agent_allowances"),
    agentReplacementsTable:  makeTable("agent_replacements"),
    agentSyncStatusTable:    makeTable("agent_sync_status"),
    dataProcessingRecordsTable: makeTable("data_processing_records"),
    dpiaRegisterTable:       makeTable("dpia_register"),
    vendorRegisterTable:     makeTable("vendor_register"),
    dataBreachRegisterTable: makeTable("data_breach_register"),
    consentAuditTable:       makeTable("consent_audit"),
    dataRetentionPoliciesTable: makeTable("data_retention_policies"),
    volunteersTable2:        makeTable("volunteers"),
    supportersTable2:        makeTable("supporters"),
    contributionsTable:      makeTable("contributions"),
    expenditureRequestsTable: makeTable("expenditure_requests"),
    auditLogsTable:          makeTable("audit_logs"),
    electionDisputesTable:   makeTable("election_disputes"),
    electionIncidentReportsTable: makeTable("election_incident_reports"),
    exportAuditLogTable:     makeTable("export_audit_log"),
    tallySnapshotsTable:     makeTable("tally_snapshots"),
    electionsTable:          makeTable("elections"),
    // drizzle helpers
    eq:      (..._a: any[]) => ({}),
    and:     (..._a: any[]) => ({}),
    or:      (..._a: any[]) => ({}),
    desc:    (_c: any)      => ({}),
    asc:     (_c: any)      => ({}),
    count:   ()             => ({}),
    sum:     ()             => ({}),
    inArray: ()             => ({}),
    ilike:   ()             => ({}),
    gte:     ()             => ({}),
    lte:     ()             => ({}),
    sql: Object.assign(
      (_t: TemplateStringsArray, ..._v: any[]) => ({}),
      { raw: (_s: string) => ({}) }
    ),
  };
});

// ─── App (imported after all mocks are in place) ──────────────────────────────
const { default: app } = await import("../src/app");

// ─── Reset captured state before every test ───────────────────────────────────
beforeEach(() => {
  mockState.capturedInsertValues = null;
  mockState.selectResultQueue = [];
  mockState.testTenant = {
    id: "tenant-uuid-test",
    slug: "test-campaign",
    isSuspended: false,
    plan: "pro",
  };
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /api/public/volunteer-register
//    Critical fields: phoneNumber (not "phone"), consentGiven (not "consent")
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/public/volunteer-register — field-name contract", () => {
  const ROUTE = "/api/public/volunteer-register";

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName:     "Amina Ochieng",
      phoneNumber:  "+254712345678",
      consentGiven: true,
    });
    expect(res.status).toBe(201);
  });

  it("passes phoneNumber (not 'phone') to the database insert", async () => {
    await request(app).post(ROUTE).send({
      fullName:     "Amina Ochieng",
      phoneNumber:  "+254712345678",
      consentGiven: true,
    });
    expect(mockState.capturedInsertValues).not.toBeNull();
    // phoneNumber must be present under the correct key
    expect(mockState.capturedInsertValues).toHaveProperty("phoneNumber", "+254712345678");
    // "phone" is the wrong key — must NOT appear
    expect(mockState.capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes consentGiven (not 'consent') as true to the database insert", async () => {
    await request(app).post(ROUTE).send({
      fullName:     "Baraka Mwangi",
      phoneNumber:  "+254700000001",
      consentGiven: true,
    });
    expect(mockState.capturedInsertValues).toHaveProperty("consentGiven", true);
    // The insert should never forward a falsy consent (route hard-codes true)
    expect(( mockState.capturedInsertValues as any)?.consentGiven).toBe(true);
  });

  it("rejects a payload missing consentGiven with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName:    "No Consent User",
      phoneNumber: "+254700000002",
      // consentGiven deliberately omitted
    });
    expect(res.status).toBe(400);
  });

  it("rejects a payload missing phoneNumber with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName:     "No Phone User",
      consentGiven: true,
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/public/supporter-register
//    Critical fields: phoneNumber, consentMarketing, consentSms, consentEmail
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/public/supporter-register — field-name contract", () => {
  const ROUTE = "/api/public/supporter-register";

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName:         "Fatuma Hassan",
      phoneNumber:      "+254733000001",
      consentMarketing: true,
      consentSms:       true,
      consentEmail:     false,
    });
    expect(res.status).toBe(201);
  });

  it("passes phoneNumber (not 'phone') to the database insert", async () => {
    await request(app).post(ROUTE).send({
      fullName:    "Grace Njoroge",
      phoneNumber: "+254733000002",
    });
    expect(mockState.capturedInsertValues).toHaveProperty("phoneNumber", "+254733000002");
    expect(mockState.capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes consentMarketing, consentSms, consentEmail with correct boolean values", async () => {
    await request(app).post(ROUTE).send({
      fullName:         "Hassan Otieno",
      phoneNumber:      "+254733000003",
      consentMarketing: true,
      consentSms:       false,
      consentEmail:     true,
    });
    expect(mockState.capturedInsertValues).toHaveProperty("consentMarketing", true);
    expect(mockState.capturedInsertValues).toHaveProperty("consentSms",       false);
    expect(mockState.capturedInsertValues).toHaveProperty("consentEmail",     true);
  });

  it("defaults consent fields to false when omitted", async () => {
    await request(app).post(ROUTE).send({ fullName: "Ida Kamau" });
    // Route uses `?? false` for all three consent flags
    expect(mockState.capturedInsertValues).toHaveProperty("consentMarketing", false);
    expect(mockState.capturedInsertValues).toHaveProperty("consentSms",       false);
    expect(mockState.capturedInsertValues).toHaveProperty("consentEmail",     false);
  });

  it("rejects a payload missing fullName with 400", async () => {
    const res = await request(app).post(ROUTE).send({ phoneNumber: "+254700000003" });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/public/aspirants
//    Critical fields: phoneNumber, nationalId, position, consentGiven
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/public/aspirants — field-name contract", () => {
  const ROUTE = "/api/public/aspirants";

  const VALID_ASPIRANT = {
    fullName:    "James Muthoni",
    phoneNumber: "+254722000001",
    nationalId:  "12345678",
    position:    "parliamentary",
    consentGiven: true,
  };

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(res.status).toBe(201);
  });

  it("passes phoneNumber (not 'phone') to the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(mockState.capturedInsertValues).toHaveProperty("phoneNumber", "+254722000001");
    expect(mockState.capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes nationalId and position with the correct values", async () => {
    await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(mockState.capturedInsertValues).toHaveProperty("nationalId", "12345678");
    expect(mockState.capturedInsertValues).toHaveProperty("position",   "parliamentary");
  });

  it("passes consentGiven: true (not 'consent') to the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(mockState.capturedInsertValues).toHaveProperty("consentGiven", true);
    expect(mockState.capturedInsertValues).not.toHaveProperty("consent");
  });

  it("rejects an invalid position value with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      ...VALID_ASPIRANT,
      position: "mayor", // not in the allowed enum
    });
    expect(res.status).toBe(400);
  });

  it("rejects a payload missing nationalId with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      fullName:    "No ID User",
      phoneNumber: "+254722000002",
      position:    "senatorial",
      consentGiven: true,
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. POST /api/public/policy-submit
//    Critical fields: title, content, submitterName
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/public/policy-submit — field-name contract", () => {
  const ROUTE = "/api/public/policy-submit";

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send({
      title:         "Improve Healthcare",
      content:       "We need more hospitals in rural areas.",
      submitterName: "Lena Wanjiku",
    });
    expect(res.status).toBe(201);
  });

  it("passes title and content with correct values to the database insert", async () => {
    await request(app).post(ROUTE).send({
      title:   "Road Infrastructure",
      content: "Tarmac the road to Turkana.",
    });
    expect(mockState.capturedInsertValues).toHaveProperty("title",   "Road Infrastructure");
    expect(mockState.capturedInsertValues).toHaveProperty("content", "Tarmac the road to Turkana.");
  });

  it("passes submitterName for non-anonymous submissions", async () => {
    await request(app).post(ROUTE).send({
      title:         "Education Funding",
      content:       "Increase bursary allocation.",
      submitterName: "Mohamed Ali",
      anonymous:     false,
    });
    expect(mockState.capturedInsertValues).toHaveProperty("submitterName", "Mohamed Ali");
  });

  it("replaces submitterName with 'Anonymous' when anonymous: true", async () => {
    await request(app).post(ROUTE).send({
      title:         "Anonymous Policy",
      content:       "Some sensitive proposal.",
      submitterName: "Real Name",
      anonymous:     true,
    });
    expect(mockState.capturedInsertValues).toHaveProperty("submitterName", "Anonymous");
    // The submitter email must be suppressed for anonymous submissions
    expect(mockState.capturedInsertValues).toHaveProperty("submitterEmail", null);
  });

  it("rejects a payload missing content with 400", async () => {
    const res = await request(app).post(ROUTE).send({ title: "No Content" });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /api/public/contact
//    Critical field: fullName — the handler maps req.body.name → fullName
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/public/contact — field-name contract", () => {
  const ROUTE = "/api/public/contact";

  const VALID_CONTACT = {
    name:    "Naomi Kiprotich",
    email:   "naomi@example.com",
    subject: "Volunteer Inquiry",
    message: "I would like to volunteer in Kisumu.",
  };

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send(VALID_CONTACT);
    expect(res.status).toBe(201);
  });

  it("maps client 'name' field to 'fullName' in the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_CONTACT);
    // The route does: { fullName: name, email, subject, message }
    expect(mockState.capturedInsertValues).toHaveProperty("fullName", "Naomi Kiprotich");
    // "name" must NOT leak through as a DB column — it is not a column
    expect(mockState.capturedInsertValues).not.toHaveProperty("name");
  });

  it("passes email, subject, and message with correct values", async () => {
    await request(app).post(ROUTE).send(VALID_CONTACT);
    expect(mockState.capturedInsertValues).toHaveProperty("email",   "naomi@example.com");
    expect(mockState.capturedInsertValues).toHaveProperty("subject", "Volunteer Inquiry");
    expect(mockState.capturedInsertValues).toHaveProperty("message", "I would like to volunteer in Kisumu.");
  });

  it("sets status to 'open' in the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_CONTACT);
    expect(mockState.capturedInsertValues).toHaveProperty("status", "open");
  });

  it("rejects a payload missing any required field with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      name:  "Incomplete User",
      email: "no-subject@example.com",
      // subject and message missing
    });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. POST /api/data-requests
//    Critical field: requestType (not "type") — the original regression
// ═════════════════════════════════════════════════════════════════════════════
describe("POST /api/data-requests — field-name contract", () => {
  const ROUTE = "/api/data-requests";

  it("returns 201 with a valid payload", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "access",
      fullName:    "Omar Abdullahi",
    });
    expect(res.status).toBe(201);
  });

  it("passes requestType (not 'type') to the database insert", async () => {
    await request(app).post(ROUTE).send({
      requestType: "deletion",
      fullName:    "Pendo Achieng",
    });
    expect(mockState.capturedInsertValues).toHaveProperty("requestType", "deletion");
    // "type" is the wrong key — must NOT appear in the insert
    expect(mockState.capturedInsertValues).not.toHaveProperty("type");
  });

  it("passes fullName with the correct value to the database insert", async () => {
    await request(app).post(ROUTE).send({
      requestType: "correction",
      fullName:    "Rehema Mwenda",
      email:       "rehema@example.com",
    });
    expect(mockState.capturedInsertValues).toHaveProperty("fullName", "Rehema Mwenda");
  });

  it("passes optional phoneNumber (not 'phone') to the database insert", async () => {
    await request(app).post(ROUTE).send({
      requestType: "objection",
      fullName:    "Samuel Njeri",
      phoneNumber: "+254799000001",
    });
    expect(mockState.capturedInsertValues).toHaveProperty("phoneNumber", "+254799000001");
    expect(mockState.capturedInsertValues).not.toHaveProperty("phone");
  });

  it("rejects an unknown requestType with 400", async () => {
    const res = await request(app).post(ROUTE).send({
      requestType: "erasure", // not in the allowed enum
      fullName:    "Bad Type User",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a payload missing requestType with 400", async () => {
    const res = await request(app).post(ROUTE).send({ fullName: "No Type User" });
    expect(res.status).toBe(400);
  });

  it("rejects a payload missing fullName with 400", async () => {
    const res = await request(app).post(ROUTE).send({ requestType: "access" });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. GET /api/public/aspirants/status
//    Critical: requires both nationalId AND phone; returns only status/reviewNotes
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/public/aspirants/status — declaration status self-check", () => {
  const ROUTE = "/api/public/aspirants/status";

  // The resolveTenant mock always injects _testTenant (reset in beforeEach).
  // For status endpoint tests, just seed the aspirant DB result directly.
  function seedAspirant(aspirantRow: Record<string, unknown>) {
    // app.ts has a global middleware that queries the DB on every request to
    // resolve a tenant from a custom domain (app.ts ~line 257).  That middleware
    // calls db.select().from().where().limit(1) — consuming one queue slot —
    // before the route handler runs.  Push a blank slot first so the middleware
    // gets [], and the real aspirant row is waiting for the route handler.
    mockState.selectResultQueue.push([]);
    mockState.selectResultQueue.push([aspirantRow]);
  }

  it("returns 400 when nationalId is missing", async () => {
    const res = await request(app).get(ROUTE).query({ phone: "+254712345678" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when phone is missing", async () => {
    const res = await request(app).get(ROUTE).query({ nationalId: "12345678" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when both params are missing", async () => {
    const res = await request(app).get(ROUTE);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no record matches the supplied nationalId and phone", async () => {
    // Queue is empty → aspirant lookup returns [] → 404
    const res = await request(app)
      .get(ROUTE)
      .query({ nationalId: "99999999", phone: "+254700000000" });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with status when a matching record is found", async () => {
    seedAspirant({ status: "pending", reviewNotes: null });
    const res = await request(app)
      .get(ROUTE)
      .query({ nationalId: "12345678", phone: "+254712345678" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "pending");
    // reviewNotes must be absent when null — no extra PII
    expect(res.body).not.toHaveProperty("reviewNotes");
  });

  it("returns 200 with reviewNotes when the coordinator left a note", async () => {
    seedAspirant({ status: "rejected", reviewNotes: "Missing supporting documents" });
    const res = await request(app)
      .get(ROUTE)
      .query({ nationalId: "12345678", phone: "+254712345678" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "rejected");
    expect(res.body).toHaveProperty("reviewNotes", "Missing supporting documents");
  });

  it("returns 200 with status 'approved' and no reviewNotes for an approved record", async () => {
    seedAspirant({ status: "approved", reviewNotes: null });
    const res = await request(app)
      .get(ROUTE)
      .query({ nationalId: "12345678", phone: "+254712345678" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "approved");
    expect(res.body).not.toHaveProperty("reviewNotes");
  });

  it("does not expose PII beyond status and reviewNotes", async () => {
    seedAspirant({ status: "pending", reviewNotes: null });
    const res = await request(app)
      .get(ROUTE)
      .query({ nationalId: "12345678", phone: "+254712345678" });
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body);
    expect(keys).not.toContain("fullName");
    expect(keys).not.toContain("nationalId");
    expect(keys).not.toContain("phoneNumber");
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("id");
  });
});
