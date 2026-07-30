import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { pollingStationsTable } from "@workspace/db";
import { sql, like, count } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * One-shot startup cleanup: removes DEMO-coded polling station records.
 * Runs only when ADMIN_CLEANUP_SECRET is set in the environment.
 * Safe to run on every boot — exits early if no DEMO stations exist.
 *
 * Remove ADMIN_CLEANUP_SECRET from production env vars after the first
 * successful cleanup to prevent this running on subsequent deploys.
 */
async function runDemoStationCleanupIfNeeded() {
  if (!process.env.ADMIN_CLEANUP_SECRET) return;

  try {
    const [{ n }] = await db
      .select({ n: count() })
      .from(pollingStationsTable)
      .where(like(pollingStationsTable.code, "DEMO%"));
    const demoCount = Number(n);

    if (demoCount === 0) {
      logger.info("Startup cleanup: no DEMO stations found — nothing to do.");
      return;
    }

    logger.info({ demoCount }, "Startup cleanup: removing DEMO polling station records…");

    await db.execute(sql`
      DO $$
      BEGIN
        -- NULL out polling_agents.polling_station_id (nullable column)
        UPDATE polling_agents
        SET    polling_station_id = NULL
        WHERE  polling_station_id IN (
          SELECT id FROM polling_stations WHERE code LIKE 'DEMO%'
        );

        -- DELETE result_submissions linked to DEMO stations
        -- (polling_station_id is NOT NULL — rows are demo-only data)
        DELETE FROM result_submissions
        WHERE polling_station_id IN (
          SELECT id FROM polling_stations WHERE code LIKE 'DEMO%'
        );

        -- DELETE the DEMO polling_stations rows
        -- campaign_station_profiles cascades automatically
        DELETE FROM polling_stations WHERE code LIKE 'DEMO%';
      END $$;
    `);

    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(pollingStationsTable)
      .where(like(pollingStationsTable.code, "DEMO%"));

    const [{ total }] = await db
      .select({ total: count() })
      .from(pollingStationsTable);

    logger.info(
      { removed: demoCount, remaining: Number(remaining), totalStations: Number(total) },
      "Startup cleanup: DEMO station cleanup complete.",
    );
  } catch (err) {
    // Log but do not abort startup — a cleanup failure must not take the server down.
    logger.error({ err }, "Startup cleanup: DEMO station cleanup failed (non-fatal).");
  }
}

async function main() {
  await runDemoStationCleanupIfNeeded();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main();
