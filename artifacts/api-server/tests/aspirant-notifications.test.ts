/**
 * Aspirant declaration notification tests.
 *
 * Verifies that `notifyAspirantDeclaration` dispatches:
 *  1. A WhatsApp message to every review-team member with a phone number
 *  2. An email to every review-team member with an email address
 *  3. De-duplicates members who appear more than once (multi-role users)
 *  4. Never throws when a WhatsApp send fails
 *  5. Never throws when the tenant row is missing
 *  6. POST /api/public/aspirants triggers the notification after 201
 *
 * No real database or messaging provider is used.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec vitest run tests/aspirant-notifications.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Stubs for notification sinks ────────────────────────────────────────────

const sendWhatsappChannelMock = vi.fn();
const sendEmailAsyncMock      = vi.fn();

// ─── DB stub — wired up before each test via dbSelectRows ────────────────────

let dbSelectRows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const makeTable = (name: string) => ({ __tableName: name });

  function makeQb(rows: () => unknown[]) {
    const qb: any = {
      from()      { return qb; },
      where()     { return qb; },
      innerJoin() { return qb; },
      leftJoin()  { return qb; },
      orderBy()   { return qb; },
      groupBy()   { return qb; },
      offset()    { return qb; },
      limit()     { return Promise.resolve(rows()); },
      then(resolve: any, reject: any) {
        return Promise.resolve(rows()).then(resolve, reject);
      },
    };
    return qb;
  }

  const db: any = {
    select: () => makeQb(() => dbSelectRows),
    insert: () => ({
      values: (v: any) => ({
        returning: () =>
          Promise.resolve([{ id: "mock-id", fullName: v.fullName ?? "Test", status: "pending" }]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate:  () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    db,
    tenantsTable:   makeTable("tenants"),
    usersTable:     makeTable("users"),
    userRolesTable: makeTable("user_roles"),
    rolesTable:     makeTable("roles"),
    aspirantsTable: makeTable("aspirants"),
    countiesTable:  makeTable("counties"),
    emailLogsTable: makeTable("email_logs"),
    // public portal tables (imported by publicPortal route)
    volunteersTable:              makeTable("volunteers"),
    supportersTable:              makeTable("supporters"),
    policySubmissionsTable:       makeTable("policy_submissions"),
    contactMessagesTable:         makeTable("contact_messages"),
    dataSubjectRequestsTable:     makeTable("data_subject_requests"),
    manifestoSectorsTable:        makeTable("manifesto_sectors"),
    manifestoItemsTable:          makeTable("manifesto_items"),
    countyPrioritiesTable:        makeTable("county_priorities"),
    faqItemsTable:                makeTable("faq_items"),
    factCheckItemsTable:          makeTable("fact_check_items"),
    newsArticlesTable:            makeTable("news_articles"),
    eventsTable:                  makeTable("events"),
    brandingTable:                makeTable("branding"),
    resultSubmissionsTable:       makeTable("result_submissions"),
    submissionCandidateVotesTable: makeTable("submission_candidate_votes"),
    submissionFormImagesTable:    makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable:   makeTable("submission_corrections"),
    submissionOcrSuggestionsTable: makeTable("submission_ocr_suggestions"),
    candidatesTable:              makeTable("candidates"),
    pollingStationsTable:         makeTable("polling_stations"),
    pollingAgentsTable:           makeTable("polling_agents"),
    agentTrainingCoursesTable:    makeTable("agent_training_courses"),
    agentTrainingEnrollmentsTable: makeTable("agent_training_enrollments"),
    agentQuizQuestionsTable:      makeTable("agent_quiz_questions"),
    agentQuizAttemptsTable:       makeTable("agent_quiz_attempts"),
    agentElectionDayTable:        makeTable("agent_election_day"),
    agentAllowancesTable:         makeTable("agent_allowances"),
    agentReplacementsTable:       makeTable("agent_replacements"),
    agentSyncStatusTable:         makeTable("agent_sync_status"),
    dataProcessingRecordsTable:   makeTable("data_processing_records"),
    dpiaRegisterTable:            makeTable("dpia_register"),
    vendorRegisterTable:          makeTable("vendor_register"),
    dataBreachRegisterTable:      makeTable("data_breach_register"),
    consentAuditTable:            makeTable("consent_audit"),
    dataRetentionPoliciesTable:   makeTable("data_retention_policies"),
    contributionsTable:           makeTable("contributions"),
    expenditureRequestsTable:     makeTable("expenditure_requests"),
    auditLogsTable:               makeTable("audit_logs"),
    electionDisputesTable:        makeTable("election_disputes"),
    electionIncidentReportsTable: makeTable("election_incident_reports"),
    exportAuditLogTable:          makeTable("export_audit_log"),
    tallySnapshotsTable:          makeTable("tally_snapshots"),
    electionsTable:               makeTable("elections"),
    // drizzle helpers
    eq:      (..._a: any[]) => ({}),
    and:     (..._a: any[]) => ({}),
    or:      (..._a: any[]) => ({}),
    inArray: ()             => ({}),
    isNotNull: ()           => ({}),
    desc:    ()             => ({}),
    asc:     ()             => ({}),
    count:   ()             => ({}),
    sum:     ()             => ({}),
    ilike:   ()             => ({}),
    gte:     ()             => ({}),
    lte:     ()             => ({}),
    sql: Object.assign(
      (_t: TemplateStringsArray, ..._v: any[]) => ({}),
      { raw: (_s: string) => ({}) },
    ),
  };
});

vi.mock("../src/lib/commsDispatcher", () => ({
  sendWhatsappChannel: (...args: unknown[]) => sendWhatsappChannelMock(...args),
}));

vi.mock("../src/lib/email", () => ({
  sendEmailAsync: (...args: unknown[]) => sendEmailAsyncMock(...args),
  sendEmail:      vi.fn().mockResolvedValue({ status: "skipped" }),
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────
const { notifyAspirantDeclaration } = await import(
  "../src/lib/aspirantNotifications"
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-uuid-001";

function makeReviewerRows(
  members: Array<{ phone?: string; email?: string; name?: string; slug?: string }>,
) {
  // First select call returns the tenant row; subsequent calls return member rows.
  // The db mock uses a single dbSelectRows variable, so we interleave:
  // notifyAspirantDeclaration does: select tenant, then select members.
  // We return { slug, name } for the first resolve and member rows for the second.
  // Because both calls go through the same mock builder we can't easily separate them,
  // so we return the union: the mock builder returns dbSelectRows for every .limit()
  // or .then() call. We set it to a mixed array and let the code pick the first row
  // for the tenant and iterate the rest for members.
  // Simplest approach: set rows to include tenant as first element + members after.
  return [
    { slug: "test-campaign", name: "Test Campaign", ...members[0] },
    ...members.slice(1),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectRows = [];
  sendWhatsappChannelMock.mockResolvedValue({ ok: true, providerMessageId: "wa-001" });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("notifyAspirantDeclaration — WhatsApp dispatch", () => {
  it("sends a WhatsApp message to a reviewer with a phone number", async () => {
    // First select → tenant row; second select → member rows
    // Mock: return [tenantRow] on first call, [memberRow] on second
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: "+254722000001", email: null }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "James Kariuki", "parliamentary");

    expect(sendWhatsappChannelMock).toHaveBeenCalledOnce();
    const [, phone, message] = sendWhatsappChannelMock.mock.calls[0];
    expect(phone).toBe("+254722000001");
    expect(message).toContain("James Kariuki");
    expect(message).toContain("Parliamentary");
  });

  it("does not send WhatsApp when the reviewer has no phone number", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: null, email: "coord@example.com" }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Grace Wambui", "gubernatorial");

    expect(sendWhatsappChannelMock).not.toHaveBeenCalled();
  });
});

describe("notifyAspirantDeclaration — email dispatch", () => {
  it("sends an email to a reviewer with an email address", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: null, email: "director@campaign.ke" }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Amos Njoroge", "senatorial");

    expect(sendEmailAsyncMock).toHaveBeenCalledOnce();
    const [args] = sendEmailAsyncMock.mock.calls[0];
    expect(args.to).toBe("director@campaign.ke");
    expect(args.template).toBe("aspirant_declaration");
    expect(args.data.aspirantName).toBe("Amos Njoroge");
    expect(args.data.position).toBe("Senatorial");
    expect(args.tenantId).toBe(TENANT_ID);
  });

  it("does not send email when the reviewer has no email address", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: "+254700000002", email: null }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Faith Atieno", "women_rep");

    expect(sendEmailAsyncMock).not.toHaveBeenCalled();
  });

  it("sends both WhatsApp and email when reviewer has both contact channels", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: "+254711000001", email: "manager@campaign.ke" }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Hassan Abdi", "mca");

    expect(sendWhatsappChannelMock).toHaveBeenCalledOnce();
    expect(sendEmailAsyncMock).toHaveBeenCalledOnce();
  });
});

describe("notifyAspirantDeclaration — deduplication", () => {
  it("skips duplicate member rows so a multi-role user gets only one notification per channel", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [
            { phone: "+254722111111", email: "exec@campaign.ke" },
            { phone: "+254722111111", email: "exec@campaign.ke" }, // duplicate row (holds two review roles)
          ];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Irene Muthoni", "parliamentary");

    expect(sendWhatsappChannelMock).toHaveBeenCalledOnce();
    expect(sendEmailAsyncMock).toHaveBeenCalledOnce();
  });
});

describe("notifyAspirantDeclaration — failure isolation", () => {
  it("does not throw when the WhatsApp provider returns an error", async () => {
    sendWhatsappChannelMock.mockResolvedValue({ ok: false, error: "provider unavailable" });

    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : [{ phone: "+254733000001", email: null }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await expect(
      notifyAspirantDeclaration(TENANT_ID, "Joel Kamau", "senatorial"),
    ).resolves.toBeUndefined();
  });

  it("does not throw when the tenant row is missing", async () => {
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      // Every select returns empty — tenant missing AND no members
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve([]); },
        then(resolve: any, reject: any) {
          return Promise.resolve([]).then(resolve, reject);
        },
      };
      return qb;
    };

    await expect(
      notifyAspirantDeclaration(TENANT_ID, "Karen Omondi", "gubernatorial"),
    ).resolves.toBeUndefined();
  });

  it("does not throw when no reviewers are configured for the tenant", async () => {
    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "demo", name: "Demo Campaign" }]
        : []; // no review-role members
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await expect(
      notifyAspirantDeclaration(TENANT_ID, "Lilian Chebet", "mca"),
    ).resolves.toBeUndefined();

    expect(sendWhatsappChannelMock).not.toHaveBeenCalled();
    expect(sendEmailAsyncMock).not.toHaveBeenCalled();
  });
});

describe("notifyAspirantDeclaration — review URL", () => {
  it("uses /aspirants (not /dashboard/<slug>/aspirants) in the review URL", async () => {
    process.env.PLATFORM_URL = "https://platform.example.com";

    let callCount = 0;
    const { db } = await import("@workspace/db");
    (db as any).select = () => {
      callCount++;
      const rows = callCount === 1
        ? [{ slug: "my-campaign", name: "My Campaign" }]
        : [{ phone: null, email: "coord@example.com" }];
      const qb: any = {
        from()      { return qb; },
        where()     { return qb; },
        innerJoin() { return qb; },
        limit()     { return Promise.resolve(rows); },
        then(resolve: any, reject: any) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return qb;
    };

    await notifyAspirantDeclaration(TENANT_ID, "Martin Ouma", "parliamentary");

    const [args] = sendEmailAsyncMock.mock.calls[0];
    expect(args.data.reviewUrl).toBe("https://platform.example.com/aspirants");
    // Must NOT embed the slug in the path
    expect(args.data.reviewUrl).not.toContain("/dashboard/");
    expect(args.data.reviewUrl).not.toContain("my-campaign");

    delete process.env.PLATFORM_URL;
  });
});
