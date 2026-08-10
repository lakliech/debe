/**
 * Campaign scope — which seat a campaign contests and the geography it covers.
 *
 * Kenyan ballot structure:
 *   presidential              → national (no geography selection)
 *   gubernatorial / senator / women_rep → must select a county
 *   mp                        → must select a constituency
 *   mca                       → must select a ward
 *
 * The tenant stores exactly ONE geography FK — the level the seat requires
 * (deeper levels are implied by the reference hierarchy: ward → constituency
 * → county). The `tenants_scope_valid` CHECK constraint mirrors these rules
 * at the database layer; this module enforces them at the API layer with
 * user-facing messages. Enforced on campaign registration and on
 * PATCH /api/settings/scope.
 */
import { db, countiesTable, constituenciesTable, wardsTable, pollingStationsTable } from "@workspace/db";
import { eq, and, or, inArray, sql, type SQL } from "drizzle-orm";

export const SEAT_TYPES = ["presidential", "gubernatorial", "senator", "women_rep", "mp", "mca"] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

export const SEAT_LABELS: Record<SeatType, string> = {
  presidential: "Presidential",
  gubernatorial: "Governor",
  senator: "Senator",
  women_rep: "Woman Representative",
  mp: "Member of Parliament",
  mca: "Member of County Assembly",
};

export const COUNTY_SEATS: readonly SeatType[] = ["gubernatorial", "senator", "women_rep"];

export class ScopeValidationError extends Error {}

export interface ScopeInput {
  seatType?: unknown;
  scopeCountyId?: unknown;
  scopeConstituencyId?: unknown;
  scopeWardId?: unknown;
}

export interface NormalizedScope {
  seatType: SeatType;
  scopeCountyId: string | null;
  scopeConstituencyId: string | null;
  scopeWardId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value);
  if (!UUID_RE.test(s)) throw new ScopeValidationError(`${field} must be a valid id.`);
  return s;
}

/**
 * Validate a scope selection against the seat's geography rule and normalise
 * it: geography irrelevant to the seat is nulled so a caller can never store
 * a contradictory combination (e.g. a presidential campaign pinned to a ward).
 */
export function normalizeScope(input: ScopeInput): NormalizedScope {
  const seatRaw = String(input.seatType ?? "").trim();
  if (!seatRaw) throw new ScopeValidationError("Select the seat this campaign is contesting.");
  if (!(SEAT_TYPES as readonly string[]).includes(seatRaw)) {
    throw new ScopeValidationError(`seatType must be one of: ${SEAT_TYPES.join(", ")}.`);
  }
  const seat = seatRaw as SeatType;

  const countyId = uuidOrNull(input.scopeCountyId, "scopeCountyId");
  const constituencyId = uuidOrNull(input.scopeConstituencyId, "scopeConstituencyId");
  const wardId = uuidOrNull(input.scopeWardId, "scopeWardId");

  if (seat === "presidential") {
    return { seatType: seat, scopeCountyId: null, scopeConstituencyId: null, scopeWardId: null };
  }
  if (COUNTY_SEATS.includes(seat)) {
    if (!countyId) {
      throw new ScopeValidationError(`${SEAT_LABELS[seat]} campaigns must select a county.`);
    }
    return { seatType: seat, scopeCountyId: countyId, scopeConstituencyId: null, scopeWardId: null };
  }
  if (seat === "mp") {
    if (!constituencyId) {
      throw new ScopeValidationError("Member of Parliament campaigns must select a constituency.");
    }
    return { seatType: seat, scopeCountyId: null, scopeConstituencyId: constituencyId, scopeWardId: null };
  }
  // mca
  if (!wardId) {
    throw new ScopeValidationError("MCA campaigns must select a ward.");
  }
  return { seatType: seat, scopeCountyId: null, scopeConstituencyId: null, scopeWardId: wardId };
}

/**
 * Confirm the selected geography row actually exists in the shared reference
 * tables. Returns a user-facing error string, or null when valid. Seats with
 * no geography requirement (presidential) always pass.
 */
export async function scopeGeographyExists(scope: NormalizedScope): Promise<string | null> {
  if (scope.scopeCountyId) {
    const [row] = await db
      .select({ id: countiesTable.id })
      .from(countiesTable)
      .where(eq(countiesTable.id, scope.scopeCountyId))
      .limit(1);
    if (!row) return "County not found.";
  }
  if (scope.scopeConstituencyId) {
    const [row] = await db
      .select({ id: constituenciesTable.id })
      .from(constituenciesTable)
      .where(eq(constituenciesTable.id, scope.scopeConstituencyId))
      .limit(1);
    if (!row) return "Constituency not found.";
  }
  if (scope.scopeWardId) {
    const [row] = await db
      .select({ id: wardsTable.id })
      .from(wardsTable)
      .where(eq(wardsTable.id, scope.scopeWardId))
      .limit(1);
    if (!row) return "Ward not found.";
  }
  return null;
}

/**
 * Geography visibility filter derived from a campaign's scope.
 *
 * Operational screens should only show the geography a campaign actually
 * contests: a Nairobi senatorial campaign sees Nairobi and its hierarchy,
 * not all 47 counties. The filter always includes the scope's PARENT chain
 * (an MCA campaign still sees its own county and constituency) so cascading
 * pickers and breadcrumbs keep working. Returns null for presidential and
 * legacy scope-less tenants — they see everything.
 */
export interface ScopeGeoFilter {
  countyId: string | null;
  constituencyId: string | null;
  wardId: string | null;
}

export async function resolveScopeGeoFilter(scope: {
  seatType: string | null;
  scopeCountyId: string | null;
  scopeConstituencyId: string | null;
  scopeWardId: string | null;
}): Promise<ScopeGeoFilter | null> {
  if (!scope.seatType || scope.seatType === "presidential") return null;

  if (scope.scopeCountyId) {
    return { countyId: scope.scopeCountyId, constituencyId: null, wardId: null };
  }
  if (scope.scopeConstituencyId) {
    const [row] = await db
      .select({ countyId: constituenciesTable.countyId })
      .from(constituenciesTable)
      .where(eq(constituenciesTable.id, scope.scopeConstituencyId))
      .limit(1);
    // Reference row vanished — fail open (no filtering) rather than hide everything.
    if (!row) return null;
    return { countyId: row.countyId, constituencyId: scope.scopeConstituencyId, wardId: null };
  }
  if (scope.scopeWardId) {
    const [row] = await db
      .select({ constituencyId: wardsTable.constituencyId, countyId: wardsTable.countyId })
      .from(wardsTable)
      .where(eq(wardsTable.id, scope.scopeWardId))
      .limit(1);
    if (!row) return null;
    return { countyId: row.countyId, constituencyId: row.constituencyId, wardId: scope.scopeWardId };
  }
  // Seat set but no geography (blocked by the CHECK constraint) — no filtering.
  return null;
}

// ── Scope enforcement for tally & operational dashboards ─────────────────────

export interface TenantScopeShape {
  seatType: string | null;
  scopeCountyId: string | null;
  scopeConstituencyId: string | null;
  scopeWardId: string | null;
}

export type TallyLevel = "national" | "county" | "constituency" | "ward" | "station";

/**
 * Geography condition for any table carrying countyId/constituencyId/wardId
 * columns (polling_stations, volunteers, supporters…). Applies the DEEPEST
 * scope level — a ward FK implies its constituency and county through the
 * reference hierarchy. Undefined for presidential / scope-less tenants (they
 * see everything).
 */
export async function scopeGeoCondition(
  scope: TenantScopeShape,
  table: { countyId: any; constituencyId: any; wardId: any },
): Promise<SQL | undefined> {
  const filter = await resolveScopeGeoFilter(scope);
  if (!filter) return undefined;
  if (filter.wardId) return eq(table.wardId, filter.wardId);
  if (filter.constituencyId) return eq(table.constituencyId, filter.constituencyId);
  if (filter.countyId) return eq(table.countyId, filter.countyId);
  return undefined;
}

function seatScopeNoun(seat: string): string {
  if (seat === "mp") return "constituency";
  if (seat === "mca") return "ward";
  return "county";
}

/**
 * May this tenant view a tally at `level` for `entityId`?
 * Returns a user-facing error string when out of scope, null when allowed.
 * Presidential and scope-less tenants may view every level. Drill-DOWN below
 * the seat's own level is allowed (a governor sees wards in their county);
 * levels ABOVE the seat are denied (an MCA never sees a constituency tally —
 * it would include other wards).
 */
export async function checkTallyAccess(
  scope: TenantScopeShape,
  level: TallyLevel,
  entityId?: string,
): Promise<string | null> {
  const seat = scope.seatType;
  if (!seat || seat === "presidential") return null;

  const seatLabel = SEAT_LABELS[seat as SeatType] ?? seat;
  const deny = (what: string) =>
    `${what} is outside this campaign's scope — a ${seatLabel} campaign tallies its own ${seatScopeNoun(seat)} only.`;

  if (level === "national") return deny("The national tally");

  if (level === "county") {
    // Only county-seat campaigns have a county level at all; an MP/MCA county
    // tally would aggregate out-of-scope constituencies/wards.
    if (!scope.scopeCountyId) return deny("County-level tallies");
    if (entityId && entityId !== scope.scopeCountyId) return deny("That county");
    return null;
  }

  if (level === "constituency") {
    if (seat === "mca") return deny("Constituency-level tallies");
    if (scope.scopeCountyId) {
      if (!entityId) return deny("Constituency-level tallies");
      const [row] = await db
        .select({ countyId: constituenciesTable.countyId })
        .from(constituenciesTable)
        .where(eq(constituenciesTable.id, entityId))
        .limit(1);
      if (!row || row.countyId !== scope.scopeCountyId) return deny("That constituency");
      return null;
    }
    // mp
    if (entityId && entityId !== scope.scopeConstituencyId) return deny("That constituency");
    return null;
  }

  if (level === "ward") {
    if (!entityId) return deny("Ward-level tallies");
    const [row] = await db
      .select({ constituencyId: wardsTable.constituencyId, countyId: wardsTable.countyId })
      .from(wardsTable)
      .where(eq(wardsTable.id, entityId))
      .limit(1);
    if (!row) return deny("That ward");
    if (scope.scopeWardId) return entityId === scope.scopeWardId ? null : deny("That ward");
    if (scope.scopeConstituencyId) {
      return row.constituencyId === scope.scopeConstituencyId ? null : deny("That ward");
    }
    return row.countyId === scope.scopeCountyId ? null : deny("That ward");
  }

  // station
  if (!entityId) return deny("Station-level tallies");
  const [st] = await db
    .select({
      countyId: pollingStationsTable.countyId,
      constituencyId: pollingStationsTable.constituencyId,
      wardId: pollingStationsTable.wardId,
    })
    .from(pollingStationsTable)
    .where(eq(pollingStationsTable.id, entityId))
    .limit(1);
  if (!st) return "Polling station not found.";
  if (scope.scopeWardId && st.wardId !== scope.scopeWardId) return deny("That station");
  if (scope.scopeConstituencyId && st.constituencyId !== scope.scopeConstituencyId) return deny("That station");
  if (scope.scopeCountyId && st.countyId !== scope.scopeCountyId) return deny("That station");
  return null;
}

/**
 * Snapshot levels a scoped tenant must NOT see (used to filter stored
 * tally_snapshots). Presidential/scope-less → none excluded.
 */
export function excludedSnapshotLevels(scope: TenantScopeShape): string[] {
  const seat = scope.seatType;
  if (!seat || seat === "presidential") return [];
  if (seat === "mca") return ["national", "county", "constituency"];
  if (seat === "mp") return ["national", "county"];
  return ["national"]; // county seats
}

/**
 * Row-level filter for stored tally snapshots: restricts BOTH level and
 * entityId to the campaign's scope. Rows at excluded levels (and national
 * rows with NULL entityId) match no clause and are filtered out entirely.
 * Returns undefined for presidential/scope-less tenants (no restriction).
 */
export async function snapshotScopeCondition(
  scope: TenantScopeShape,
  table: { level: any; entityId: any },
): Promise<SQL | undefined> {
  const excluded = excludedSnapshotLevels(scope);
  if (!excluded.length) return undefined;
  const filter = await resolveScopeGeoFilter(scope);
  if (!filter) return sql`false`;

  const stationCond = filter.wardId
    ? eq(pollingStationsTable.wardId, filter.wardId)
    : filter.constituencyId
      ? eq(pollingStationsTable.constituencyId, filter.constituencyId)
      : eq(pollingStationsTable.countyId, filter.countyId!);

  const perLevel: SQL[] = [];
  if (!excluded.includes("county")) {
    // Only county-seat campaigns reach here (mp/mca exclude county level).
    perLevel.push(and(eq(table.level, "county"), eq(table.entityId, filter.countyId!))!);
  }
  if (!excluded.includes("constituency")) {
    const cond = filter.constituencyId
      ? eq(table.entityId, filter.constituencyId)
      : inArray(table.entityId, db.select({ id: constituenciesTable.id }).from(constituenciesTable)
          .where(eq(constituenciesTable.countyId, filter.countyId!)));
    perLevel.push(and(eq(table.level, "constituency"), cond)!);
  }
  if (!excluded.includes("ward")) {
    const cond = filter.wardId
      ? eq(table.entityId, filter.wardId)
      : filter.constituencyId
        ? inArray(table.entityId, db.select({ id: wardsTable.id }).from(wardsTable)
            .where(eq(wardsTable.constituencyId, filter.constituencyId)))
        : inArray(table.entityId, db.select({ id: wardsTable.id }).from(wardsTable)
            .where(eq(wardsTable.countyId, filter.countyId!)));
    perLevel.push(and(eq(table.level, "ward"), cond)!);
  }
  perLevel.push(and(
    eq(table.level, "station"),
    inArray(table.entityId, db.select({ id: pollingStationsTable.id }).from(pollingStationsTable).where(stationCond)),
  )!);

  return or(...perLevel);
}
