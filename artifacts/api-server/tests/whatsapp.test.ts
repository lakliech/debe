/**
 * WhatsApp integration tests — Cloud API adapter (fetch stubbed) and the
 * public webhook (hub verification, inbound → tickets, status callbacks).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "http";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  supportersTable,
  pollingAgentsTable,
  messageTemplatesTable,
  audienceSegmentsTable,
  scheduledMessagesTable,
  messageDeliveriesTable,
  supportTicketsTable,
  supportTicketMessagesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import webhookRouter from "../src/routes/whatsappWebhook";
import { sendWhatsAppText, toWaAddress } from "../src/lib/whatsapp";

const PHONE_NUMBER_ID = "pn-test-1";
const tenantIds: string[] = [];
const userIds: string[] = [];
let tenantId: string;
let creatorId: string;
let server: Server;
let base = "";

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function waPayload(opts: {
  phoneNumberId?: string;
  from?: string;
  body?: string;
  msgId?: string;
  name?: string;
  statuses?: any[];
}) {
  return {
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: opts.phoneNumberId ?? PHONE_NUMBER_ID },
          ...(opts.name ? { contacts: [{ profile: { name: opts.name }, wa_id: opts.from }] } : {}),
          ...(opts.from ? { messages: [{ from: opts.from, id: opts.msgId ?? "wamid.t1", type: "text", text: { body: opts.body } }] } : {}),
          ...(opts.statuses ? { statuses: opts.statuses } : {}),
        },
      }],
    }],
  };
}

function post(payload: any, signWith: string | undefined = process.env.WHATSAPP_APP_SECRET) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signWith) {
    headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", signWith).update(raw).digest("hex")}`;
  }
  return fetch(`${base}/api/webhooks/whatsapp`, { method: "POST", headers, body: raw });
}

beforeAll(async () => {
  tenantId = randomUUID();
  await db.insert(tenantsTable).values({
    id: tenantId, name: "WA Test Campaign", slug: `wa-test-${tenantId.slice(0, 8)}`,
    whatsappPhoneNumberId: PHONE_NUMBER_ID,
  } as any);
  tenantIds.push(tenantId);

  creatorId = randomUUID();
  await db.insert(usersTable).values({
    id: creatorId, clerkId: `wa-${creatorId.slice(0, 8)}`,
    email: `wa-${creatorId.slice(0, 8)}@test.dev`, fullName: "WA Test Admin",
  } as any);
  userIds.push(creatorId);

  process.env.WHATSAPP_APP_SECRET = "test-app-secret";
  const app = express();
  // Match production: the webhook route receives the raw body for signature checks.
  app.use("/api/webhooks/whatsapp", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/api/webhooks/whatsapp", webhookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

afterAll(async () => {
  delete process.env.WHATSAPP_APP_SECRET;
  await new Promise((r) => server.close(r));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

describe("tenant phone-number uniqueness", () => {
  it("rejects a second campaign claiming the same Meta number", async () => {
    await expect(db.insert(tenantsTable).values({
      id: randomUUID(), name: "WA Dup", slug: `wa-dup-${randomUUID().slice(0, 8)}`,
      whatsappPhoneNumberId: PHONE_NUMBER_ID, // already taken by the fixture tenant
    } as any)).rejects.toThrow();
  });
});

describe("whatsapp webhook verification", () => {
  it("rejects a wrong verify token and accepts the right one", async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-secret";
    const bad = await fetch(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`);
    expect(bad.status).toBe(403);
    const good = await fetch(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=abc123`);
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("abc123");
  });
});

describe("inbound messages → support tickets", () => {
  it("creates a ticket linked to the known supporter", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Wanjiru Supporter", phoneNumber: "+254700000777", consentSms: true },
    ] as any);

    const res = await post(waPayload({ from: "254700000777", body: "Nina swali kuhusu chama", name: "Wanjiru" }));
    expect(res.status).toBe(200); // acked immediately

    const ticket = await waitFor(async () =>
      (await db.select().from(supportTicketsTable)
        .where(and(eq(supportTicketsTable.tenantId, tenantId), eq(supportTicketsTable.waPhone, "+254700000777"))))[0]);
    expect(ticket.category).toBe("supporter");
    expect(ticket.unreadCount).toBe(1);
    expect(ticket.subject).toContain("Nina swali");
    expect(ticket.contactName).toBe("Wanjiru");
    const [supporter] = await db.select({ id: supportersTable.id }).from(supportersTable)
      .where(and(eq(supportersTable.tenantId, tenantId), eq(supportersTable.phoneNumber, "+254700000777")));
    expect(ticket.supporterId).toBe(supporter.id);

    const msgs = await waitFor(async () => {
      const rows = await db.select().from(supportTicketMessagesTable)
        .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
      return rows.length ? rows : null;
    });
    expect(msgs[0].direction).toBe("inbound");
    expect(msgs[0].body).toBe("Nina swali kuhusu chama");
  });

  it("reuses the open ticket for follow-up messages and bumps unread", async () => {
    const before = await waitFor(async () =>
      (await db.select().from(supportTicketsTable)
        .where(and(eq(supportTicketsTable.tenantId, tenantId), eq(supportTicketsTable.waPhone, "+254700000777"))))[0]);

    await post(waPayload({ from: "254700000777", body: "Je, kuna mkutano?", msgId: "wamid.t2" }));
    const after = await waitFor(async () => {
      const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, before.id));
      return t.unreadCount >= 2 ? t : null;
    });
    expect(after.id).toBe(before.id); // same conversation, not a new ticket
    const msgs = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, before.id));
    expect(msgs.length).toBe(2);
  });

  it("tags tickets from known polling agents as agent traffic", async () => {
    await db.insert(pollingAgentsTable).values([
      { tenantId, fullName: "Agent Kiprop", phoneNumber: "+254700000888" },
    ] as any);
    await post(waPayload({ from: "254700000888", body: "Nimefika kituo", msgId: "wamid.t3" }));

    const ticket = await waitFor(async () =>
      (await db.select().from(supportTicketsTable)
        .where(and(eq(supportTicketsTable.tenantId, tenantId), eq(supportTicketsTable.waPhone, "+254700000888"))))[0]);
    expect(ticket.category).toBe("agent");
  });

  it("acks but drops events for an unknown phone_number_id", async () => {
    const res = await post(waPayload({ phoneNumberId: "pn-unknown", from: "254700000999", body: "hi", msgId: "wamid.t4" }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const rows = await db.select().from(supportTicketsTable)
      .where(eq(supportTicketsTable.waPhone, "+254700000999"));
    expect(rows).toHaveLength(0);
  });

  it("rejects forged events without a valid signature", async () => {
    const res = await post(waPayload({ from: "254700000666", body: "forged", msgId: "wamid.f1" }), "wrong-secret");
    expect(res.status).toBe(403);
    await new Promise((r) => setTimeout(r, 200));
    const rows = await db.select().from(supportTicketsTable)
      .where(eq(supportTicketsTable.waPhone, "+254700000666"));
    expect(rows).toHaveLength(0);
  });

  it("is idempotent on Meta retries of the same message id", async () => {
    const payload = waPayload({ from: "254700000111", body: "Habari", msgId: "wamid.dup1", name: "Dup" });
    await post(payload);
    const ticket = await waitFor(async () =>
      (await db.select().from(supportTicketsTable)
        .where(and(eq(supportTicketsTable.tenantId, tenantId), eq(supportTicketsTable.waPhone, "+254700000111"))))[0]);
    expect(ticket.unreadCount).toBe(1);

    // Same wamid delivered again (Meta retry) — must not duplicate the
    // message or bump unread a second time.
    await post(payload);
    await new Promise((r) => setTimeout(r, 400));
    const msgs = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    expect(msgs).toHaveLength(1);
    const [after] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, ticket.id));
    expect(after.unreadCount).toBe(1);
  });
});

describe("delivery status callbacks", () => {
  it("updates message_deliveries by providerMessageId", async () => {
    const [tmpl] = await db.insert(messageTemplatesTable).values({
      tenantId, name: `WA Tmpl ${randomUUID().slice(0, 6)}`, channel: "whatsapp", category: "general",
      bodyEn: "Hi {{name}}", bodySw: "Habari {{name}}", status: "approved", createdBy: creatorId,
    } as any).returning();
    const [seg] = await db.insert(audienceSegmentsTable).values({
      tenantId, name: `WA Seg ${randomUUID().slice(0, 6)}`, filters: {}, createdBy: creatorId,
    } as any).returning();
    const [msg] = await db.insert(scheduledMessagesTable).values({
      tenantId, templateId: tmpl.id, segmentId: seg.id,
      scheduledAt: new Date(Date.now() - 60_000), status: "sending", createdBy: creatorId,
    } as any).returning();
    const [delivery] = await db.insert(messageDeliveriesTable).values({
      scheduledMessageId: msg.id, channel: "whatsapp",
      recipientPhone: "+254700000555", providerMessageId: "wamid.d1", status: "sent",
    } as any).returning();

    await post(waPayload({ statuses: [{ id: "wamid.d1", status: "delivered", timestamp: "1700000000" }] }));
    const updated = await waitFor(async () => {
      const [d] = await db.select().from(messageDeliveriesTable).where(eq(messageDeliveriesTable.id, delivery.id));
      return d.status === "delivered" ? d : null;
    });
    expect(updated.deliveredAt).toBeTruthy();

    await post(waPayload({ statuses: [{ id: "wamid.d1", status: "failed", errors: [{ title: "Recipient not on WhatsApp" }] }] }));
    const failed = await waitFor(async () => {
      const [d] = await db.select().from(messageDeliveriesTable).where(eq(messageDeliveriesTable.id, delivery.id));
      return d.status === "failed" ? d : null;
    });
    expect(failed.failureReason).toContain("not on WhatsApp");
  });
});

describe("whatsapp cloud adapter", () => {
  it("posts to the Graph API with bearer auth and normalised address", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "wa-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    const fetchMock = vi.fn(async (_url: string, _init: any) => ({
      ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.sent1" }] }),
    }) as any);
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendWhatsAppText("+254 700 000 999", "Habari yako");
    expect(res.ok).toBe(true);
    expect(res.providerMessageId).toBe("wamid.sent1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    expect(init.headers.Authorization).toBe("Bearer wa-token");
    const payload = JSON.parse(init.body);
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.to).toBe("254700000999"); // digits-only
    expect(payload.text.body).toBe("Habari yako");
  });

  it("surfaces Graph API errors instead of throwing", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "wa-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: "Invalid recipient" } }),
    }) as any));
    const res = await sendWhatsAppText("+254700000000", "test");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Invalid recipient");
  });

  it("sends from the campaign's own number when one is connected", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "wa-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "platform-default";
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.t1" }] }),
    }) as any);
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsAppText("+254700000001", "hi", "tenant-own-pnid");
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/tenant-own-pnid/messages");
  });

  it("fails closed when the Cloud API is not configured", async () => {
    const res = await sendWhatsAppText("+254700000000", "test");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not configured");
  });

  it("normalises phone numbers to Meta's digits-only format", () => {
    expect(toWaAddress("+254 700 000 999")).toBe("254700000999");
    expect(toWaAddress("0712345678".replace(/^0/, "254"))).toBe("254712345678");
  });
});
