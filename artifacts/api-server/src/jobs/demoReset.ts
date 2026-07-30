/**
 * demoReset — nightly cron job that resets the shared demo tenant.
 *
 * Runs daily at 23:00 UTC (02:00 EAT) via node-cron.
 * Only active when DEMO_RESET_ENABLED=true.
 *
 * The job shells out to the reset script in the @workspace/scripts package
 * rather than importing seed logic directly, keeping the API server lean and
 * avoiding a dependency on the scripts package.
 *
 * Register in app.ts:
 *   if (process.env.DEMO_RESET_ENABLED === 'true') {
 *     registerDemoResetJob();
 *   }
 */

import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schedule } from "node-cron";
import { logger } from "../lib/logger";

// Resolve workspace root from this file's location.
// Compiled file sits at:  artifacts/api-server/dist/jobs/demoReset.mjs
// Workspace root is 4 levels up from that compiled location.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../../");

const RESET_COMMAND = "pnpm --filter @workspace/scripts run reset:demo";

// 23:00 UTC every day  →  02:00 EAT (UTC+3)
const CRON_SCHEDULE = "0 23 * * *";

function runResetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info("[demoReset] Starting nightly demo reset…");

    const child = exec(RESET_COMMAND, { cwd: WORKSPACE_ROOT });

    child.stdout?.on("data", (chunk: string) => {
      process.stdout.write(chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      process.stderr.write(chunk);
    });

    child.on("close", (code) => {
      if (code === 0) {
        logger.info("[demoReset] Demo reset completed successfully.");
        resolve();
      } else {
        const err = new Error(`Demo reset script exited with code ${code}`);
        logger.error(err, "[demoReset] Demo reset failed.");
        reject(err);
      }
    });

    child.on("error", (err) => {
      logger.error(err, "[demoReset] Failed to spawn reset script.");
      reject(err);
    });
  });
}

export function registerDemoResetJob(): void {
  schedule(
    CRON_SCHEDULE,
    async () => {
      try {
        await runResetScript();
      } catch {
        // Error already logged inside runResetScript; swallow so the cron
        // scheduler keeps running for subsequent nights.
      }
    },
    {
      timezone: "UTC",
      name: "demo-nightly-reset",
    },
  );

  logger.info(
    `[demoReset] Nightly demo reset scheduled (${CRON_SCHEDULE} UTC).`,
  );
}
