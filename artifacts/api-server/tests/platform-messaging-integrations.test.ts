/**
 * Platform messaging channels (WhatsApp / SMS) — platform-admin config API.
 *
 * Covers: write-only secrets (never returned, encrypted at rest), create
 * requires the secret while updates may omit it (kept), disabled channels
 * refuse test sends, disconnect removes the config, and non-operators are
 * rejected.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/platform-messaging-integrations.test.ts
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mutable auth state — the platform operator throughout ───────────────────
const mockAuth = { userId: "user_msg_operator" };
const ts = Date.now();
const OPERATOR_CLERK_ID = "user_msg_operator";

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock_key",
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

vi.mock("../src/lib/clerkAdmin", () => ({
  clerkUserEmail: vi.fn(async () => null),
  clerkUserName: vi.fn(async () => null),
  clerkUserIdsByEmail: vi.fn(async () => []),
  clerkVerifiedPrimaryEmail: vi.fn(async () => null),
}));

vi.mock("../src/lib/email", () => ({ sendEmailAsync: vi.fn() }));

// ─── App and DB imports (after all mocks are registered) ─────────────────────
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, userRolesTable, platformMessagingConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { dispatchPlatformMessage } from "../src/lib/commsDispatcher";

const { default: app } = await import("../src/app");

const WA_TOKEN = "EAA" + "x".repeat(40);
let operatorUserId: string;
// Preserve any pre-existing rows (the table is shared dev state).
let preExisting: (typeof platformMessagingConfigsTable.$inferSelect)[] = [];

beforeAll(async () => {
  preExisting = await db.select().from(platformMessagingConfigsTable);
  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: OPERATOR_CLERK_ID,
      email: `operator-${ts}@messaging.test`,
      fullName: "Messaging Operator",
      status: "active",
      isGlobalAdmin: true,
      activeTenantId: null,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { isGlobalAdmin: true, activeTenantId: null },
    })
    .returning();
  operatorUserId = operator.id;
});

afterAll(async () => {
  await db.delete(platformMessagingConfigsTable);
  if (preExisting.length) await db.insert(platformMessagingConfigsTable).values(preExisting);
  if (operatorUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, operatorUserId));
    await db.delete(usersTable).where(eq(usersTable.id, operatorUserId));
  }
});

describe("Platform messaging integrations", () => {
  it("reports both channels unconfigured", async () => {
    const res = await request(app).get("/api/platform/messaging-integrations");
    expect(res.status).toBe(200);
    expect(res.body.whatsapp.configured).toBe(false);
    expect(res.body.sms.configured).toBe(false);
  });

  it("rejects unauthenticated / non-operator access", async () => {
    const prev = mockAuth.userId;
    mockAuth.userId = "user_msg_outsider";
    const res = await request(app).get("/api/platform/messaging-integrations");
    mockAuth.userId = prev;
    expect([401, 403]).toContain(res.status);
  });

  it("refuses to connect WhatsApp without an access token", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/whatsapp")
      .send({ phoneNumberId: "104599280012345" });
    expect(res.status).toBe(400);
  });

  it("connects WhatsApp — token is write-only and encrypted at rest", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/whatsapp")
      .send({ phoneNumberId: "104599280012345", businessAccountId: "987654321", accessToken: WA_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.hasAccessToken).toBe(true);
    expect(res.body).not.toHaveProperty("accessToken");

    const [row] = await db
      .select()
      .from(platformMessagingConfigsTable)
      .where(eq(platformMessagingConfigsTable.channel, "whatsapp"));
    expect(row.accessToken).toBeTruthy();
    expect(row.accessToken).not.toBe(WA_TOKEN);

    const get = await request(app).get("/api/platform/messaging-integrations");
    expect(get.body.whatsapp.phoneNumberId).toBe("104599280012345");
    expect(get.body.whatsapp).not.toHaveProperty("accessToken");
  });

  it("updates WhatsApp without resending the token — stored token is kept", async () => {
    const [before] = await db
      .select()
      .from(platformMessagingConfigsTable)
      .where(eq(platformMessagingConfigsTable.channel, "whatsapp"));

    const res = await request(app)
      .put("/api/platform/messaging-integrations/whatsapp")
      .send({ phoneNumberId: "104599280099999", enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);

    const [after] = await db
      .select()
      .from(platformMessagingConfigsTable)
      .where(eq(platformMessagingConfigsTable.channel, "whatsapp"));
    expect(after.accessToken).toBe(before.accessToken);
    expect(after.phoneNumberId).toBe("104599280099999");
  });

  it("test send refuses a disabled channel without hitting the provider", async () => {
    const res = await request(app)
      .post("/api/platform/messaging-integrations/whatsapp/test")
      .send({ to: "254700000001" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it("refuses to connect SMS without a webhook URL", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ senderId: "DEBE", webhookToken: "relay-secret-token" });
    expect(res.status).toBe(400);
  });

  it("refuses to connect SMS without a bearer token", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ webhookUrl: "https://relay.example.com/sms" });
    expect(res.status).toBe(400);
  });

  it("rejects webhook URLs with embedded credentials", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ webhookUrl: "https://user:pass@relay.example.com/sms", webhookToken: "relay-secret-token" });
    expect(res.status).toBe(400);
  });

  it("rejects non-HTTPS and private/loopback webhook URLs (SSRF guard)", async () => {
    for (const webhookUrl of [
      "http://relay.example.com/sms",
      "https://127.0.0.1/sms",
      "https://localhost:8080/sms",
      "https://192.168.1.10/sms",
      "https://169.254.169.254/latest",
      "https://relay.internal/sms",
    ]) {
      const res = await request(app)
        .put("/api/platform/messaging-integrations/sms")
        .send({ webhookUrl, webhookToken: "relay-secret-token" });
      expect(res.status, webhookUrl).toBe(400);
    }
  });

  it("connects SMS — token masked, URL visible", async () => {
    const res = await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ senderId: "DEBE", webhookUrl: "https://relay.example.com/sms", webhookToken: "relay-secret-token" });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.hasWebhookToken).toBe(true);
    expect(res.body).not.toHaveProperty("webhookToken");
    expect(res.body.webhookUrl).toBe("https://relay.example.com/sms");
  });

  it("disconnect removes the channel config", async () => {
    const del = await request(app).delete("/api/platform/messaging-integrations/sms");
    expect(del.status).toBe(200);
    const get = await request(app).get("/api/platform/messaging-integrations");
    expect(get.body.sms.configured).toBe(false);
  });
});

describe("dispatchPlatformMessage", () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ messages: [{ id: "wamid.test" }], id: "prov-1" }),
  }));
  let envUrl: string | undefined;
  let envToken: string | undefined;

  beforeAll(() => {
    envUrl = process.env.COMMS_SMS_WEBHOOK_URL;
    envToken = process.env.COMMS_WEBHOOK_TOKEN;
    process.env.COMMS_SMS_WEBHOOK_URL = "https://env-relay.example.com/sms";
    process.env.COMMS_WEBHOOK_TOKEN = "env-shared-token";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (envUrl === undefined) delete process.env.COMMS_SMS_WEBHOOK_URL;
    else process.env.COMMS_SMS_WEBHOOK_URL = envUrl;
    if (envToken === undefined) delete process.env.COMMS_WEBHOOK_TOKEN;
    else process.env.COMMS_WEBHOOK_TOKEN = envToken;
  });

  it("falls back to the env webhook when no platform row exists", async () => {
    fetchMock.mockClear();
    // sms row was deleted by the disconnect test above.
    const res = await dispatchPlatformMessage({ channel: "sms", to: "254700000001", body: "hello" });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe("https://env-relay.example.com/sms");
    expect(init.headers.authorization).toBe("Bearer env-shared-token");
  });

  it("platform row overrides env — decrypted token, senderId in payload", async () => {
    await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ senderId: "DEBE", webhookUrl: "https://db-relay.example.com/sms", webhookToken: "db-relay-token-1" });
    fetchMock.mockClear();
    const res = await dispatchPlatformMessage({ channel: "sms", to: "254700000001", body: "hello" });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe("https://db-relay.example.com/sms");
    expect(init.headers.authorization).toBe("Bearer db-relay-token-1");
    expect(JSON.parse(init.body).senderId).toBe("DEBE");
  });

  it("a disabled row refuses the send without calling the provider", async () => {
    await request(app)
      .put("/api/platform/messaging-integrations/sms")
      .send({ enabled: false });
    fetchMock.mockClear();
    const res = await dispatchPlatformMessage({ channel: "sms", to: "254700000001", body: "hello" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("whatsapp uses the platform number and decrypted token", async () => {
    // Re-enable the whatsapp row connected earlier (token kept server-side).
    await request(app)
      .put("/api/platform/messaging-integrations/whatsapp")
      .send({ phoneNumberId: "104599280099999", enabled: true });
    fetchMock.mockClear();
    const res = await dispatchPlatformMessage({ channel: "whatsapp", to: "+254 700 000 001", body: "hello" });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain("104599280099999");
    expect(init.headers.Authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(JSON.parse(init.body).to).toBe("254700000001");
  });
});
