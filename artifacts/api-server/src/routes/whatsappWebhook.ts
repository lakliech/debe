/**
 * Meta WhatsApp Business webhook — PUBLIC by design (Meta cannot hold Clerk
 * sessions; ownership is proven by the GET verification handshake).
 *
 *  GET  /api/webhooks/whatsapp — hub verification
 *  POST /api/webhooks/whatsapp — inbound supporter/agent messages → support
 *         tickets; delivery status callbacks → message_deliveries updates.
 *
 * Multi-tenant: each campaign's WhatsApp number has its own phone_number_id,
 * stored on tenants.whatsapp_phone_number_id. Events are routed to the owning
 * tenant by that id; events for unknown numbers are acked and dropped.
 */
import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import {
  tenantsTable,
  supportersTable,
  pollingAgentsTable,
  scheduledMessagesTable,
  messageDeliveriesTable,
  supportTicketsTable,
  supportTicketMessagesTable,
} from "@workspace/db";
import { eq, and, ne, desc, inArray, sql } from "drizzle-orm";

const router = Router();

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post("/", (req, res) => {
  // Authenticate BEFORE acking: Meta signs every event with the app secret
  // (X-Hub-Signature-256 over the raw request bytes — this route is mounted
  // with express.raw() ahead of the JSON parser, like the Stripe webhook).
  // The endpoint is public, so the signature is the only thing standing
  // between the internet and forged supporter messages / status mutations.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    logger.error("WHATSAPP_APP_SECRET not set — refusing webhook events");
    res.status(503).json({ error: "WhatsApp webhook not configured" });
    return;
  }
  const signature = req.headers["x-hub-signature-256"];
  const rawBody: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
  const expected = rawBody
    ? `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
    : null;
  const valid = typeof signature === "string" && !!expected
    && signature.length === expected.length
    && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) {
    logger.warn({ hasSignature: typeof signature === "string", hasRawBody: !!rawBody }, "whatsapp webhook rejected: bad signature");
    res.sendStatus(403);
    return;
  }

  // Ack immediately — Meta retries any slow/non-200 response, which would
  // duplicate inbound messages. Processing continues after the ack.
  res.sendStatus(200);
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody!.toString("utf8"));
  } catch {
    // verified signature but unparseable body — nothing to process
  }
  if (payload != null) {
    handlePayload(payload).catch((err) => logger.error({ err }, "whatsapp webhook processing failed"));
  }
});

async function handlePayload(body: any) {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // whatsapp_phone_number_id is DB-unique; if that invariant is ever
      // broken (bad manual SQL), refuse to route rather than guess a tenant.
      const matches = await db.select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.whatsappPhoneNumberId, phoneNumberId))
        .limit(2);
      if (matches.length > 1) {
        logger.error({ phoneNumberId, tenants: matches.map((m) => m.id) },
          "whatsapp phone_number_id mapped to multiple tenants — dropping event");
        return;
      }
      const tenant = matches[0];
      if (!tenant) {
        logger.warn({ phoneNumberId }, "whatsapp event for unknown phone_number_id — dropped");
        continue;
      }

      for (const st of value.statuses ?? []) {
        await applyStatusCallback(tenant.id, st);
      }
      const contactName = value.contacts?.[0]?.profile?.name ?? null;
      for (const msg of value.messages ?? []) {
        await handleInbound(tenant.id, msg, contactName);
      }
    }
  }
}

const DELIVERY_STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

async function applyStatusCallback(tenantId: string, st: any) {
  const mapped = DELIVERY_STATUS_MAP[st?.status];
  if (!mapped || !st?.id) return;
  // Scope through the parent scheduled message: a callback only ever mutates
  // deliveries belonging to the tenant that owns this WhatsApp number.
  await db.update(messageDeliveriesTable).set({
    status: mapped,
    ...(mapped === "delivered" || mapped === "read" ? { deliveredAt: new Date() } : {}),
    ...(st.status === "failed"
      ? { failureReason: st?.errors?.[0]?.title ?? st?.errors?.[0]?.message ?? "delivery failed" }
      : {}),
  }).where(and(
    eq(messageDeliveriesTable.providerMessageId, st.id),
    inArray(messageDeliveriesTable.scheduledMessageId,
      db.select({ id: scheduledMessagesTable.id }).from(scheduledMessagesTable)
        .where(eq(scheduledMessagesTable.tenantId, tenantId))),
  ));
}

async function handleInbound(tenantId: string, msg: any, contactName: string | null) {
  const from = msg?.from; // digits-only international, e.g. "254712345678"
  if (!from) return;
  const e164 = `+${from}`; // supporters/agents store numbers in E.164
  const body = typeof msg?.text?.body === "string"
    ? msg.text.body
    : `[${msg?.type ?? "unknown"} message]`;

  const [supporter] = await db.select({ id: supportersTable.id })
    .from(supportersTable)
    .where(and(eq(supportersTable.tenantId, tenantId), eq(supportersTable.phoneNumber, e164)))
    .limit(1);

  // A known polling agent's reply is agent traffic — station updates and
  // field reports land in the inbox tagged accordingly.
  const [agent] = await db.select({ id: pollingAgentsTable.id })
    .from(pollingAgentsTable)
    .where(and(eq(pollingAgentsTable.tenantId, tenantId), eq(pollingAgentsTable.phoneNumber, e164)))
    .limit(1);

  // One transaction per event: a per-conversation advisory lock serialises
  // concurrent deliveries (no duplicate open tickets), and the wamid dedupe
  // makes Meta retries idempotent (the partial unique index on wa_message_id
  // is the DB-level backstop).
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId + ":" + e164}))`);

    if (msg?.id) {
      const [dup] = await tx.select({ id: supportTicketMessagesTable.id })
        .from(supportTicketMessagesTable)
        .where(eq(supportTicketMessagesTable.waMessageId, msg.id))
        .limit(1);
      if (dup) return; // Meta retry — already processed
    }

    // Reuse the newest unresolved ticket for this phone, else open one.
    const [ticket] = await tx.select().from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.tenantId, tenantId),
        eq(supportTicketsTable.waPhone, e164),
        ne(supportTicketsTable.status, "resolved"),
      ))
      .orderBy(desc(supportTicketsTable.lastMessageAt))
      .limit(1);

    let ticketId: string;
    if (ticket) {
      ticketId = ticket.id;
      await tx.update(supportTicketsTable).set({
        lastMessageAt: new Date(),
        status: "open",
        unreadCount: sql`${supportTicketsTable.unreadCount} + 1`,
        ...(supporter && !ticket.supporterId ? { supporterId: supporter.id } : {}),
        ...(contactName && !ticket.contactName ? { contactName } : {}),
        ...(agent ? { category: "agent" } : {}),
      }).where(eq(supportTicketsTable.id, ticketId));
    } else {
      const [created] = await tx.insert(supportTicketsTable).values({
        tenantId,
        supporterId: supporter?.id ?? null,
        waPhone: e164,
        contactName,
        category: agent ? "agent" : "supporter",
        subject: body.length > 60 ? `${body.slice(0, 57)}…` : body,
        status: "open",
        unreadCount: 1,
        lastMessageAt: new Date(),
      }).returning();
      ticketId = created.id;
    }

    await tx.insert(supportTicketMessagesTable).values({
      ticketId,
      direction: "inbound",
      body,
      senderName: contactName,
      waMessageId: msg?.id ?? null,
    });
  });
}

export default router;
