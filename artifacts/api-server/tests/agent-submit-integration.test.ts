/**
 * Integration tests — POST /submissions/agent-submit full request lifecycle.
 *
 * These tests run against a real (test) database and exercise the complete
 * request path: Zod validation → tenant scope → DB insert/update → auto-
 * validation → response serialisation.
 *
 * Scenarios covered:
 *  0. Mobile payload type-safety — unexpected field types from the app are
 *     rejected before any DB write (the core regression risk for election day)
 *  1. Successful create+submit — 201 with autoValidation payload
 *  2. offlineCapturedAt coercion — string datetime → Date comparison works
 *  3. Offline idempotency — same deviceId + offlineCapturedAt on a non-draft
 *     submission returns 200 { alreadySubmitted: true } without re-inserting
 *  4. POST /submissions duplicate guard — 409 when a non-draft exists and
 *     forceNew is absent (agent-submit never 409s, but the sister endpoint does)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/agent-submit-integration.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

// ─── Mock Clerk (getAuth is called by requireAuth in the router) ──────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "agent-submit-integration-clerk" }),
}));

// ─── Bypass RBAC middleware (role enforcement is tested elsewhere) ────────────
vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));

import { db } from "@workspace/db";
import {
  tenantsTable,
  electionsTable,
  pollingAgentsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  campaignStationProfilesTable,
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  submissionFormImagesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import electionResultsRouter from "../src/routes/electionResults";

// ─── Unique prefix avoids collisions with parallel test runs ─────────────────
const SLUG = `asi-${randomUUID().slice(0, 8)}`;

let tenantId: string;
let electionId: string;
let agentId: string;
let stationId: string;
let countyId: string;
let constituencyId: string;
let wardId: string;
let centreId: string;
let app: express.Express;

// ─── Test-database fixtures ───────────────────────────────────────────────────
beforeAll(async () => {
  const uniq = 800000 + Math.floor(Math.random() * 99999);

  // Tenant
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "ASI Test Campaign", slug: SLUG })
    .returning();
  tenantId = tenant.id;

  // Shared geography chain (no tenant column)
  const [county] = await db
    .insert(countiesTable)
    .values({ code: uniq, name: `ASI County ${uniq}` })
    .returning();
  countyId = county.id;

  const [constituency] = await db
    .insert(constituenciesTable)
    .values({ code: uniq + 1, name: `ASI Con ${uniq}`, countyId })
    .returning();
  constituencyId = constituency.id;

  const [ward] = await db
    .insert(wardsTable)
    .values({ code: uniq + 2, name: `ASI Ward ${uniq}`, constituencyId, countyId })
    .returning();
  wardId = ward.id;

  const [centre] = await db
    .insert(pollingCentresTable)
    .values({ name: `ASI Centre ${uniq}`, wardId, constituencyId, countyId })
    .returning();
  centreId = centre.id;

  const [station] = await db
    .insert(pollingStationsTable)
    .values({
      code: `ASI-${uniq}`,
      name: `ASI Station ${uniq}`,
      centreId,
      wardId,
      constituencyId,
      countyId,
    })
    .returning();
  stationId = station.id;

  // Election + agent (tenant-owned)
  const [election] = await db
    .insert(electionsTable)
    .values({ tenantId, name: "ASI Election", year: 2099 })
    .returning();
  electionId = election.id;

  const [agent] = await db
    .insert(pollingAgentsTable)
    .values({ tenantId, fullName: "ASI Agent", phoneNumber: "254700000099" })
    .returning();
  agentId = agent.id;

  // Register the station to this campaign with the agent as primary
  await db.insert(campaignStationProfilesTable).values({
    tenantId,
    stationId,
    primaryAgentId: agentId,
  });

  // Build a minimal Express app that mimics how the real server mounts the router
  app = express();
  app.use(express.json());
  // Inject the resolved tenant (normally done by resolveTenant middleware)
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/", electionResultsRouter);
});

afterAll(async () => {
  // Unwind in FK-safe order: campaign profiles → geography → tenant (cascade
  // removes election, agent, submissions, votes, images, and audit steps).
  await db
    .delete(campaignStationProfilesTable)
    .where(eq(campaignStationProfilesTable.tenantId, tenantId));
  await db
    .delete(pollingStationsTable)
    .where(eq(pollingStationsTable.id, stationId));
  await db.delete(pollingCentresTable).where(eq(pollingCentresTable.id, centreId));
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  await db.delete(constituenciesTable).where(eq(constituenciesTable.id, constituencyId));
  await db.delete(countiesTable).where(eq(countiesTable.id, countyId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Build a valid agent-submit body using the shared fixture IDs. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    pollingStationId: stationId,
    electionId,
    agentId,
    registeredVoters: 500,
    ballotsIssued: 400,
    totalVotesCast: 380,
    totalValidVotes: 360,
    rejectedBallots: 10,
    spoiltBallots: 10,
    unusedBallots: 0,
    candidateVotes: [
      { candidateName: "Alice Wanjiku", voteCount: 210 },
      { candidateName: "Bob Otieno", voteCount: 150 },
    ],
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("agent-submit — successful create+submit cycle", () => {
  it("returns 201 with submission and autoValidation", async () => {
    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId: `dev-create-${randomUUID()}` }));

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("submission");
    expect(res.body).toHaveProperty("autoValidation");

    const { submission, autoValidation } = res.body;

    // Submission fields
    expect(submission.pollingStationId).toBe(stationId);
    expect(submission.electionId).toBe(electionId);
    expect(submission.agentId).toBe(agentId);
    // Status must be either auto_validated or exception — never draft or submitted
    expect(["auto_validated", "exception"]).toContain(submission.status);

    // autoValidation shape
    expect(typeof autoValidation.valid).toBe("boolean");
    expect(Array.isArray(autoValidation.flags)).toBe(true);
  });

  it("persists candidateVotes to the database", async () => {
    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(
        validBody({
          deviceId: `dev-votes-${randomUUID()}`,
          candidateVotes: [
            { candidateName: "Candidate X", voteCount: 300 },
            { candidateName: "Candidate Y", voteCount: 60 },
          ],
        }),
      );

    expect(res.status).toBe(201);
    const { id: submissionId } = res.body.submission;

    const votes = await db
      .select()
      .from(submissionCandidateVotesTable)
      .where(eq(submissionCandidateVotesTable.submissionId, submissionId));

    expect(votes).toHaveLength(2);
    const names = votes.map((v) => v.candidateName).sort();
    expect(names).toEqual(["Candidate X", "Candidate Y"]);
  });

  it("registers formPhotoUrl as a form_page_1 image row", async () => {
    const photoUrl = "uploads/test-form-photo.jpg";
    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(
        validBody({
          deviceId: `dev-photo-${randomUUID()}`,
          formPhotoUrl: photoUrl,
        }),
      );

    expect(res.status).toBe(201);
    const { id: submissionId } = res.body.submission;

    const images = await db
      .select()
      .from(submissionFormImagesTable)
      .where(eq(submissionFormImagesTable.submissionId, submissionId));

    const formPage = images.find((img) => img.imageType === "form_page_1");
    expect(formPage).toBeDefined();
    expect(formPage!.objectPath).toBe(photoUrl);
  });
});

describe("agent-submit — offlineCapturedAt coercion", () => {
  it("accepts an ISO 8601 datetime string and stores it as a Date", async () => {
    const capturedAt = "2027-01-15T08:30:00+03:00";

    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(
        validBody({
          deviceId: `dev-oca-${randomUUID()}`,
          offlineCapturedAt: capturedAt,
        }),
      );

    expect(res.status).toBe(201);
    const { id: submissionId } = res.body.submission;

    const [row] = await db
      .select({ offlineCapturedAt: resultSubmissionsTable.offlineCapturedAt })
      .from(resultSubmissionsTable)
      .where(eq(resultSubmissionsTable.id, submissionId));

    // The stored value should round-trip to the same instant
    expect(row.offlineCapturedAt).not.toBeNull();
    expect(new Date(row.offlineCapturedAt!).toISOString()).toBe(
      new Date(capturedAt).toISOString(),
    );
  });

  it("rejects a plain date string (no time component) → 400", async () => {
    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(
        validBody({
          deviceId: `dev-oca-bad-${randomUUID()}`,
          offlineCapturedAt: "2027-01-15", // no time — fails z.string().datetime()
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
  });
});

describe("agent-submit — offline idempotency", () => {
  it("returns 200 { alreadySubmitted: true } when same deviceId + offlineCapturedAt are resent after a non-draft submission", async () => {
    const deviceId = `dev-idem-${randomUUID()}`;
    const offlineCapturedAt = "2027-03-01T07:00:00+03:00";

    // First call: creates and submits the record
    const first = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId, offlineCapturedAt }));

    expect(first.status).toBe(201);
    expect(["auto_validated", "exception"]).toContain(first.body.submission.status);
    const firstSubmissionId = first.body.submission.id;

    // Second call: same deviceId + offlineCapturedAt — idempotency guard fires
    const second = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId, offlineCapturedAt }));

    expect(second.status).toBe(200);
    expect(second.body.alreadySubmitted).toBe(true);
    expect(second.body.submissionId).toBe(firstSubmissionId);
    // Status echoes back so the client knows whether to show the success state
    expect(["auto_validated", "exception"]).toContain(second.body.status);
  });

  it("does NOT trigger idempotency when offlineCapturedAt differs (creates a new version)", async () => {
    const deviceId = `dev-idem2-${randomUUID()}`;

    const first = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId, offlineCapturedAt: "2027-03-02T07:00:00+03:00" }));
    expect(first.status).toBe(201);

    // Different timestamp → not a replay → creates a new submission version
    const second = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId, offlineCapturedAt: "2027-03-02T09:00:00+03:00" }));
    expect(second.status).toBe(201);
    expect(second.body.alreadySubmitted).toBeUndefined();
    // IDs must differ because this is a fresh submission, not an idempotent echo
    expect(second.body.submission.id).not.toBe(first.body.submission.id);
  });
});

describe("POST /submissions — duplicate guard returns 409", () => {
  it("rejects a second POST /submissions for the same station+election+agent when the first is non-draft", async () => {
    // Create a non-draft submission via agent-submit (avoids manual status manipulation)
    const deviceId = `dev-dup-${randomUUID()}`;
    const first = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId }));
    expect(first.status).toBe(201);
    expect(["auto_validated", "exception"]).toContain(first.body.submission.status);

    // Now POST to /submissions for the same station+election+agent without forceNew
    const dup = await request(app)
      .post("/submissions")
      .send({
        pollingStationId: stationId,
        electionId,
        agentId,
      });

    expect(dup.status).toBe(409);
    expect(dup.body).toHaveProperty("error");
    expect(dup.body.error).toMatch(/already exists/i);
  });

  it("allows a second POST /submissions when forceNew:true is sent", async () => {
    const deviceId = `dev-force-${randomUUID()}`;
    const first = await request(app)
      .post("/submissions/agent-submit")
      .send(validBody({ deviceId }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/submissions")
      .send({
        pollingStationId: stationId,
        electionId,
        agentId,
        forceNew: true,
      });

    // forceNew bypasses the 409 guard — status 201 (draft created)
    expect(second.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile payload type-safety — the primary regression risk for election day
//
// Mobile apps (React Native / PWA offline sync) sometimes serialize numbers as
// strings, send null for optional fields, or emit decimal vote counts when the
// tally form allows fractional input. These tests prove the Zod schema stops
// every such payload before a single DB row is written.
// ═══════════════════════════════════════════════════════════════════════════════

/** Count rows in result_submissions scoped to this test's tenant. */
async function submissionCount(): Promise<number> {
  const rows = await db
    .select({ id: resultSubmissionsTable.id })
    .from(resultSubmissionsTable)
    .where(eq(resultSubmissionsTable.tenantId, tenantId));
  return rows.length;
}

/**
 * Assert the response is a Zod 400 with a structured errors array, and that
 * no DB write was performed.
 */
async function expectTypeSafetyRejection(
  payload: Record<string, unknown>,
  countBefore: number,
) {
  const res = await request(app)
    .post("/submissions/agent-submit")
    .send(payload);

  expect(res.status).toBe(400);
  expect(res.body).toHaveProperty("error", "Validation failed");
  expect(Array.isArray(res.body.errors)).toBe(true);
  expect(res.body.errors.length).toBeGreaterThan(0);

  // No submission row should have been written
  const countAfter = await submissionCount();
  expect(countAfter).toBe(countBefore);

  return res;
}

describe("agent-submit — mobile payload type-safety (unexpected field types)", () => {
  /** Snapshot submission count once; all bad-payload tests share it. */
  let baseCount: number;

  beforeAll(async () => {
    baseCount = await submissionCount();
  });

  // ── Required UUID fields ────────────────────────────────────────────────────

  it("pollingStationId as plain string (not UUID) → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      { pollingStationId: "STATION-001", electionId, agentId },
      baseCount,
    );
  });

  it("electionId as integer → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      { pollingStationId: stationId, electionId: 42 as any, agentId },
      baseCount,
    );
  });

  it("agentId as null → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      { pollingStationId: stationId, electionId, agentId: null as any },
      baseCount,
    );
  });

  // ── Numeric ballot fields sent as strings (common mobile serialization bug) ─

  it("totalVotesCast as a numeric string → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        totalVotesCast: "350" as any,
      },
      baseCount,
    );
  });

  it("registeredVoters as a decimal (non-integer) → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        registeredVoters: 500.5 as any,
      },
      baseCount,
    );
  });

  it("ballotsIssued as null → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        ballotsIssued: null as any,
      },
      baseCount,
    );
  });

  it("rejectedBallots as a negative integer → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        rejectedBallots: -5,
      },
      baseCount,
    );
  });

  // ── candidateVotes array — malformed entries ────────────────────────────────

  it("candidateVotes[].voteCount as a string → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ candidateName: "Alice", voteCount: "many" as any }],
      },
      baseCount,
    );
  });

  it("candidateVotes[].voteCount as a decimal → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ candidateName: "Alice", voteCount: 100.5 as any }],
      },
      baseCount,
    );
  });

  it("candidateVotes[].voteCount as negative → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ candidateName: "Alice", voteCount: -1 }],
      },
      baseCount,
    );
  });

  it("candidateVotes[].candidateName missing → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ voteCount: 100 }],
      },
      baseCount,
    );
  });

  it("candidateVotes[].candidateName as empty string → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ candidateName: "", voteCount: 100 }],
      },
      baseCount,
    );
  });

  it("candidateVotes[].candidateId present but not a UUID → 400, no DB write", async () => {
    await expectTypeSafetyRejection(
      {
        pollingStationId: stationId,
        electionId,
        agentId,
        candidateVotes: [{ candidateId: "CAND-123", candidateName: "Alice", voteCount: 100 }],
      },
      baseCount,
    );
  });

  // ── Entire body missing → 400 ───────────────────────────────────────────────

  it("empty body → 400, no DB write", async () => {
    await expectTypeSafetyRejection({}, baseCount);
  });

  // ── Control: well-formed payload passes validation (not 400) ───────────────

  it("valid payload with all ballot fields and candidateVotes → not 400", async () => {
    const res = await request(app)
      .post("/submissions/agent-submit")
      .send(
        validBody({
          deviceId: `dev-typesafe-control-${randomUUID()}`,
          candidateVotes: [
            { candidateName: "Alice Wanjiku", voteCount: 300 },
            { candidateName: "Bob Otieno", voteCount: 60 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.autoValidation).toBeDefined();
  });
});
