import { seedRoles, seedBranding } from "./roles";
import { seedGeography } from "./geography";
import { seedAllPollingStations } from "./polling-stations";
import { seedManifesto } from "./manifesto";
import { pool } from "../index";

async function main() {
  try {
    await seedRoles();
    await seedGeography();
    await seedAllPollingStations();
    await seedBranding();
    await seedManifesto();
    console.log("\n✅ All seeds complete");
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
