/**
 * Communications dispatcher tests — exercises dispatchDueMessages() directly
 * against the dev DB with the provider webhook stubbed via global fetch.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  messageTemplatesTable,
  audienceSegmentsTable,
  scheduledMessagesTable,
  messageDeliveriesTable,
  supportersTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { dispatchDueMessages } from "../src/lib/commsDispatcher";

const tenantIds: string[] = [];
const userIds: string[] = [];
let tenantId: string;
let creatorId: string;

async function makeTenant() {
  const id = randomUUID();
  const slug = `comms-test-${id.slice(0, 8)}`;
  await db.insert(tenantsTable).values({ id, name: "Comms Test Campaign", slug } as any);
  tenantIds.push(id);
  return id;
}

async function makeMessage(opts: {
  channel?: string;
  status?: string;
  scheduledAt?: Date;
  emergencySuspendedAt?: Date | null;
  bodyEn?: string;
  tenantId?: string;
} = {}) {
  const tid = opts.tenantId ?? tenantId;
  const [tmpl] = await db.insert(messageTemplatesTable).values({
    tenantId: tid,
    name: `Tmpl ${randomUUID().slice(0, 6)}`,
    channel: opts.channel ?? "sms",
    category: "general",
    bodyEn: opts.bodyEn ?? "Hello {{name}}, vote on Aug 10!",
    bodySw: "Habari {{name}}",
    status: "approved",
    createdBy: creatorId,
  } as any).returning();
  const [seg] = await db.insert(audienceSegmentsTable).values({
    tenantId: tid, name: `Seg ${randomUUID().slice(0, 6)}`, filters: {}, createdBy: creatorId,
  } as any).returning();
  const [msg] = await db.insert(scheduledMessagesTable).values({
    tenantId: tid,
    templateId: tmpl.id,
    segmentId: seg.id,
    scheduledAt: opts.scheduledAt ?? new Date(Date.now() - 60_000),
    status: opts.status ?? "approved",
    emergencySuspendedAt: opts.emergencySuspendedAt ?? null,
    createdBy: creatorId,
  } as any).returning();
  return msg;
}

function stubProvider(handler: (payload: any) => { ok: boolean; status?: number; body?: any }) {
  const calls: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    const r = handler(payload);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} } as any;
  }));
  return calls;
}

beforeAll(async () => {
  tenantId = await makeTenant();
  const uid = randomUUID();
  await db.insert(usersTable).values({
    id: uid,
    clerkId: `comms-test-${uid.slice(0, 8)}`,
    email: `comms-test-${uid.slice(0, 8)}@test.dev`,
    fullName: "Comms Test Admin",
  } as any);
  userIds.push(uid);
  creatorId = uid;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMMS_SMS_WEBHOOK_URL;
  delete process.env.COMMS_EMAIL_WEBHOOK_URL;
});

afterAll(async () => {
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

describe("comms dispatcher", () => {
  it("dispatches a due approved SMS to consenting supporters and marks it sent", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Amina Otieno", phoneNumber: "+254700000001", consentSms: true },
      { tenantId, fullName: "Baraka NoPhone", consentSms: true },               // no phone → skipped
      { tenantId, fullName: "Chacha NoConsent", phoneNumber: "+254700000003" }, // no consent → skipped
    ] as any);
    const msg = await makeMessage();

    const calls = stubProvider(() => ({ ok: true, body: { id: "pm-123" } }));
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";

    const { dispatched } = await dispatchDueMessages();
    expect(dispatched).toBe(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("+254700000001");
    expect(calls[0].body).toContain("Amina Otieno"); // {{name}} substituted
    expect(calls[0].deliveryId).toBeTruthy();

    const [updated] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(updated.status).toBe("sent");
    expect(updated.actualRecipients).toBe(1);
    expect(updated.deliveredCount).toBe(1);
    expect(updated.failedCount).toBe(0);
    expect(updated.sentAt).toBeTruthy();

    const deliveries = await db.select().from(messageDeliveriesTable)
      .where(eq(messageDeliveriesTable.scheduledMessageId, msg.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");
    expect(deliveries[0].providerMessageId).toBe("pm-123");
    expect(deliveries[0].recipientPhone).toBe("+254700000001");
  });

  it("leaves the message approved and sends nothing when no provider is configured", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Dalia Provider-less", phoneNumber: "+254700000010", consentSms: true },
    ] as any);
    const msg = await makeMessage();
    // No COMMS_SMS_WEBHOOK_URL set
    const { dispatched } = await dispatchDueMessages();
    expect(dispatched).toBe(0);

    const [updated] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(updated.status).toBe("approved");
    const deliveries = await db.select().from(messageDeliveriesTable)
      .where(eq(messageDeliveriesTable.scheduledMessageId, msg.id));
    expect(deliveries).toHaveLength(0);
  });

  it("marks the message failed when the provider rejects the send", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Ekuru Fails", phoneNumber: "+254700000020", consentSms: true },
    ] as any);
    const msg = await makeMessage();

    stubProvider(() => ({ ok: false, status: 502 }));
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";

    await dispatchDueMessages();
    const [updated] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(updated.status).toBe("failed");
    // The tenant accumulates supporters across tests in this suite, so assert
    // on the ratio and on this test's own recipient rather than a raw count.
    expect(updated.failedCount).toBe(updated.actualRecipients);
    const [d] = await db.select().from(messageDeliveriesTable)
      .where(and(
        eq(messageDeliveriesTable.scheduledMessageId, msg.id),
        eq(messageDeliveriesTable.recipientPhone, "+254700000020"),
      ));
    expect(d.status).toBe("failed");
    expect(d.failureReason).toContain("502");
  });

  it("uses email consent + address for email templates", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Fatuma Mail", email: "fatuma@example.com", phoneNumber: "+254700000030", consentEmail: true },
      { tenantId, fullName: "Gitau SmsOnly", email: "gitau@example.com", consentSms: true }, // no email consent
    ] as any);
    const msg = await makeMessage({ channel: "email" });

    const calls = stubProvider(() => ({ ok: true, body: {} }));
    process.env.COMMS_EMAIL_WEBHOOK_URL = "https://provider.test/email";

    await dispatchDueMessages();
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("fatuma@example.com");
    expect(calls[0].channel).toBe("email");
  });

  it("does not touch future or emergency-suspended messages", async () => {
    const future = await makeMessage({ scheduledAt: new Date(Date.now() + 3_600_000) });
    const suspended = await makeMessage({ emergencySuspendedAt: new Date() });
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";
    const calls = stubProvider(() => ({ ok: true }));

    await dispatchDueMessages();
    expect(calls).toHaveLength(0);
    for (const id of [future.id, suspended.id]) {
      const [m] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, id));
      expect(m.status).toBe("approved");
    }
  });

  it("never overwrites an emergency suspension that lands mid-send", async () => {
    await db.insert(supportersTable).values([
      { tenantId, fullName: "Halima Suspend", phoneNumber: "+254700000040", consentSms: true },
    ] as any);
    const msg = await makeMessage();
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";

    // The provider call itself triggers the suspension (supervisor hits the
    // kill switch while the send is in flight).
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      await db.update(scheduledMessagesTable)
        .set({ status: "cancelled", emergencySuspendedAt: new Date() })
        .where(eq(scheduledMessagesTable.id, msg.id));
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }));

    await dispatchDueMessages();
    const [updated] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    // The terminal update is conditional on status='sending' — the
    // suspension must survive, not be clobbered with "sent".
    expect(updated.status).toBe("cancelled");
  });

  it("recovers a stuck send only after a grace window measured from last activity", async () => {
    const msg = await makeMessage({ status: "sending" });
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";
    stubProvider(() => ({ ok: true, body: {} }));

    // Recently claimed (updatedAt = now) → recovery must leave it alone.
    await dispatchDueMessages();
    let [m] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(m.status).toBe("sending");

    // Stale (no activity for 20 min) with nothing sent → recovered, then
    // redispatched in the same tick (provider is configured here).
    await db.execute(sql`update scheduled_messages set updated_at = now() - interval '20 minutes' where id = ${msg.id}`);
    await dispatchDueMessages();
    [m] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(m.status).toBe("sent");
  });

  it("paginates recipients exactly once across batch boundaries, skipping contacts without a phone", async () => {
    // Fresh tenant so the page composition is fully controlled (the shared
    // tenant accumulates supporters across tests in this suite).
    const t2 = await makeTenant();
    const phones = ["+254700000101", "+254700000102", "+254700000103", "+254700000104", "+254700000105"];
    await db.insert(supportersTable).values([
      { tenantId: t2, fullName: "Valid One", phoneNumber: phones[0], consentSms: true },
      { tenantId: t2, fullName: "No Phone A", consentSms: true },
      { tenantId: t2, fullName: "Valid Two", phoneNumber: phones[1], consentSms: true },
      { tenantId: t2, fullName: "Valid Three", phoneNumber: phones[2], consentSms: true },
      { tenantId: t2, fullName: "No Phone B", consentSms: true },
      { tenantId: t2, fullName: "Valid Four", phoneNumber: phones[3], consentSms: true },
      { tenantId: t2, fullName: "Valid Five", phoneNumber: phones[4], consentSms: true },
    ] as any);
    const msg = await makeMessage({ tenantId: t2 });
    process.env.COMMS_SMS_WEBHOOK_URL = "https://provider.test/sms";
    const calls = stubProvider(() => ({ ok: true, body: {} }));

    // batchSize 2 forces page boundaries through pages containing contacts
    // with no phone — every valid contact must get exactly one send.
    await dispatchDueMessages({ batchSize: 2 });

    expect(calls).toHaveLength(5);
    expect(new Set(calls.map((c) => c.to)).size).toBe(5);
    const [updated] = await db.select().from(scheduledMessagesTable).where(eq(scheduledMessagesTable.id, msg.id));
    expect(updated.status).toBe("sent");
    expect(updated.actualRecipients).toBe(5);
    expect(updated.deliveredCount).toBe(5);
    const deliveries = await db.select().from(messageDeliveriesTable)
      .where(eq(messageDeliveriesTable.scheduledMessageId, msg.id));
    expect(deliveries).toHaveLength(5);
    expect(new Set(deliveries.map((d) => d.recipientPhone)).size).toBe(5);
  });
});
