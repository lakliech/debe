// One-off production geography repair.
// Runs ONLY the geography + polling-station seeds (never roles/branding/
// manifesto) against whatever DATABASE_URL is set. Idempotent: upserts by
// code, relinks wards/centres/stations in place, deletes nothing.
// Usage: DATABASE_URL="$PRODUCTION_DATABASE_URL" pnpm exec tsx src/seeds/repair-prod-geography.ts
import { seedGeography } from "./geography";
import { seedAllPollingStations } from "./polling-stations";
import { pool } from "../index";

async function main() {
  try {
    await seedGeography();
    await seedAllPollingStations();
    console.log("\n✅ Geography repair complete");
  } catch (err) {
    console.error("Repair error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
