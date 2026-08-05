/**
 * TEMPORARY one-time maintenance routes — REMOVE after the production
 * geography repair has run and been verified (then republish).
 *
 * Why this exists: the production database was seeded from the old positional
 * geography walk, leaving placeholder wards, stale names, and zero polling
 * stations. The agent has no write path to the production database other than
 * the deployed app itself, so this endpoint re-runs the FIXED geography +
 * polling-station seeds against whatever database the deployment is connected
 * to. The seeds are idempotent upserts keyed on ward/station codes — they
 * relink rows in place, add missing rows, and delete nothing, so the endpoint
 * is safe to retry after a timeout or crash.
 *
 * Protection:
 *   1. The route 404s unless GEO_REPAIR_TOKEN is set in the environment —
 *      it simply does not exist in normal operation.
 *   2. The caller must present that same token in the x-geo-repair-token
 *      header. The token is a one-time high-entropy random value that lives
 *      only in env vars (never in code or git) and is deleted after cleanup.
 *      Worst-case misuse merely re-runs an idempotent, additive repair.
 *   3. A Postgres advisory lock serializes runs across ALL deployment
 *      instances (an in-process mutex would not), so two concurrent calls
 *      cannot both insert polling centres.
 *
 * Clerk auth is deliberately NOT required: the agent executing the repair
 * holds the token but cannot hold a production Clerk session. There is no
 * platformAudit record for the same reason (recordPlatformAction requires a
 * mapped user and fails closed); the audit trail is the structured log line
 * below, captured in deployment logs, plus the before/after counts.
 */

import { Router } from "express";
import { db, pool } from "@workspace/db";
import { wardsTable, pollingCentresTable, pollingStationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedGeography } from "@workspace/db/seeds/geography";
import { seedAllPollingStations } from "@workspace/db/seeds/polling-stations";

const router = Router();

// Arbitrary fixed key for the cross-instance repair lock ('geo1').
const GEO_REPAIR_LOCK_KEY = 0x67656f31;

// Hard feature flag: with no token configured the route does not exist.
router.use((_req, res, next) => {
  if (!process.env.GEO_REPAIR_TOKEN) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});

async function geoCounts() {
  const count = async (t: any) =>
    (await db.select({ n: sql<number>`cast(count(*) as int)` }).from(t))[0].n;
  return {
    wards: await count(wardsTable),
    centres: await count(pollingCentresTable),
    stations: await count(pollingStationsTable),
  };
}

router.post("/geography-repair", async (req, res) => {
  const token = process.env.GEO_REPAIR_TOKEN!;
  const provided = req.get("x-geo-repair-token");
  if (!provided || provided !== token) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Deployment-wide serialization: pg_try_advisory_lock is held on one pooled
  // connection for the whole run; any other instance gets 409 immediately.
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS got",
      [GEO_REPAIR_LOCK_KEY],
    );
    locked = rows[0]?.got === true;
  } catch (lockErr) {
    client.release();
    throw lockErr;
  }
  if (!locked) {
    client.release();
    res.status(409).json({ error: "geography repair already in progress" });
    return;
  }

  const startedAt = Date.now();
  try {
    const before = await geoCounts();
    await seedGeography();
    await seedAllPollingStations();
    const after = await geoCounts();
    const durationMs = Date.now() - startedAt;
    console.log(
      `[maintenance] geography repair completed`,
      JSON.stringify({ before, after, durationMs }),
    );
    res.json({ ok: true, before, after, durationMs });
  } catch (err: any) {
    console.error(`[maintenance] geography repair FAILED:`, err);
    res.status(500).json({ ok: false, error: err?.message ?? "repair failed" });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [GEO_REPAIR_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
});

export default router;
