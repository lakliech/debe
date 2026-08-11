/**
 * Communications dispatcher — polls scheduled_messages for due, approved
 * sends and dispatches them to the segment's recipients.
 *
 * Provider model: one generic HTTPS webhook per channel, configured by env:
 *   COMMS_SMS_WEBHOOK_URL / COMMS_EMAIL_WEBHOOK_URL / COMMS_WHATSAPP_WEBHOOK_URL
 *   COMMS_WEBHOOK_TOKEN (optional shared bearer)
 * The endpoint receives POST { to, channel, subject, body, deliveryId } and
 * must answer 2xx with an optional { id } captured as providerMessageId.
 * Works with Africa's Talking / Twilio via a thin relay, or any gateway.
 *
 * If no webhook is configured for a channel, messages stay 'approved' and are
 * retried on the next tick — nothing is burned, lost, or falsely marked sent.
 */
import { logger } from "./logger";
import { logActivity } from "./activityFeed";
import { sendWhatsAppText, whatsappCloudConfigured } from "./whatsapp";
import { decryptSecret } from "./mpesa";
import { tenantWhatsappConfigsTable } from "@workspace/db";
import { db } from "@workspace/db";
import {
  scheduledMessagesTable,
  messageTemplatesTable,
  audienceSegmentsTable,
  messageDeliveriesTable,
  supportersTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, lte, isNull, inArray, asc } from "drizzle-orm";

const POLL_MS = 60_000;
const STUCK_MINUTES = 15;
const SEND_CONCURRENCY = 10;

function webhookFor(channel: string): string | null {
  const url = process.env[`COMMS_${channel.toUpperCase()}_WEBHOOK_URL`];
  return url && url.trim() ? url.trim() : null;
}

async function sendViaWebhook(
  url: string,
  payload: { to: string; channel: string; subject?: string | null; body: string; deliveryId: string },
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.COMMS_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.COMMS_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `provider responded ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: true, providerMessageId: typeof data?.id === "string" ? data.id : undefined };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "provider unreachable" };
  }
}

type ChannelProvider = { kind: "wa-cloud" } | { kind: "webhook"; url: string };

type TenantWaCreds = { phoneId?: string; token?: string };

/**
 * A campaign's own WhatsApp credentials, provisioned via Settings →
 * Integrations (tenant_whatsapp_configs, token encrypted at rest). Falls
 * back to the legacy sender-identity column, which rides on the platform
 * access token.
 */
async function tenantWhatsappCreds(tenantId: string): Promise<TenantWaCreds> {
  const [cfg] = await db.select().from(tenantWhatsappConfigsTable)
    .where(eq(tenantWhatsappConfigsTable.tenantId, tenantId)).limit(1);
  if (cfg?.enabled) return { phoneId: cfg.phoneNumberId, token: decryptSecret(cfg.accessToken) };
  const [t] = await db.select({ pnid: tenantsTable.whatsappPhoneNumberId })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  return { phoneId: t?.pnid ?? undefined };
}

/** Cloud API usable when we have a sender number plus either token source. */
function waCloudReady(creds: TenantWaCreds | undefined): boolean {
  if (creds?.phoneId) return Boolean(creds.token) || whatsappCloudConfigured(creds.phoneId);
  return whatsappCloudConfigured();
}

/**
 * Provider chain per channel: WhatsApp uses the real Cloud API when
 * configured (campaign's own number if connected, else the platform number);
 * every channel falls back to its generic webhook env.
 */
function providerFor(channel: string, waCreds?: TenantWaCreds): ChannelProvider | null {
  if (channel === "whatsapp" && waCloudReady(waCreds)) return { kind: "wa-cloud" };
  const url = webhookFor(channel);
  return url ? { kind: "webhook", url } : null;
}

/**
 * Direct single-recipient WhatsApp send — used by result alerts and support
 * ticket replies, which bypass the scheduled-message queue. Tenant context is
 * mandatory so the send originates from that campaign's WhatsApp identity.
 */
export async function sendWhatsappChannel(tenantId: string, to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const creds = await tenantWhatsappCreds(tenantId);
  if (waCloudReady(creds)) return sendWhatsAppText(to, body, creds.phoneId, creds.token);
  const url = webhookFor("whatsapp");
  if (!url) return { ok: false, error: "no whatsapp provider configured" };
  return sendViaWebhook(url, { to, channel: "whatsapp", body, deliveryId: "direct" });
}

function templateCopy(tmpl: any, lang: string): { body: string; subject: string | null } {
  const body =
    lang === "sw" ? tmpl.bodySw
    : lang === "local" ? (tmpl.bodyLocal ?? tmpl.bodyEn)
    : tmpl.bodyEn;
  const subject = lang === "sw" ? tmpl.subjectSw : tmpl.subjectEn;
  return { body, subject };
}

async function resolveRecipients(tenantId: string, segment: any, channel: string, limit: number, offset: number) {
  const filters = (segment?.filters ?? {}) as any;
  const conds: any[] = [eq(supportersTable.tenantId, tenantId)];
  if (Array.isArray(filters.countyIds) && filters.countyIds.length) {
    conds.push(inArray(supportersTable.countyId, filters.countyIds));
  }
  if (Array.isArray(filters.constituencyIds) && filters.constituencyIds.length) {
    conds.push(inArray(supportersTable.constituencyId, filters.constituencyIds));
  }
  if (Array.isArray(filters.wardIds) && filters.wardIds.length) {
    conds.push(inArray(supportersTable.wardId, filters.wardIds));
  }
  // Consent is channel-specific and mandatory — marketing law (Kenya DPA 2019).
  if (channel === "sms" || channel === "whatsapp") conds.push(eq(supportersTable.consentSms, true));
  if (channel === "email") conds.push(eq(supportersTable.consentEmail, true));

  // Raw page in stable id order. Callers MUST advance by the raw page size:
  // contacts without an address for this channel are filtered afterwards,
  // and advancing by the filtered count would overlap pages (duplicate
  // sends) or truncate the segment (skipped recipients).
  return db
    .select({
      id: supportersTable.id,
      fullName: supportersTable.fullName,
      phone: supportersTable.phoneNumber,
      email: supportersTable.email,
    })
    .from(supportersTable)
    .where(and(...conds))
    .orderBy(supportersTable.id)
    .limit(limit)
    .offset(offset);
}

async function dispatchOne(msg: any, batchSize: number): Promise<boolean> {
  const [tmpl] = await db.select().from(messageTemplatesTable)
    .where(eq(messageTemplatesTable.id, msg.templateId));
  if (!tmpl) {
    await db.update(scheduledMessagesTable)
      .set({ status: "failed" })
      .where(eq(scheduledMessagesTable.id, msg.id));
    logger.error({ scheduledMessageId: msg.id }, "comms dispatch failed: template missing");
    return false;
  }

  const channel: string = tmpl.channel;
  // Per-tenant sender identity: a campaign with its own WhatsApp number
  // connected sends from it; everyone else uses the platform number.
  const tenantWa = channel === "whatsapp" ? await tenantWhatsappCreds(msg.tenantId) : undefined;
  const provider = providerFor(channel, tenantWa);
  if (!provider) {
    // Not an error state — leave the message 'approved' so it goes out as
    // soon as a provider is configured.
    logger.warn({ scheduledMessageId: msg.id, channel }, "comms dispatch deferred: no provider configured for channel");
    return false;
  }

  // Claim the send atomically so two dispatcher ticks (or instances) can
  // never double-send the same message.
  const [claimed] = await db.update(scheduledMessagesTable)
    .set({ status: "sending" })
    .where(and(eq(scheduledMessagesTable.id, msg.id), eq(scheduledMessagesTable.status, "approved")))
    .returning();
  if (!claimed) return false;

  const [segment] = await db.select().from(audienceSegmentsTable)
    .where(eq(audienceSegmentsTable.id, msg.segmentId));
  const { body, subject } = templateCopy(tmpl, msg.languageCode);

  // Recipients are processed in batches so memory stays bounded on huge
  // segments. Between batches we re-check the message status — an emergency
  // suspension stops the send — and persist progress, which also touches
  // updatedAt so stuck-send recovery can never reclaim a live send.
  let offset = 0;
  let sent = 0;
  let failed = 0;
  let total = 0;
  let suspended = false;

  while (true) {
    const [cur] = await db.select({ status: scheduledMessagesTable.status })
      .from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    if (cur?.status !== "sending") { suspended = true; break; }

    const page = await resolveRecipients(msg.tenantId, segment, channel, batchSize, offset);
    if (page.length === 0) break;
    offset += page.length; // RAW page size — see resolveRecipients

    // Channel-specific address: sms/whatsapp need a phone, email needs an
    // address — contacts without one for this channel are skipped.
    const recipients = page
      .map((r) => ({ ...r, to: channel === "email" ? r.email : r.phone }))
      .filter((r) => r.to != null && r.to !== "");

    if (recipients.length > 0) {
      const deliveries = await db.insert(messageDeliveriesTable).values(
        recipients.map((r) => ({
          scheduledMessageId: msg.id,
          channel,
          recipientPhone: channel === "email" ? null : r.to,
          recipientEmail: channel === "email" ? r.to : null,
        })),
      ).returning();
      total += deliveries.length;

      for (let i = 0; i < deliveries.length; i += SEND_CONCURRENCY) {
        const chunk = deliveries.slice(i, i + SEND_CONCURRENCY);
        await Promise.all(chunk.map(async (d, j) => {
          const r = recipients[i + j];
          const personalised = String(body).replaceAll("{{name}}", r.fullName ?? "");
          const res = provider.kind === "wa-cloud"
            ? await sendWhatsAppText(r.to!, personalised, tenantWa?.phoneId, tenantWa?.token)
            : await sendViaWebhook(provider.url, {
                to: r.to!, channel, subject, body: personalised, deliveryId: d.id,
              });
          if (res.ok) sent++; else failed++;
          await db.update(messageDeliveriesTable).set({
            status: res.ok ? "sent" : "failed",
            providerMessageId: res.providerMessageId,
            failureReason: res.ok ? null : res.error ?? "send failed",
            deliveredAt: res.ok ? new Date() : undefined,
          }).where(eq(messageDeliveriesTable.id, d.id));
        }));
      }

      // Progress checkpoint — keeps counts live and the row "alive" for
      // stuck detection (updatedAt is the liveness signal).
      await db.update(scheduledMessagesTable).set({
        actualRecipients: total,
        deliveredCount: sent,
        failedCount: failed,
      }).where(eq(scheduledMessagesTable.id, msg.id));
    }

    if (page.length < batchSize) break; // short raw page = end of segment
  }

  // The terminal status only lands if the message is still ours to finish —
  // an emergency suspension mid-send must never be overwritten with "sent".
  if (!suspended) {
    await db.update(scheduledMessagesTable).set({
      status: sent === 0 && failed > 0 && total > 0 ? "failed" : "sent",
      sentAt: new Date(),
    }).where(and(eq(scheduledMessagesTable.id, msg.id), eq(scheduledMessagesTable.status, "sending")));
  }

  if (total > 0) {
    void logActivity({
      tenantId: msg.tenantId,
      actorUserId: msg.createdBy,
      type: "message_dispatched",
      description: suspended
        ? `Scheduled message partially dispatched before suspension — ${sent} sent, ${failed} failed`
        : `Scheduled message dispatched — ${sent} sent, ${failed} failed`,
      resource: "scheduled_message",
      resourceId: msg.id,
    });
  }
  logger.info({ scheduledMessageId: msg.id, recipients: total, sent, failed, suspended }, "comms message dispatched");
  return !suspended;
}

export async function dispatchDueMessages(opts: { batchSize?: number; limit?: number } = {}): Promise<{ dispatched: number }> {
  const batchSize = opts.batchSize ?? 500;
  const limit = opts.limit ?? 10;
  // Recover sends orphaned by a crash: a message stuck 'sending' past the
  // grace window — measured from its LAST ACTIVITY (updatedAt), not
  // scheduledAt, so a long-running send is never mistaken for a stuck one —
  // goes back to 'approved' for a clean retry, but only if nothing actually
  // went out. If anything DID go out we leave it for a human — resending
  // could double-text supporters.
  const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000);
  const stuck = await db.select({ id: scheduledMessagesTable.id })
    .from(scheduledMessagesTable)
    .where(and(
      eq(scheduledMessagesTable.status, "sending"),
      lte(scheduledMessagesTable.updatedAt, stuckBefore),
    ));
  for (const s of stuck) {
    const [wentOut] = await db.select({ id: messageDeliveriesTable.id })
      .from(messageDeliveriesTable)
      .where(and(
        eq(messageDeliveriesTable.scheduledMessageId, s.id),
        inArray(messageDeliveriesTable.status, ["sent", "delivered"]),
      ))
      .limit(1);
    if (!wentOut) {
      // Atomic conditional claim: reset only if the row is STILL 'sending'
      // AND still stale — a live sender that checkpointed (moving updatedAt)
      // between our selection and this claim must not be clobbered. Delivery
      // cleanup rides the same transaction so no other instance can claim
      // the row and recreate deliveries in between.
      const reset = await db.transaction(async (tx) => {
        const [row] = await tx.update(scheduledMessagesTable).set({ status: "approved" })
          .where(and(
            eq(scheduledMessagesTable.id, s.id),
            eq(scheduledMessagesTable.status, "sending"),
            lte(scheduledMessagesTable.updatedAt, stuckBefore),
          ))
          .returning({ id: scheduledMessagesTable.id });
        if (row) {
          await tx.delete(messageDeliveriesTable)
            .where(eq(messageDeliveriesTable.scheduledMessageId, s.id));
        }
        return row ?? null;
      });
      if (reset) logger.warn({ scheduledMessageId: s.id }, "comms dispatch recovered a stuck send");
    }
  }

  const due = await db.select().from(scheduledMessagesTable)
    .where(and(
      eq(scheduledMessagesTable.status, "approved"),
      lte(scheduledMessagesTable.scheduledAt, new Date()),
      isNull(scheduledMessagesTable.emergencySuspendedAt),
    ))
    .orderBy(asc(scheduledMessagesTable.scheduledAt))
    .limit(limit);

  let dispatched = 0;
  for (const msg of due) {
    try {
      if (await dispatchOne(msg, batchSize)) dispatched++;
    } catch (err) {
      logger.error({ err, scheduledMessageId: msg.id }, "comms dispatch failed");
    }
  }
  return { dispatched };
}

/** Starts the polling loop. No-op when COMMS_DISPATCHER_DISABLED=1. */
export function startCommsDispatcher(): void {
  if (process.env.COMMS_DISPATCHER_DISABLED === "1") {
    logger.info("comms dispatcher disabled by env");
    return;
  }
  const tick = () => dispatchDueMessages().catch((err) => logger.error({ err }, "comms dispatcher tick failed"));
  setTimeout(tick, 10_000).unref();
  setInterval(tick, POLL_MS).unref();
  logger.info({ pollMs: POLL_MS }, "comms dispatcher started");
}
