/**
 * Platform security alerts.
 *
 * Privileged changes that nobody should be able to make quietly get mailed to
 * the platform team as a digest: a new global admin, or a bulk rewrite of a
 * role's permissions (which silently re-grants everyone holding that role).
 *
 * Recipients are the PLATFORM_ADMIN_EMAILS allowlist — the same addresses that
 * are trusted to hold operator standing — falling back to SUPPORT_EMAIL so an
 * environment that has not set an allowlist still gets told. Delivery is
 * fire-and-forget: an alert must never roll back the change it reports.
 */

import { sendEmailAsync } from "./email";
import { platformAdminEmails } from "./platformBootstrap";
import { logger } from "./logger";

/** Who receives security digests in this environment. */
export function securityAlertRecipients(): string[] {
  const allowlist = platformAdminEmails();
  if (allowlist.length > 0) return allowlist;
  const fallback = process.env.SUPPORT_EMAIL;
  return fallback ? [fallback.trim().toLowerCase()] : [];
}

export interface SecurityAlert {
  /** Email subject — lead with the event, it lands in a busy inbox. */
  subjectLine: string;
  /** One-line description of what happened. */
  summary: string;
  /** Supporting facts, one bullet per line. */
  details: string[];
}

/**
 * Mail a security digest to the platform team. Never throws and never waits —
 * safe to call from inside a request handler after the change has committed.
 */
export function sendSecurityAlert(alert: SecurityAlert): void {
  const recipients = securityAlertRecipients();
  if (recipients.length === 0) {
    logger.warn(
      { subject: alert.subjectLine },
      "[security] no PLATFORM_ADMIN_EMAILS or SUPPORT_EMAIL configured — security alert not sent",
    );
    return;
  }

  const stamped = [...alert.details, `Time: ${new Date().toISOString()}`];

  for (const to of recipients) {
    sendEmailAsync({
      to,
      // Platform-level event — not attributable to any one campaign.
      tenantId: null,
      template: "security_digest",
      data: {
        subjectLine: alert.subjectLine,
        summary: alert.summary,
        details: stamped,
      },
    });
  }

  logger.warn(
    { subject: alert.subjectLine, recipients: recipients.length },
    "[security] alert dispatched",
  );
}
