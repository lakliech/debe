import app from "./app";
import { logger } from "./lib/logger";
import { runPlatformBootstrap } from "./lib/platformBootstrap";
import { backfillTallyEligibilityFlags } from "./lib/resultStatus";
import { ensureMpesaConfigTable } from "./lib/mpesa";
import { startCommsDispatcher } from "./lib/commsDispatcher";
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
  // Open the port first. Startup housekeeping talks to the database, and a
  // slow or unreachable database must not delay the port opening — the
  // platform kills a workflow that takes too long to listen.
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startCommsDispatcher();

    // Both are idempotent and swallow their own failures, so they are safe to
    // run in the background. The bootstrap recovers a deployment whose
    // database has no roles and no platform operator — a state that otherwise
    // locks the owner out of their own product with no in-app way back in.
    void runPlatformBootstrap()
      .then(() => runDemoStationCleanupIfNeeded())
      .then(() => ensureMpesaConfigTable())
      .then(async () => {
        // Idempotent: syncs candidate-vote tally flags with their parent
        // submission's status — repairs rows written before the lockstep
        // sync existed (e.g. restored/imported databases). The IS DISTINCT
        // FROM guard means steady-state boots write zero rows.
        await backfillTallyEligibilityFlags(db);
        logger.info("Startup housekeeping: tally eligibility flags in sync.");
      })
      .catch((bootErr) => {
        logger.error({ err: bootErr }, "Startup housekeeping failed (non-fatal).");
      });
  });
}

main();
