/**
 * adminCleanup — one-shot protected endpoint for production data cleanup.
 *
 * SECURITY: guarded by X-Admin-Secret header matching the ADMIN_CLEANUP_SECRET
 * env var.  Remove that env var from production once the cleanup has run.
 *
 * NOT mounted through tenant/auth middleware — runs as a super-admin operation.
 */
import { logger } from "../lib/logger";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { pollingStationsTable } from "@workspace/db";
import { sql, like, count } from "drizzle-orm";

const router: IRouter = Router();

/**
 * POST /api/admin/cleanup-demo-stations
 *
 * Removes all DEMO-coded polling station records.
 * Steps (run atomically via DO block):
 *  1. NULL out polling_agents.polling_station_id (column is nullable).
 *  2. DELETE result_submissions referencing DEMO stations
 *     (polling_station_id NOT NULL; rows are demo-only data).
 *  3. DELETE the DEMO polling_stations rows.
 *
 * Returns a JSON summary of rows affected.
 */
router.post("/cleanup-demo-stations", async (req: any, res: any) => {
  const secret = process.env.ADMIN_CLEANUP_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "ADMIN_CLEANUP_SECRET not configured — endpoint disabled" });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // How many DEMO stations exist?
    const demoCountRows = await db
      .select({ n: count() })
      .from(pollingStationsTable)
      .where(like(pollingStationsTable.code, "DEMO%"));
    const demoCount = Number(demoCountRows[0]?.n ?? 0);

    if (demoCount === 0) {
      const totalRows = await db.select({ n: count() }).from(pollingStationsTable);
      return res.json({
        message: "No DEMO stations found — nothing to do.",
        demoStationsRemoved: 0,
        remainingDemoStations: 0,
        totalStations: Number(totalRows[0]?.n ?? 0),
      });
    }

    // Run everything in a single transaction via a PL/pgSQL DO block.
    // The DO block NULLs agents, deletes submissions, then deletes stations.
    await db.execute(sql`
      DO $$
      BEGIN
        -- 1. NULL out polling_agents.polling_station_id (nullable column)
        UPDATE polling_agents
        SET    polling_station_id = NULL
        WHERE  polling_station_id IN (
          SELECT id FROM polling_stations WHERE code LIKE 'DEMO%'
        );

        -- 2. DELETE result_submissions linked to DEMO stations
        --    (polling_station_id is NOT NULL so we must delete, not null)
        DELETE FROM result_submissions
        WHERE polling_station_id IN (
          SELECT id FROM polling_stations WHERE code LIKE 'DEMO%'
        );

        -- 3. DELETE the DEMO polling_stations rows
        --    campaign_station_profiles cascades automatically
        DELETE FROM polling_stations WHERE code LIKE 'DEMO%';
      END $$;
    `);

    // Verify
    const remainingRows = await db
      .select({ n: count() })
      .from(pollingStationsTable)
      .where(like(pollingStationsTable.code, "DEMO%"));
    const remaining = Number(remainingRows[0]?.n ?? 0);

    const totalRows = await db.select({ n: count() }).from(pollingStationsTable);
    const total = Number(totalRows[0]?.n ?? 0);

    return res.json({
      message: "DEMO station cleanup complete.",
      demoStationsRemoved: demoCount,
      remainingDemoStations: remaining,
      totalStations: total,
    });
  } catch (err: any) {
    console.error("[admin/cleanup-demo-stations]", err);
    logger.error({ err }, "request failed");
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
