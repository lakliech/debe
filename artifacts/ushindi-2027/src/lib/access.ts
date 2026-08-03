/**
 * Sidebar access derivation.
 *
 * This is presentation-only: it decides which nav sections are *shown*. It is
 * NOT an authorization boundary — every API route independently enforces its
 * own `requireRoles` / `requireLevel` guard server-side. Hiding a section here
 * never makes an endpoint safe, and showing one never grants data access.
 *
 * ── Privilege scale ──────────────────────────────────────────────────────────
 * `level` mirrors the server's `roles.level` column: LOWER = MORE privileged.
 *   0   platform operator (cross-tenant)
 *   1   most privileged tenant role (campaign super-admin, candidate)
 *   10  least privileged
 *   999 sentinel for "no roles at all"
 * Gates are therefore written `level <= N`, never `>=`.
 *
 * The level always comes from the server (`roleLevel` on each role in
 * /api/users/me). This module must never hardcode a slug→level table: a
 * client-side copy silently drifts from the DB seeds, and a lookup miss that
 * falls back to the wrong end of the scale turns the most privileged roles into
 * the least privileged ones.
 */

/** A role's functional remit, used where a numeric level cannot express intent. */
export type Family =
  | "finance" | "comms" | "compliance" | "agent" | "coordinator" | "leadership" | "supporter";

/**
 * Slugs MUST match `lib/db/src/seeds/roles.ts` exactly. A slug missing from
 * this map simply has no family — the user still gets their level from the
 * server, so a typo quietly narrows a section rather than escalating anyone.
 *
 * A role may hold more than one remit: `returning-officer`, for example, signs
 * off both results and final expenditure, so a single family cannot describe it.
 */
export const ROLE_FAMILY: Record<string, readonly Family[]> = {
  // Finance back-office
  "finance-officer": ["finance"],        "treasurer": ["finance"],
  "finance-manager": ["finance"],        "campaign-treasurer": ["finance"],
  // Communications / content
  "communications-officer": ["comms"],   "content-approver": ["comms"],
  "media-officer": ["comms"],            "fact-checker": ["comms"],
  "events-coordinator": ["comms"],
  // Compliance / legal back-office
  "legal-officer": ["compliance"],       "data-protection-officer": ["compliance"],
  "auditor": ["compliance"],             "security-admin": ["compliance"],
  "verification-officer": ["compliance"],
  "data-officer": ["compliance"],        "security-officer": ["compliance"],
  // Field agents
  "polling-station-agent": ["agent"],    "backup-polling-agent": ["agent"],
  "call-centre-agent": ["agent"],        "polling-centre-coordinator": ["agent"],
  "polling-agent": ["agent"],            "polling-agent-supervisor": ["agent"],
  "result-verifier": ["agent"],
  "national-tally-verifier": ["agent"],
  "county-verification-officer": ["agent"],
  // Signs off results AND final expenditure — needs both remits.
  "returning-officer": ["agent", "finance"],
  // Field coordinators
  "ward-coordinator": ["coordinator"],   "constituency-coordinator": ["coordinator"],
  "county-coordinator": ["coordinator"], "national-organising-director": ["coordinator"],
  // Senior campaign leadership
  "national-campaign-manager": ["leadership"],
  "campaign-exec-director": ["leadership"],
  "presidential-candidate": ["leadership"],
  "super-admin": ["leadership"],
  // Platform operator
  "platform_admin": ["leadership"],
  // General supporters
  "volunteer": ["supporter"],  "donor": ["supporter"],  "public-supporter": ["supporter"],
};

export const NO_ROLES_LEVEL = 999;

export interface UserAccess {
  level: number;
  families: Set<Family>;
  isGlobalAdmin: boolean;
  isLoaded: boolean;
}

/**
 * Least-privilege sentinel, used while loading and on fetch failure. Only the
 * always-visible Campaign section renders, so the sidebar grows into place
 * instead of showing sections and then yanking them away.
 */
export const NO_ACCESS: UserAccess = {
  level: NO_ROLES_LEVEL,
  families: new Set<Family>(),
  isGlobalAdmin: false,
  isLoaded: false,
};

/** Derive access from a successful /api/users/me payload. Pure. */
export function deriveAccess(data: any): UserAccess {
  const roles: any[] = Array.isArray(data?.roles) ? data.roles : [];
  const families = new Set(
    roles.flatMap((r) => ROLE_FAMILY[r?.roleSlug as string] ?? []),
  );

  // Global admins resolve server-side to platform level 0 and bypass every
  // tenant role check, so mirror that here rather than inferring from roles.
  if (data?.isGlobalAdmin) {
    return {
      level: 0,
      families: new Set(Object.values(ROLE_FAMILY).flat()),
      isGlobalAdmin: true,
      isLoaded: true,
    };
  }

  // Minimum = most privileged. A missing or non-numeric level must never make
  // a user look MORE privileged, so it degrades to 999 rather than 0.
  const level = roles.length
    ? Math.min(
        ...roles.map((r) =>
          typeof r?.roleLevel === "number" ? r.roleLevel : NO_ROLES_LEVEL,
        ),
      )
    : NO_ROLES_LEVEL;

  return { level, families, isGlobalAdmin: false, isLoaded: true };
}

export type SectionLabel =
  | "Campaign" | "Finance" | "Communications"
  | "Election Operations" | "Campaign Admin" | "Platform";

/**
 * Which sections each actor may see.
 *
 * Most gates are family-based rather than level-based. Several roles share a
 * level but have unrelated remits — legal, DPO, auditor and security-admin are
 * all level 2 with no finance duties, so `level <= 2` would hand them the
 * Finance section by accident.
 */
export const SECTION_RULES: Record<SectionLabel, (a: UserAccess) => boolean> = {
  // Visible to any authenticated user.
  "Campaign": () => true,

  // Finance back-office plus field leadership.
  "Finance": (a) =>
    a.families.has("finance") || a.families.has("coordinator") || a.families.has("leadership"),

  // Comms/field families, plus a senior-leadership override at level 2.
  "Communications": (a) =>
    a.families.has("comms") || a.families.has("coordinator") ||
    a.families.has("leadership") || a.level <= 2,

  // Field roles; back-office is excluded despite privileged levels.
  "Election Operations": (a) =>
    a.families.has("agent") || a.families.has("coordinator") ||
    a.families.has("leadership") || a.level <= 2,

  // Coordinators/leadership plus the compliance and finance back-office.
  // Excludes comms, which has no administrative remit despite sharing level 3
  // with county-coordinator.
  "Campaign Admin": (a) =>
    a.families.has("coordinator") || a.families.has("leadership") ||
    a.families.has("compliance") || a.families.has("finance"),

  // Cross-tenant operators only: global admins and the level-0 platform_admin
  // role, mirroring the server's requireLevel(0). A tenant super-admin is
  // level 1 and must NOT qualify.
  "Platform": (a) => a.isGlobalAdmin || a.level <= 0,
};
