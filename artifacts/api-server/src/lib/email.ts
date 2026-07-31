/**
 * Transactional email service.
 *
 * Provider-agnostic wrapper. Configure with:
 *   EMAIL_PROVIDER  resend | sendgrid | console   (default: console)
 *   EMAIL_API_KEY   provider API key
 *   EMAIL_FROM      sender address, e.g. "Campaign Platform <hello@example.com>"
 *
 * Design rules:
 *  - sendEmail NEVER throws. Email is a side effect of a user action; a
 *    provider outage must not roll back the action that triggered it.
 *  - Every attempt is written to email_logs (sent | failed | skipped) so the
 *    platform team can debug delivery without provider dashboard access.
 *  - In development with no provider configured, emails are logged to stdout
 *    and recorded as "skipped" — the flow stays testable without credentials.
 */

import { db, emailLogsTable } from "@workspace/db";
import { logger } from "./logger";
import { renderTemplate, type TemplateKey, type TemplateData } from "./emailTemplates";

type Provider = "resend" | "sendgrid" | "console";

function provider(): Provider {
  const raw = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (raw === "resend" || raw === "sendgrid") return raw;
  return "console";
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "Campaign Platform <onboarding@resend.dev>";
}

export interface SendEmailArgs<K extends TemplateKey> {
  to: string;
  template: K;
  data: TemplateData[K];
  /** Tenant this email relates to, for the audit log. Null for platform-level mail. */
  tenantId?: string | null;
}

export interface SendEmailResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
  providerId?: string;
}

async function deliverResend(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ providerId?: string }> {
  const key = process.env.EMAIL_API_KEY;
  if (!key) throw new Error("EMAIL_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromAddress(), to: [to], subject, text, html }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${json?.message ?? JSON.stringify(json)}`);
  }
  return { providerId: json?.id };
}

async function deliverSendgrid(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ providerId?: string }> {
  const key = process.env.EMAIL_API_KEY;
  if (!key) throw new Error("EMAIL_API_KEY is not set");
  // SendGrid wants a bare address in `from.email`; strip any display name.
  const raw = fromAddress();
  const match = raw.match(/<(.+)>/);
  const fromEmail = match ? match[1] : raw;
  const fromName = match ? raw.slice(0, raw.indexOf("<")).trim() : undefined;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status}: ${body}`);
  }
  return { providerId: res.headers.get("x-message-id") ?? undefined };
}

/**
 * Send a transactional email and record the attempt.
 * Never throws — inspect the returned status if the caller cares.
 */
export async function sendEmail<K extends TemplateKey>(
  args: SendEmailArgs<K>,
): Promise<SendEmailResult> {
  const { to, template, data, tenantId = null } = args;

  let subject = "";
  let result: SendEmailResult;

  try {
    const rendered = renderTemplate(template, data);
    subject = rendered.subject;

    const p = provider();
    if (p === "console") {
      logger.info(
        { to, template, subject },
        "[email] provider not configured — logging instead of sending",
      );
      logger.debug({ body: rendered.text }, "[email] body");
      result = { status: "skipped" };
    } else if (p === "resend") {
      const { providerId } = await deliverResend(to, subject, rendered.text, rendered.html);
      result = { status: "sent", providerId };
    } else {
      const { providerId } = await deliverSendgrid(to, subject, rendered.text, rendered.html);
      result = { status: "sent", providerId };
    }
  } catch (err: any) {
    logger.error({ err, to, template }, "[email] send failed");
    result = { status: "failed", error: err?.message ?? String(err) };
  }

  // Audit — best effort. A logging failure must not surface to the caller.
  try {
    await db.insert(emailLogsTable).values({
      tenantId,
      recipient: to,
      template,
      subject: subject || null,
      status: result.status,
      error: result.error ?? null,
      providerId: result.providerId ?? null,
    });
  } catch (err) {
    logger.error({ err, to, template }, "[email] failed to write email_logs row");
  }

  return result;
}

/**
 * Fire-and-forget variant. Use inside request handlers where the response
 * should not wait on email delivery.
 */
export function sendEmailAsync<K extends TemplateKey>(args: SendEmailArgs<K>): void {
  void sendEmail(args).catch(() => {
    /* sendEmail already logs; nothing further to do */
  });
}
