/**
 * TLS certificate provisioning helper.
 *
 * On a Replit deployment (or any reverse-proxy / Cloudflare setup), TLS is
 * typically provisioned automatically once a CNAME is live. This module
 * tracks that lifecycle in the DB and verifies it by attempting an HTTPS
 * connection to the custom domain.
 *
 * Security posture:
 *   - rejectUnauthorized: true  → only a properly CA-signed cert passes
 *   - WHERE clause on both tenant_id AND custom_domain → stale async checks
 *     from a previous domain cannot overwrite state for the current domain
 *   - Bounded automatic retry with exponential backoff (up to ~15 min)
 *
 * Flow:
 *   1. Domain saved + DNS verified → triggerTlsProvisioning() called
 *   2. Sets tlsStatus = 'pending' (domain-guarded)
 *   3. Probes https://<domain>/ — on success marks 'active'; on failure
 *      schedules a retry after a growing delay
 *   4. After MAX_RETRIES failures marks 'error'
 *   5. Admin can trigger a fresh cycle via POST /api/config/domain/cert/retry
 */

import https from "node:https";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

// Timeout for a single HTTPS probe attempt.
const TLS_CHECK_TIMEOUT_MS = 15_000;

// Exponential backoff schedule for automatic retries.
// [30s, 60s, 2min, 4min, 8min] → ~15 minutes of automatic retrying before giving up.
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 480_000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe `https://<domain>/` with a validated TLS handshake.
 * rejectUnauthorized: true — only a CA-signed, hostname-matching certificate
 * is accepted. A self-signed, expired, or wrong-hostname cert returns false.
 */
function probeHttps(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; req.destroy(); resolve(false); }
    }, TLS_CHECK_TIMEOUT_MS);

    const req = https.request(
      {
        hostname: domain,
        port: 443,
        path: "/",
        method: "HEAD",
        // Require a valid, trusted certificate whose CN/SAN matches the hostname.
        rejectUnauthorized: true,
        servername: domain, // SNI — required for virtual-hosted domains
      },
      () => {
        if (!settled) { settled = true; clearTimeout(timer); req.destroy(); resolve(true); }
      },
    );

    req.on("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
    });

    req.end();
  });
}

/**
 * Attempt to mark a domain as TLS-active. Guards every DB write with
 * `AND custom_domain = domain` so a stale async check for a previously-set
 * domain cannot corrupt state after the admin has changed or cleared it.
 *
 * @param tenantId - UUID of the tenant
 * @param domain   - The domain that was being checked (snapshot at dispatch time)
 * @param attempt  - Zero-based retry attempt counter
 */
export async function checkTlsCert(
  tenantId: string,
  domain: string,
  attempt = 0,
): Promise<void> {
  logger.info(
    `[tlsCert] Probing HTTPS for ${domain} (tenant ${tenantId}, attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
  );

  let ok = false;
  try {
    ok = await probeHttps(domain);
  } catch (err: any) {
    logger.error(err, `[tlsCert] Unexpected error probing ${domain}`);
  }

  if (ok) {
    // Domain guard: only write if tenant still has this exact custom_domain value.
    // If the admin changed / cleared the domain while the check was in-flight,
    // the WHERE matches nothing and the stale result is silently discarded.
    await db
      .update(tenantsTable)
      .set({
        tlsStatus: "active",
        tlsCertError: null,
        tlsProvisionedAt: new Date(),
      })
      .where(
        and(
          eq(tenantsTable.id, tenantId),
          eq(tenantsTable.customDomain, domain),
        ),
      );
    logger.info(`[tlsCert] TLS confirmed active for ${domain}`);
    return;
  }

  // Probe failed — decide whether to retry automatically or give up.
  if (attempt < MAX_RETRIES) {
    const delayMs = RETRY_DELAYS_MS[attempt]!;
    const delaySec = Math.round(delayMs / 1000);
    logger.info(
      `[tlsCert] Probe failed for ${domain}; retry ${attempt + 1}/${MAX_RETRIES} in ${delaySec}s`,
    );

    // Stay in 'pending' — do not write to DB; the UI already shows pending.
    // Schedule the next attempt.
    setTimeout(() => {
      checkTlsCert(tenantId, domain, attempt + 1).catch(() => {});
    }, delayMs);
    return;
  }

  // All retries exhausted → move to error state (domain-guarded write).
  logger.warn(`[tlsCert] All ${MAX_RETRIES + 1} attempts failed for ${domain}; marking error`);
  try {
    await db
      .update(tenantsTable)
      .set({
        tlsStatus: "error",
        tlsCertError:
          "HTTPS could not be established after multiple attempts (~15 min). " +
          "Verify your DNS CNAME is correct and that your hosting provider " +
          "has issued a certificate for this domain. Click Retry to try again.",
      })
      .where(
        and(
          eq(tenantsTable.id, tenantId),
          eq(tenantsTable.customDomain, domain),
        ),
      );
  } catch (err) {
    logger.error(err, `[tlsCert] Failed to write error status for ${domain}`);
  }
}

/**
 * Set tlsStatus = 'pending' (domain-guarded) and immediately kick off the
 * first HTTPS probe. The probe chain runs fire-and-forget; results are
 * written back to the DB as the state machine progresses.
 *
 * Safe to call after PATCH /domain — the WHERE guard ensures that if the
 * admin saves yet another domain before this resolves, the in-flight checks
 * for the previous domain will produce no-op DB updates.
 */
export async function triggerTlsProvisioning(
  tenantId: string,
  domain: string,
): Promise<void> {
  try {
    // Domain guard on the pending write too — if the domain was already
    // changed to something else by the time we run, this write is a no-op.
    await db
      .update(tenantsTable)
      .set({ tlsStatus: "pending", tlsCertError: null })
      .where(
        and(
          eq(tenantsTable.id, tenantId),
          eq(tenantsTable.customDomain, domain),
        ),
      );
  } catch (err) {
    logger.error(err, "[tlsCert] Failed to set tlsStatus=pending");
    return;
  }

  // Fire and forget — the probe chain writes results back asynchronously.
  checkTlsCert(tenantId, domain, 0).catch(() => {});
}
