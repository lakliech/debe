/**
 * Verify-endpoint vote-flag sync — regression for "tally counts zero votes".
 *
 * The tally (/api/tally/compute) aggregates only
 * submission_candidate_votes.is_verified = true rows. The verify endpoint is
 * the ONLY writer of a submission's status, and it used to update just
 * result_submissions.status — leaving every vote's is_verified at its default
 * false, so the tally returned zero forever.
 *
 * Property under test: POST /submissions/:id/verify flips the submission's
 * candidate votes to is_verified = (toStatus === 'verified') — in BOTH
 * directions — inside the same transaction as the status change.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/verify-syncs-vote-flags.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "verify-sync-test-clerk" }),
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
} from "@workspace/db";
import { eq } from "drizzle-orm";
import electionResultsRouter from "../src/routes/electionResults";

const SLUG = `verify-sync-test-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let submissionId: string;
let app: express.Express;

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Verify Sync Test", slug: SLUG })
    .returning();
  tenantId = tenant.id;

  const [election] = await db
    .insert(electionsTable)
    .values({ tenantId, name: "Test Election", year: 2099 })
    .returning();

  const [submission] = await db
    .insert(resultSubmissionsTable)
    .values({
      tenantId,
      pollingStationId: randomUUID(),
      electionId: election.id,
      agentId: randomUUID(),
      status: "submitted",
    })
    .returning();
  submissionId = submission.id;

  await db.insert(submissionCandidateVotesTable).values([
    { submissionId, candidateName: "Candidate A", voteCount: 10 },
    { submissionId, candidateName: "Candidate B", voteCount: 20 },
  ]);

  app = express();
  app.use(express.json());
  // Stand in for resolveTenant: attach the tenant the fixtures belong to.
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/", electionResultsRouter);
});

afterAll(async () => {
  // Tenant cascade removes election, submission, votes, and audit steps.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

async function verifiedVoteCounts(): Promise<Array<{ name: string; verified: boolean }>> {
  const rows = await db
    .select({
      name: submissionCandidateVotesTable.candidateName,
      verified: submissionCandidateVotesTable.isVerified,
    })
    .from(submissionCandidateVotesTable)
    .where(eq(submissionCandidateVotesTable.submissionId, submissionId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

describe("verify endpoint syncs candidate-vote flags", () => {
  it("flags votes verified when the submission becomes verified", async () => {
    const res = await request(app)
      .post(`/submissions/${submissionId}/verify`)
      .send({ action: "approved", toStatus: "verified" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verified");

    const votes = await verifiedVoteCounts();
    expect(votes).toEqual([
      { name: "Candidate A", verified: true },
      { name: "Candidate B", verified: true },
    ]);
  });

  it("unflags votes when the submission leaves verified status", async () => {
    const res = await request(app)
      .post(`/submissions/${submissionId}/verify`)
      .send({ action: "queried", toStatus: "queried", queriedFields: ["totalValidVotes"] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("queried");

    const votes = await verifiedVoteCounts();
    expect(votes).toEqual([
      { name: "Candidate A", verified: false },
      { name: "Candidate B", verified: false },
    ]);
  });
});
