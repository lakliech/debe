/**
 * electionLevel.ts — Election level metadata for Kenyan elective positions.
 *
 * Maps each IEBC election level to:
 *   - The correct IEBC result form name (e.g. "Form 34A")
 *   - The geography hierarchy levels relevant to that race
 *   - A suggested position title for the branding config
 *
 * Used by the Branding admin page, TallyDashboard, and AgentResultForm
 * to adapt UI without code changes.
 */

export const ELECTION_LEVELS = [
  "Presidential",
  "Gubernatorial",
  "Senatorial",
  "Women Rep",
  "MP",
  "MCA",
] as const;

export type ElectionLevel = typeof ELECTION_LEVELS[number];

/** Geography tally levels shown in the TallyDashboard for each election type. */
export const LEVEL_OPTIONS_BY_ELECTION: Record<ElectionLevel, readonly string[]> = {
  Presidential: ["national", "county", "constituency", "ward"],
  Gubernatorial: ["county", "constituency", "ward"],
  Senatorial: ["county", "constituency", "ward"],
  "Women Rep": ["county", "constituency", "ward"],
  MP: ["constituency", "ward"],
  MCA: ["ward"],
};

/** IEBC result form name for each election level. */
export const FORM_NAME_BY_ELECTION: Record<ElectionLevel, string> = {
  Presidential: "Form 34A",
  Gubernatorial: "Form 37A",
  Senatorial: "Form 37C",
  "Women Rep": "Form 37B",
  MP: "Form 35A",
  MCA: "Form 36A",
};

/** Default position title auto-filled when an election level is selected. */
export const POSITION_TITLE_BY_ELECTION: Record<ElectionLevel, string> = {
  Presidential: "Presidential Candidate",
  Gubernatorial: "Governor",
  Senatorial: "Senator",
  "Women Rep": "Women Representative",
  MP: "Member of Parliament",
  MCA: "Member of County Assembly",
};

/** Return the IEBC form name for a given election level string, falling back gracefully. */
export function getFormName(level: string | null | undefined): string {
  if (!level) return FORM_NAME_BY_ELECTION.Presidential;
  return FORM_NAME_BY_ELECTION[level as ElectionLevel] ?? FORM_NAME_BY_ELECTION.Presidential;
}

/** Return the geography tally levels for a given election level string. */
export function getLevelOptions(level: string | null | undefined): readonly string[] {
  if (!level) return LEVEL_OPTIONS_BY_ELECTION.Presidential;
  return LEVEL_OPTIONS_BY_ELECTION[level as ElectionLevel] ?? LEVEL_OPTIONS_BY_ELECTION.Presidential;
}

/** Validate a string is a known election level. */
export function isElectionLevel(v: string): v is ElectionLevel {
  return ELECTION_LEVELS.includes(v as ElectionLevel);
}

/**
 * Tally levels per tenant seatType (authoritative scope from the campaign
 * record). Falls back to the branding electionLevel string for legacy
 * scope-less tenants.
 */
export const LEVEL_OPTIONS_BY_SEAT: Record<string, readonly string[]> = {
  presidential: LEVEL_OPTIONS_BY_ELECTION.Presidential,
  gubernatorial: LEVEL_OPTIONS_BY_ELECTION.Gubernatorial,
  senator: LEVEL_OPTIONS_BY_ELECTION.Senatorial,
  women_rep: LEVEL_OPTIONS_BY_ELECTION["Women Rep"],
  mp: LEVEL_OPTIONS_BY_ELECTION.MP,
  mca: LEVEL_OPTIONS_BY_ELECTION.MCA,
};

/** Level options from the authoritative seatType when set, else branding text. */
export function getLevelOptionsForScope(
  seatType: string | null | undefined,
  electionLevel: string | null | undefined,
): readonly string[] {
  if (seatType && LEVEL_OPTIONS_BY_SEAT[seatType]) return LEVEL_OPTIONS_BY_SEAT[seatType];
  return getLevelOptions(electionLevel);
}
