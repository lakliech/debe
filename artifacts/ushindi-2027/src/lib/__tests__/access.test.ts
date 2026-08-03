import { describe, it, expect } from "vitest";
import {
  deriveAccess,
  SECTION_RULES,
  ROLE_FAMILY,
  NO_ACCESS,
  NO_ROLES_LEVEL,
  type SectionLabel,
} from "../access";

/**
 * Every seeded role, with its authoritative level from lib/db/src/seeds/roles.ts.
 * If the seeds change, this table must change with them.
 */
const SEEDED: Array<[slug: string, level: number]> = [
  ["platform_admin", 0],
  ["super-admin", 1],
  ["presidential-candidate", 1],
  ["campaign-exec-director", 2],
  ["national-campaign-manager", 2],
  ["national-organising-director", 2],
  ["treasurer", 2],
  ["legal-officer", 2],
  ["data-protection-officer", 2],
  ["auditor", 2],
  ["security-admin", 2],
  ["county-coordinator", 3],
  ["finance-officer", 3],
  ["communications-officer", 3],
  ["content-approver", 3],
  ["verification-officer", 3],
  ["constituency-coordinator", 4],
  ["ward-coordinator", 5],
  ["polling-centre-coordinator", 6],
  ["polling-station-agent", 7],
  ["backup-polling-agent", 7],
  ["call-centre-agent", 8],
  ["volunteer", 8],
  ["donor", 8],
  ["public-supporter", 10],
  // Delegate roles named by API route guards.
  ["campaign-treasurer", 2],
  ["finance-manager", 3],
  ["returning-officer", 3],
  ["data-officer", 3],
  ["security-officer", 3],
  ["media-officer", 3],
  ["result-verifier", 4],
  ["national-tally-verifier", 4],
  ["county-verification-officer", 4],
  ["events-coordinator", 4],
  ["fact-checker", 4],
  ["polling-agent-supervisor", 5],
  ["polling-agent", 7],
];

const me = (roles: Array<{ roleSlug: string; roleLevel?: number }>, isGlobalAdmin = false) =>
  ({ isGlobalAdmin, roles });

const visible = (a: ReturnType<typeof deriveAccess>): SectionLabel[] =>
  (Object.keys(SECTION_RULES) as SectionLabel[]).filter((s) => SECTION_RULES[s](a));

describe("role catalogue integrity", () => {
  it("every seeded slug is classified into a family", () => {
    // A slug missing here loses its functional sections. This is the exact
    // drift that previously made the most privileged roles the least.
    const unclassified = SEEDED.map(([slug]) => slug).filter((s) => !ROLE_FAMILY[s]?.length);
    expect(unclassified).toEqual([]);
  });

  it("has no family entries for slugs that are not seeded", () => {
    const seededSlugs = new Set(SEEDED.map(([s]) => s));
    const phantom = Object.keys(ROLE_FAMILY).filter((s) => !seededSlugs.has(s));
    expect(phantom).toEqual([]);
  });
});

describe("deriveAccess", () => {
  it("treats a user with no roles as least privileged", () => {
    const a = deriveAccess(me([]));
    expect(a.level).toBe(NO_ROLES_LEVEL);
    expect(visible(a)).toEqual(["Campaign"]);
  });

  it("takes the minimum (most privileged) level across roles", () => {
    const a = deriveAccess(me([
      { roleSlug: "volunteer", roleLevel: 8 },
      { roleSlug: "county-coordinator", roleLevel: 3 },
    ]));
    expect(a.level).toBe(3);
  });

  it("degrades a missing level to least privileged, never to 0", () => {
    // Regression guard: a lookup miss must not escalate anyone to platform level.
    const a = deriveAccess(me([{ roleSlug: "super-admin" }]));
    expect(a.level).toBe(NO_ROLES_LEVEL);
    expect(SECTION_RULES.Platform(a)).toBe(false);
  });

  it("gives global admins every section", () => {
    const a = deriveAccess(me([], true));
    expect(a.isGlobalAdmin).toBe(true);
    expect(visible(a)).toEqual(Object.keys(SECTION_RULES));
  });

  it("ignores unknown slugs without granting or revoking level", () => {
    const a = deriveAccess(me([{ roleSlug: "not-a-real-role", roleLevel: 3 }]));
    expect(a.families.size).toBe(0);
    expect(a.level).toBe(3);
  });

  it("loading/error sentinel shows only the Campaign section", () => {
    expect(visible(NO_ACCESS)).toEqual(["Campaign"]);
  });
});

describe("section visibility per seeded role", () => {
  const EXPECTED: Record<string, SectionLabel[]> = {
    // Cross-tenant operator — everything, including Platform.
    "platform_admin": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin", "Platform"],
    // Top tenant roles — everything EXCEPT Platform (they are level 1, not 0).
    "super-admin": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "presidential-candidate": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "campaign-exec-director": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "national-campaign-manager": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "national-organising-director": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    // Finance back-office: level-2 treasurer also clears the senior override.
    "treasurer": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    // Compliance back-office: no finance remit despite being level 2.
    "legal-officer": ["Campaign", "Communications", "Election Operations", "Campaign Admin"],
    "data-protection-officer": ["Campaign", "Communications", "Election Operations", "Campaign Admin"],
    "auditor": ["Campaign", "Communications", "Election Operations", "Campaign Admin"],
    "security-admin": ["Campaign", "Communications", "Election Operations", "Campaign Admin"],
    // Field coordinators.
    "county-coordinator": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "constituency-coordinator": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    "ward-coordinator": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    // Finance officer is level 3 — below the senior override, so no comms/ops.
    "finance-officer": ["Campaign", "Finance", "Campaign Admin"],
    // Comms has no administrative or finance remit.
    "communications-officer": ["Campaign", "Communications"],
    "content-approver": ["Campaign", "Communications"],
    "verification-officer": ["Campaign", "Campaign Admin"],
    // Field agents.
    "polling-centre-coordinator": ["Campaign", "Election Operations"],
    "polling-station-agent": ["Campaign", "Election Operations"],
    "backup-polling-agent": ["Campaign", "Election Operations"],
    "call-centre-agent": ["Campaign", "Election Operations"],
    // Supporters see only the base section.
    "volunteer": ["Campaign"],
    "donor": ["Campaign"],
    "public-supporter": ["Campaign"],

    // ── Delegate roles ───────────────────────────────────────────────────────
    // Level-2 treasurer equivalent: clears the senior override like `treasurer`.
    "campaign-treasurer": ["Campaign", "Finance", "Communications", "Election Operations", "Campaign Admin"],
    // Level 3 finance back-office, same shape as `finance-officer`.
    "finance-manager": ["Campaign", "Finance", "Campaign Admin"],
    // Dual remit: results sign-off (agent) plus final expenditure (finance).
    "returning-officer": ["Campaign", "Finance", "Election Operations", "Campaign Admin"],
    // Compliance back-office below the level-2 override.
    "data-officer": ["Campaign", "Campaign Admin"],
    "security-officer": ["Campaign", "Campaign Admin"],
    // Comms remit only — no administrative or finance duties.
    "media-officer": ["Campaign", "Communications"],
    "events-coordinator": ["Campaign", "Communications"],
    "fact-checker": ["Campaign", "Communications"],
    // Field election roles.
    "result-verifier": ["Campaign", "Election Operations"],
    "national-tally-verifier": ["Campaign", "Election Operations"],
    "county-verification-officer": ["Campaign", "Election Operations"],
    "polling-agent-supervisor": ["Campaign", "Election Operations"],
    "polling-agent": ["Campaign", "Election Operations"],
  };

  it.each(SEEDED)("%s (level %i)", (slug, level) => {
    const a = deriveAccess(me([{ roleSlug: slug, roleLevel: level }]));
    expect(visible(a)).toEqual(EXPECTED[slug]);
  });

  it("no tenant role can reach the Platform section", () => {
    for (const [slug, level] of SEEDED) {
      if (slug === "platform_admin") continue;
      const a = deriveAccess(me([{ roleSlug: slug, roleLevel: level }]));
      expect(SECTION_RULES.Platform(a), `${slug} must not see Platform`).toBe(false);
    }
  });
});
