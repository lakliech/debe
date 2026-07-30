import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../index";
import { wardsTable, pollingCentresTable, pollingStationsTable } from "../schema";
import { CONSTITUENCY_DATA } from "./geography";

interface _WardJson { name: string; pollingStations: { name: string }[] }
interface _ConstJson { name: string; wards: _WardJson[] }
interface _CountyJson { name: string; constituencies: _ConstJson[] }

const _dir = dirname(fileURLToPath(import.meta.url));
const _countyData: _CountyJson[] = JSON.parse(
  readFileSync(join(_dir, "county_data.json"), "utf-8"),
);

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

  for (const [countyCodeStr, consts] of Object.entries(CONSTITUENCY_DATA)) {
    const countyCode = Number(countyCodeStr);
    const jsonCounty = _countyData[countyCode - 1];

    for (let constIdx = 0; constIdx < consts.length; constIdx++) {
      const jsonWards = jsonCounty?.constituencies[constIdx]?.wards ?? [];

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
        set: { name: sql`excluded.name` },
      });
    upserted += batch.length;
  }

  console.log(`✓ ${upserted} polling stations seeded`);
}
