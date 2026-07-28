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

// ─── Captured insert arguments ────────────────────────────────────────────────
let _capturedInsertValues: Record<string, unknown> | null = null;

// ─── Mock rate limiter — bypass the 5-req/15-min cap so tests never throttle ─
vi.mock("../src/middlewares/rateLimits", () => ({
  publicSubmitLimiter: (_req: any, _res: any, next: any) => next(),
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
      limit()      { return Promise.resolve([]); },
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
        _capturedInsertValues = v;
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
  _capturedInsertValues = null;
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
    expect(_capturedInsertValues).not.toBeNull();
    // phoneNumber must be present under the correct key
    expect(_capturedInsertValues).toHaveProperty("phoneNumber", "+254712345678");
    // "phone" is the wrong key — must NOT appear
    expect(_capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes consentGiven (not 'consent') as true to the database insert", async () => {
    await request(app).post(ROUTE).send({
      fullName:     "Baraka Mwangi",
      phoneNumber:  "+254700000001",
      consentGiven: true,
    });
    expect(_capturedInsertValues).toHaveProperty("consentGiven", true);
    // The insert should never forward a falsy consent (route hard-codes true)
    expect((_capturedInsertValues as any)?.consentGiven).toBe(true);
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
    expect(_capturedInsertValues).toHaveProperty("phoneNumber", "+254733000002");
    expect(_capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes consentMarketing, consentSms, consentEmail with correct boolean values", async () => {
    await request(app).post(ROUTE).send({
      fullName:         "Hassan Otieno",
      phoneNumber:      "+254733000003",
      consentMarketing: true,
      consentSms:       false,
      consentEmail:     true,
    });
    expect(_capturedInsertValues).toHaveProperty("consentMarketing", true);
    expect(_capturedInsertValues).toHaveProperty("consentSms",       false);
    expect(_capturedInsertValues).toHaveProperty("consentEmail",     true);
  });

  it("defaults consent fields to false when omitted", async () => {
    await request(app).post(ROUTE).send({ fullName: "Ida Kamau" });
    // Route uses `?? false` for all three consent flags
    expect(_capturedInsertValues).toHaveProperty("consentMarketing", false);
    expect(_capturedInsertValues).toHaveProperty("consentSms",       false);
    expect(_capturedInsertValues).toHaveProperty("consentEmail",     false);
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
    expect(_capturedInsertValues).toHaveProperty("phoneNumber", "+254722000001");
    expect(_capturedInsertValues).not.toHaveProperty("phone");
  });

  it("passes nationalId and position with the correct values", async () => {
    await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(_capturedInsertValues).toHaveProperty("nationalId", "12345678");
    expect(_capturedInsertValues).toHaveProperty("position",   "parliamentary");
  });

  it("passes consentGiven: true (not 'consent') to the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_ASPIRANT);
    expect(_capturedInsertValues).toHaveProperty("consentGiven", true);
    expect(_capturedInsertValues).not.toHaveProperty("consent");
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
    expect(_capturedInsertValues).toHaveProperty("title",   "Road Infrastructure");
    expect(_capturedInsertValues).toHaveProperty("content", "Tarmac the road to Turkana.");
  });

  it("passes submitterName for non-anonymous submissions", async () => {
    await request(app).post(ROUTE).send({
      title:         "Education Funding",
      content:       "Increase bursary allocation.",
      submitterName: "Mohamed Ali",
      anonymous:     false,
    });
    expect(_capturedInsertValues).toHaveProperty("submitterName", "Mohamed Ali");
  });

  it("replaces submitterName with 'Anonymous' when anonymous: true", async () => {
    await request(app).post(ROUTE).send({
      title:         "Anonymous Policy",
      content:       "Some sensitive proposal.",
      submitterName: "Real Name",
      anonymous:     true,
    });
    expect(_capturedInsertValues).toHaveProperty("submitterName", "Anonymous");
    // The submitter email must be suppressed for anonymous submissions
    expect(_capturedInsertValues).toHaveProperty("submitterEmail", null);
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
    expect(_capturedInsertValues).toHaveProperty("fullName", "Naomi Kiprotich");
    // "name" must NOT leak through as a DB column — it is not a column
    expect(_capturedInsertValues).not.toHaveProperty("name");
  });

  it("passes email, subject, and message with correct values", async () => {
    await request(app).post(ROUTE).send(VALID_CONTACT);
    expect(_capturedInsertValues).toHaveProperty("email",   "naomi@example.com");
    expect(_capturedInsertValues).toHaveProperty("subject", "Volunteer Inquiry");
    expect(_capturedInsertValues).toHaveProperty("message", "I would like to volunteer in Kisumu.");
  });

  it("sets status to 'open' in the database insert", async () => {
    await request(app).post(ROUTE).send(VALID_CONTACT);
    expect(_capturedInsertValues).toHaveProperty("status", "open");
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
    expect(_capturedInsertValues).toHaveProperty("requestType", "deletion");
    // "type" is the wrong key — must NOT appear in the insert
    expect(_capturedInsertValues).not.toHaveProperty("type");
  });

  it("passes fullName with the correct value to the database insert", async () => {
    await request(app).post(ROUTE).send({
      requestType: "correction",
      fullName:    "Rehema Mwenda",
      email:       "rehema@example.com",
    });
    expect(_capturedInsertValues).toHaveProperty("fullName", "Rehema Mwenda");
  });

  it("passes optional phoneNumber (not 'phone') to the database insert", async () => {
    await request(app).post(ROUTE).send({
      requestType: "objection",
      fullName:    "Samuel Njeri",
      phoneNumber: "+254799000001",
    });
    expect(_capturedInsertValues).toHaveProperty("phoneNumber", "+254799000001");
    expect(_capturedInsertValues).not.toHaveProperty("phone");
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
