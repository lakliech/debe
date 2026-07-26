/**
 * Unit tests: Tally calculation logic
 * Tests arithmetic validation, vote aggregation, and duplicate detection.
 * Run: pnpm --filter @workspace/api-server exec vitest run
 */
import { describe, it, expect } from "vitest";

// ── Vote arithmetic validation helpers ────────────────────────────────────
function validateVoteCounts(params: {
  candidateVotes: number[];
  totalVotes: number;
  rejectedBallots: number;
  registeredVoters: number;
}): { valid: boolean; flags: string[] } {
  const flags: string[] = [];
  const { candidateVotes, totalVotes, rejectedBallots, registeredVoters } = params;

  const sumCandidates = candidateVotes.reduce((a, b) => a + b, 0);
  const expectedTotal = sumCandidates + rejectedBallots;

  if (expectedTotal !== totalVotes) {
    flags.push(`Arithmetic mismatch: candidates(${sumCandidates}) + rejected(${rejectedBallots}) = ${expectedTotal} ≠ totalVotes(${totalVotes})`);
  }
  if (totalVotes > registeredVoters) {
    flags.push(`Overvote: totalVotes(${totalVotes}) > registeredVoters(${registeredVoters})`);
  }
  if (candidateVotes.some((v) => v < 0)) {
    flags.push("Negative vote count detected");
  }
  if (rejectedBallots < 0) {
    flags.push("Negative rejected ballots");
  }
  return { valid: flags.length === 0, flags };
}

// ── Tally aggregation ─────────────────────────────────────────────────────
function aggregateVotes(
  submissions: Array<{ candidateId: string; voteCount: number; stationId: string }>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { candidateId, voteCount } of submissions) {
    totals.set(candidateId, (totals.get(candidateId) ?? 0) + voteCount);
  }
  return totals;
}

// ── Duplicate detection ────────────────────────────────────────────────────
function detectDuplicates(
  submissions: Array<{ stationId: string; version: number }>
): string[] {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const { stationId, version } of submissions) {
    const existing = seen.get(stationId);
    if (existing !== undefined && existing !== version) {
      duplicates.push(stationId);
    } else {
      seen.set(stationId, version);
    }
  }
  return duplicates;
}

// ── Verification state machine ─────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["auto_validated", "exception"],
  auto_validated: ["constituency_verification", "exception"],
  exception: ["polling_centre_review", "constituency_verification"],
  polling_centre_review: ["constituency_verification", "exception"],
  constituency_verification: ["county_verification", "constituency_queried"],
  constituency_queried: ["constituency_verification"],
  county_verification: ["national_verification", "county_queried"],
  county_queried: ["county_verification"],
  national_verification: ["legal_review", "verified"],
  legal_review: ["verified"],
  verified: [],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Vote arithmetic validation", () => {
  it("passes valid submission", () => {
    const result = validateVoteCounts({
      candidateVotes: [1000, 800, 200],
      totalVotes: 2050,
      rejectedBallots: 50,
      registeredVoters: 3000,
    });
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it("flags arithmetic mismatch", () => {
    const result = validateVoteCounts({
      candidateVotes: [1000, 800, 200],
      totalVotes: 2100, // wrong — should be 2050
      rejectedBallots: 50,
      registeredVoters: 3000,
    });
    expect(result.valid).toBe(false);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatch(/Arithmetic mismatch/);
  });

  it("flags overvote", () => {
    const result = validateVoteCounts({
      candidateVotes: [3000, 500],
      totalVotes: 3600,
      rejectedBallots: 100,
      registeredVoters: 2000, // fewer than total votes
    });
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("Overvote"))).toBe(true);
  });

  it("flags negative vote count", () => {
    const result = validateVoteCounts({
      candidateVotes: [1000, -10],
      totalVotes: 990,
      rejectedBallots: 0,
      registeredVoters: 2000,
    });
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("Negative vote count"))).toBe(true);
  });

  it("handles zero votes", () => {
    const result = validateVoteCounts({
      candidateVotes: [0, 0, 0],
      totalVotes: 0,
      rejectedBallots: 0,
      registeredVoters: 500,
    });
    expect(result.valid).toBe(true);
  });
});

describe("Tally aggregation", () => {
  it("aggregates votes across stations", () => {
    const submissions = [
      { candidateId: "c1", voteCount: 500, stationId: "s1" },
      { candidateId: "c2", voteCount: 300, stationId: "s1" },
      { candidateId: "c1", voteCount: 400, stationId: "s2" },
      { candidateId: "c2", voteCount: 600, stationId: "s2" },
    ];
    const totals = aggregateVotes(submissions);
    expect(totals.get("c1")).toBe(900);
    expect(totals.get("c2")).toBe(900);
  });

  it("handles single station", () => {
    const submissions = [
      { candidateId: "c1", voteCount: 200, stationId: "s1" },
    ];
    const totals = aggregateVotes(submissions);
    expect(totals.get("c1")).toBe(200);
    expect(totals.size).toBe(1);
  });

  it("returns empty map for no submissions", () => {
    const totals = aggregateVotes([]);
    expect(totals.size).toBe(0);
  });
});

describe("Duplicate detection", () => {
  it("detects duplicate station submissions", () => {
    const submissions = [
      { stationId: "s1", version: 1 },
      { stationId: "s1", version: 2 }, // duplicate with different version
    ];
    const dups = detectDuplicates(submissions);
    expect(dups).toContain("s1");
  });

  it("allows single submission per station", () => {
    const submissions = [
      { stationId: "s1", version: 1 },
      { stationId: "s2", version: 1 },
    ];
    const dups = detectDuplicates(submissions);
    expect(dups).toHaveLength(0);
  });

  it("does not flag same version (idempotent re-submission)", () => {
    const submissions = [
      { stationId: "s1", version: 1 },
      { stationId: "s1", version: 1 }, // same version — idempotent
    ];
    const dups = detectDuplicates(submissions);
    expect(dups).toHaveLength(0);
  });
});

describe("Verification state machine", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });

  it("allows submitted → auto_validated", () => {
    expect(canTransition("submitted", "auto_validated")).toBe(true);
  });

  it("allows submitted → exception", () => {
    expect(canTransition("submitted", "exception")).toBe(true);
  });

  it("disallows draft → verified (skipping steps)", () => {
    expect(canTransition("draft", "verified")).toBe(false);
  });

  it("disallows backward transition", () => {
    expect(canTransition("verified", "draft")).toBe(false);
  });

  it("disallows verified → any state", () => {
    expect(canTransition("verified", "national_verification")).toBe(false);
    expect(canTransition("verified", "legal_review")).toBe(false);
  });

  it("allows legal_review → verified (final step)", () => {
    expect(canTransition("legal_review", "verified")).toBe(true);
  });
});

describe("Result correction history", () => {
  interface Correction {
    field: string;
    oldValue: number;
    newValue: number;
    correctedBy: string;
    correctedAt: Date;
  }

  function applyCorrection(
    current: Record<string, number>,
    correction: Correction
  ): Record<string, number> {
    if (current[correction.field] !== correction.oldValue) {
      throw new Error(
        `Stale correction: expected ${correction.oldValue}, found ${current[correction.field]}`
      );
    }
    return { ...current, [correction.field]: correction.newValue };
  }

  it("applies a valid correction", () => {
    const current = { candidateA: 100, candidateB: 200 };
    const corrected = applyCorrection(current, {
      field: "candidateA",
      oldValue: 100,
      newValue: 105,
      correctedBy: "user-1",
      correctedAt: new Date(),
    });
    expect(corrected.candidateA).toBe(105);
    expect(corrected.candidateB).toBe(200); // unchanged
  });

  it("rejects stale correction", () => {
    const current = { candidateA: 200 }; // already updated
    expect(() =>
      applyCorrection(current, {
        field: "candidateA",
        oldValue: 100, // stale — thinks value is still 100
        newValue: 105,
        correctedBy: "user-1",
        correctedAt: new Date(),
      })
    ).toThrow("Stale correction");
  });
});

describe("Agent training progress", () => {
  function computeTrainingStatus(
    enrollments: Array<{ status: string; required: boolean }>
  ): { complete: boolean; percentage: number } {
    const required = enrollments.filter((e) => e.required);
    if (required.length === 0) return { complete: true, percentage: 100 };
    const passed = required.filter((e) => e.status === "passed").length;
    const percentage = Math.round((passed / required.length) * 100);
    return { complete: passed === required.length, percentage };
  }

  it("marks complete when all required courses passed", () => {
    const result = computeTrainingStatus([
      { status: "passed", required: true },
      { status: "passed", required: true },
      { status: "failed", required: false },
    ]);
    expect(result.complete).toBe(true);
    expect(result.percentage).toBe(100);
  });

  it("marks incomplete when some required courses not passed", () => {
    const result = computeTrainingStatus([
      { status: "passed", required: true },
      { status: "enrolled", required: true },
    ]);
    expect(result.complete).toBe(false);
    expect(result.percentage).toBe(50);
  });

  it("handles no enrollments", () => {
    const result = computeTrainingStatus([]);
    expect(result.complete).toBe(true);
    expect(result.percentage).toBe(100);
  });
});

describe("Incident escalation logic", () => {
  function shouldEscalate(incident: {
    severity: string;
    reportedAt: Date;
    status: string;
  }): boolean {
    if (incident.status === "resolved") return false;
    if (incident.severity === "critical") return true;
    if (incident.severity === "high") {
      const ageHours = (Date.now() - incident.reportedAt.getTime()) / 3600000;
      return ageHours > 2;
    }
    return false;
  }

  it("escalates critical incidents immediately", () => {
    expect(
      shouldEscalate({ severity: "critical", reportedAt: new Date(), status: "open" })
    ).toBe(true);
  });

  it("escalates stale high-severity incidents", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    expect(
      shouldEscalate({ severity: "high", reportedAt: threeHoursAgo, status: "open" })
    ).toBe(true);
  });

  it("does not escalate fresh high-severity incidents", () => {
    expect(
      shouldEscalate({ severity: "high", reportedAt: new Date(), status: "open" })
    ).toBe(false);
  });

  it("does not escalate resolved incidents", () => {
    expect(
      shouldEscalate({ severity: "critical", reportedAt: new Date(), status: "resolved" })
    ).toBe(false);
  });
});
