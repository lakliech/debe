/**
 * Tally eligibility — auto_validated votes count.
 *
 * Regression for "tally counts zero votes while submissions auto-validate":
 * /api/tally/compute must aggregate candidate votes whose parent submission
 * is verified OR auto_validated (TALLY_ELIGIBLE_STATUSES) and whose own
 * isVerified flag is set — exception/draft/submitted submissions never count.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/tally-auto-validated.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "tally-eligibility-clerk" }),
}));

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
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  tallySnapshotsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import tallyRouter from "../src/routes/tally";
import { backfillTallyEligibilityFlags } from "../src/lib/resultStatus";

const SLUG = `tally-eligibility-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let electionId: string;
let legacyElectionId: string;
let app: express.Express;

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Tally Eligibility Test", slug: SLUG })
    .returning();
  tenantId = tenant.id;

  const [election] = await db
    .insert(electionsTable)
    .values({ tenantId, name: "Eligibility Election", year: 2099 })
    .returning();
  electionId = election.id;

  // One candidate receives votes under three submission statuses; only
  // verified + auto_validated may count.
  const mk = async (status: string, votes: number, flagged: boolean) => {
    const [sub] = await db
      .insert(resultSubmissionsTable)
      .values({
        tenantId,
        pollingStationId: randomUUID(),
        electionId,
        agentId: randomUUID(),
        status,
      })
      .returning();
    await db.insert(submissionCandidateVotesTable).values({
      submissionId: sub.id,
      candidateName: "Candidate A",
      voteCount: votes,
      isVerified: flagged,
    });
  };
  await mk("verified", 100, true);
  await mk("auto_validated", 50, true);
  await mk("exception", 999, false);

  // Legacy row: auto_validated BEFORE the lockstep sync existed — its votes
  // sit at the schema default isVerified=false. Only the backfill repairs it.
  const [legacyElection] = await db
    .insert(electionsTable)
    .values({ tenantId, name: "Legacy Election", year: 2098 })
    .returning();
  legacyElectionId = legacyElection.id;

  const [legacySub] = await db
    .insert(resultSubmissionsTable)
    .values({
      tenantId,
      pollingStationId: randomUUID(),
      electionId: legacyElectionId,
      agentId: randomUUID(),
      status: "auto_validated",
    })
    .returning();
  await db.insert(submissionCandidateVotesTable).values({
    submissionId: legacySub.id,
    candidateName: "Legacy Candidate",
    voteCount: 70,
    isVerified: false,
  });

  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/", tallyRouter);
});

afterAll(async () => {
  await db.delete(tallySnapshotsTable).where(eq(tallySnapshotsTable.tenantId, tenantId));
  // Tenant cascade removes election, submissions, and votes.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("tally eligibility", () => {
  it("counts verified and auto_validated votes, excludes exceptions", async () => {
    const res = await request(app).post("/compute").send({ electionId });
    expect(res.status).toBe(200);
    expect(res.body.computed).toBe(1);
    expect(res.body.snapshots[0].candidateName).toBe("Candidate A");
    expect(res.body.snapshots[0].votes).toBe(150);
    // Stations verified = submissions in a tally-eligible status (2 of 3).
    expect(res.body.snapshots[0].stationsVerified).toBe(2);
  });

  it("backfill repairs legacy auto_validated rows so they count", async () => {
    // Before the backfill, the legacy row is invisible to the tally.
    const before = await request(app).post("/compute").send({ electionId: legacyElectionId });
    expect(before.status).toBe(200);
    expect(before.body.computed).toBe(0);

    await backfillTallyEligibilityFlags(db);

    const after = await request(app).post("/compute").send({ electionId: legacyElectionId });
    expect(after.status).toBe(200);
    expect(after.body.computed).toBe(1);
    expect(after.body.snapshots[0].votes).toBe(70);
  });
});
