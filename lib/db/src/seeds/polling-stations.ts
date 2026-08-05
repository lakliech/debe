import { sql } from "drizzle-orm";
import { db } from "../index";
import { wardsTable, pollingCentresTable, pollingStationsTable } from "../schema";
import { CONSTITUENCY_DATA } from "./geography";
// Static import (not readFileSync) so bundlers inline the data — a runtime
// file read resolves relative to the bundle output dir and is not there.
import countyDataJson from "./county_data.json";

interface _WardJson { name: string; pollingStations: { name: string }[] }
interface _ConstJson { name: string; wards: _WardJson[] }
interface _CountyJson { name: string; constituencies: _ConstJson[] }

const _countyData = countyDataJson as _CountyJson[];

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/**
 * Seeds all 24,594 real Kenyan polling stations.
 *
 * Strategy:
 *  1. Load all DB wards; build wardCode (1-1450) → {id, constituencyId, countyId}.
 *     Ward codes were assigned sequentially in seedGeography() iterating
 *     CONSTITUENCY_DATA keys ascending → constituency array order → JSON ward order.
 *     Reproducing that walk here gives us the same mapping.
 *  2. Load existing polling centres; build wardId → centreId.
 *  3. Walk county_data.json in the same order to emit (a) missing centres and
 *     (b) all 24,594 station rows.
 *  4. Insert missing centres in batches of 500; capture returned IDs.
 *  5. Upsert all station rows in batches of 500 keyed on the unique station code.
 *
 * Station codes use format W####S### (ward code zero-padded to 4, station
 * index zero-padded to 3).  This seed is idempotent: re-running updates names
 * and never creates duplicates.
 */
export async function seedAllPollingStations() {
  console.log("  Seeding all polling stations…");

  // ── 1. wardCode → DB ward ─────────────────────────────────────────────────
  const allWards = await db
    .select({
      id: wardsTable.id,
      code: wardsTable.code,
      constituencyId: wardsTable.constituencyId,
      countyId: wardsTable.countyId,
    })
    .from(wardsTable);

  const wardByCode = new Map<number, { id: string; constituencyId: string; countyId: string }>();
  for (const w of allWards) {
    wardByCode.set(w.code, {
      id: w.id,
      constituencyId: w.constituencyId,
      countyId: w.countyId,
    });
  }
  console.log(`    ${wardByCode.size} wards loaded from DB`);

  // ── 2. wardId → centreId for existing centres ─────────────────────────────
  const existingCentres = await db
    .select({ id: pollingCentresTable.id, wardId: pollingCentresTable.wardId })
    .from(pollingCentresTable);

  const centreByWardId = new Map<string, string>();
  for (const c of existingCentres) centreByWardId.set(c.wardId, c.id);

  // ── 3. Walk JSON reproducing the same wardCode sequence as seedGeography() ─
  type CentreRow = {
    name: string;
    wardId: string;
    constituencyId: string;
    countyId: string;
  };
  type StationFlat = { wardCode: number; stationIdx: number; name: string };

  const missingCentres: CentreRow[] = [];
  const allStationsFlat: StationFlat[] = [];

  let wardCode = 1;

  // Match constituencies to the JSON BY NAME — never by position. This walk
  // must reproduce seedGeography()'s wardCode sequence exactly; a positional
  // join silently mis-links stations when the two files disagree on order.
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const [countyCodeStr, consts] of Object.entries(CONSTITUENCY_DATA)) {
    const countyCode = Number(countyCodeStr);
    const jsonCounty = _countyData[countyCode - 1];
    if (!jsonCounty) {
      throw new Error(`county_data.json is missing county #${countyCode}`);
    }

    const jsonConstByName = new Map(
      jsonCounty.constituencies.map((jc) => [normName(jc.name), jc]),
    );

    for (let constIdx = 0; constIdx < consts.length; constIdx++) {
      const jsonConst = jsonConstByName.get(normName(consts[constIdx].name));
      if (!jsonConst) {
        throw new Error(
          `county_data.json has no constituency matching '${consts[constIdx].name}' in ${jsonCounty.name} (county #${countyCode}) — fix the data instead of seeding positionally.`,
        );
      }
      const jsonWards = jsonConst.wards ?? [];

      if (jsonWards.length === 0) {
        // seedGeography() created 3 fallback wards here; skip them
        wardCode += 3;
        continue;
      }

      for (const jsonWard of jsonWards) {
        const dbWard = wardByCode.get(wardCode);

        if (dbWard) {
          // Queue a centre if one doesn't exist for this ward yet
          if (!centreByWardId.has(dbWard.id)) {
            missingCentres.push({
              name: jsonWard.name,
              wardId: dbWard.id,
              constituencyId: dbWard.constituencyId,
              countyId: dbWard.countyId,
            });
          }

          // Queue every station for this ward
          for (let si = 0; si < jsonWard.pollingStations.length; si++) {
            allStationsFlat.push({
              wardCode,
              stationIdx: si + 1,
              name: jsonWard.pollingStations[si].name,
            });
          }
        }

        wardCode++;
      }
    }
  }

  // ── 4. Insert missing polling centres in batches of 500 ───────────────────
  let newCentres = 0;
  for (const batch of chunks(missingCentres, 500)) {
    const inserted = await db
      .insert(pollingCentresTable)
      .values(batch)
      .returning({ id: pollingCentresTable.id, wardId: pollingCentresTable.wardId });
    for (const row of inserted) centreByWardId.set(row.wardId, row.id);
    newCentres += inserted.length;
  }
  console.log(`    ${newCentres} new polling centres inserted (${centreByWardId.size} total)`);

  // Centres created before a geography fix may carry stale denormalized
  // county/constituency links — always re-sync them from their ward.
  await db.execute(sql`
    UPDATE polling_centres pc
    SET constituency_id = w.constituency_id,
        county_id = w.county_id
    FROM wards w
    WHERE w.id = pc.ward_id
      AND (pc.constituency_id IS DISTINCT FROM w.constituency_id
           OR pc.county_id IS DISTINCT FROM w.county_id)
  `);

  // ── 5. Upsert all stations in batches of 500 ─────────────────────────────
  type StationRow = {
    code: string;
    name: string;
    centreId: string;
    wardId: string;
    constituencyId: string;
    countyId: string;
  };

  const stationRows: StationRow[] = [];
  for (const s of allStationsFlat) {
    const dbWard = wardByCode.get(s.wardCode);
    if (!dbWard) continue;
    const centreId = centreByWardId.get(dbWard.id);
    if (!centreId) continue;
    stationRows.push({
      code: `W${String(s.wardCode).padStart(4, "0")}S${String(s.stationIdx).padStart(3, "0")}`,
      name: s.name,
      centreId,
      wardId: dbWard.id,
      constituencyId: dbWard.constituencyId,
      countyId: dbWard.countyId,
    });
  }

  let upserted = 0;
  for (const batch of chunks(stationRows, 500)) {
    await db
      .insert(pollingStationsTable)
      .values(batch)
      .onConflictDoUpdate({
        target: pollingStationsTable.code,
        // Update every link column too — re-seeding after a geography fix
        // must repair existing rows, not just rename them.
        set: {
          name: sql`excluded.name`,
          centreId: sql`excluded.centre_id`,
          wardId: sql`excluded.ward_id`,
          constituencyId: sql`excluded.constituency_id`,
          countyId: sql`excluded.county_id`,
        },
      });
    upserted += batch.length;
  }

  console.log(`✓ ${upserted} polling stations seeded`);
}
