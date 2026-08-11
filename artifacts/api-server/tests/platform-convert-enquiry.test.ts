/**
 * Convert enquiry → campaign in one click (platform admin).
 *
 * POST /api/platform/tenants accepts an optional enquiryId: the enquiry must
 * exist, and it flips to "converted" in the same transaction as the tenant
 * insert — the two records can never disagree. Without an enquiryId the
 * endpoint behaves exactly as before.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/platform-convert-enquiry.test.ts
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Mutable auth state — the platform operator throughout ───────────────────
const mockAuth = { userId: "user_cvt_operator" };
const ts = Date.now();
const OPERATOR_CLERK_ID = "user_cvt_operator";
const OPERATOR_EMAIL = `operator-${ts}@convert.test`;
const ENQUIRY_EMAIL = `prospect-${ts}@convert.test`;

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

// The prospect has no account yet — the admin-grant path must degrade to a
// warning, not block the conversion.
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
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  platformEnquiriesTable,
  countiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const { default: app } = await import("../src/app");

let countyId: string;
let operatorUserId: string;
const createdTenantIds: string[] = [];
const createdEnquiryIds: string[] = [];

async function makeEnquiry() {
  const res = await request(app)
    .post("/api/enquiries")
    .set("Content-Type", "application/json")
    .send({
      fullName: "Convert Prospect",
      email: ENQUIRY_EMAIL,
      organisation: "Convert Test Organisation",
      electionLevel: "Gubernatorial",
      message: "We want in.",
    });
  expect(res.status).toBe(201);
  createdEnquiryIds.push(res.body.id);
  return res.body.id as string;
}

beforeAll(async () => {
  const [county] = await db.select({ id: countiesTable.id }).from(countiesTable).limit(1);
  countyId = county.id;

  const [operator] = await db
    .insert(usersTable)
    .values({
      clerkId: OPERATOR_CLERK_ID,
      email: OPERATOR_EMAIL,
      fullName: "Convert Operator",
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
  for (const id of createdTenantIds) {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
  for (const id of createdEnquiryIds) {
    await db.delete(platformEnquiriesTable).where(eq(platformEnquiriesTable.id, id));
  }
  if (operatorUserId) {
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, operatorUserId));
    await db.delete(usersTable).where(eq(usersTable.id, operatorUserId));
  }
});

describe("Convert enquiry to campaign", () => {
  it("creates the campaign and marks the enquiry converted atomically", async () => {
    const enquiryId = await makeEnquiry();

    // The operator has qualified the lead before converting it.
    const patch = await request(app)
      .patch(`/api/enquiries/${enquiryId}`)
      .set("Content-Type", "application/json")
      .send({ status: "contacted" });
    expect(patch.status).toBe(200);

    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "Converted Campaign",
        slug: `convert-${ts}`,
        plan: "free",
        seatType: "gubernatorial",
        scopeCountyId: countyId,
        adminEmail: ENQUIRY_EMAIL,
        enquiryId,
      });

    expect(res.status).toBe(201);
    expect(res.body.enquiryConverted).toBe(true);
    createdTenantIds.push(res.body.tenant.id);
    // The prospect has no account — a warning, not a failure.
    expect(res.body.invitationWarning).toMatch(/no account/i);

    const [enquiry] = await db
      .select({ status: platformEnquiriesTable.status })
      .from(platformEnquiriesTable)
      .where(eq(platformEnquiriesTable.id, enquiryId));
    expect(enquiry.status).toBe("converted");
  });

  it("rejects a nonexistent enquiry and creates nothing", async () => {
    const slug = `convert-missing-${ts}`;
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "Ghost Enquiry Campaign",
        slug,
        seatType: "gubernatorial",
        scopeCountyId: countyId,
        enquiryId: crypto.randomUUID(),
      });

    expect(res.status).toBe(404);
    const [orphan] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug));
    expect(orphan).toBeUndefined();
  });

  it("refuses to convert the same enquiry twice — no duplicate campaign", async () => {
    const enquiryId = await makeEnquiry();

    const first = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "First Conversion",
        slug: `convert-first-${ts}`,
        seatType: "gubernatorial",
        scopeCountyId: countyId,
        enquiryId,
      });
    expect(first.status).toBe(201);
    createdTenantIds.push(first.body.tenant.id);

    const second = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "Second Conversion",
        slug: `convert-second-${ts}`,
        seatType: "gubernatorial",
        scopeCountyId: countyId,
        enquiryId,
      });
    expect(second.status).toBe(409);

    // The failed conversion rolled back — no second campaign exists.
    const [orphan] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, `convert-second-${ts}`));
    expect(orphan).toBeUndefined();
  });

  it("refuses to convert a closed enquiry", async () => {
    const enquiryId = await makeEnquiry();
    const close = await request(app)
      .patch(`/api/enquiries/${enquiryId}`)
      .set("Content-Type", "application/json")
      .send({ status: "closed" });
    expect(close.status).toBe(200);

    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "Closed Enquiry Campaign",
        slug: `convert-closed-${ts}`,
        seatType: "gubernatorial",
        scopeCountyId: countyId,
        enquiryId,
      });
    expect(res.status).toBe(409);
  });

  it("still creates a campaign without an enquiry (unchanged behaviour)", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Content-Type", "application/json")
      .send({
        name: "No-Enquiry Campaign",
        slug: `convert-none-${ts}`,
        seatType: "gubernatorial",
        scopeCountyId: countyId,
      });

    expect(res.status).toBe(201);
    expect(res.body.enquiryConverted).toBe(false);
    createdTenantIds.push(res.body.tenant.id);
  });
});
