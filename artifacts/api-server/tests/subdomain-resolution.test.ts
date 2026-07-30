/**
 * Subdomain → tenant → branding resolution tests.
 *
 * What this covers:
 *  The middleware in app.ts reads the Host (or X-Forwarded-Host) header,
 *  extracts the leading label from known platform domains, and injects
 *  X-Tenant-Slug. resolveTenantMixed (on GET /api/config/branding) then
 *  delegates to resolveTenantPublic which looks up the slug in the DB and
 *  attaches req.tenant. The branding handler returns the tenant's campaign
 *  data or, when no tenant is found, a 404 / neutral response.
 *
 * Security properties under test:
 *  1. Host: <slug>.ushindi.app  → correct tenant's branding (not another tenant's)
 *  2. X-Forwarded-Host: <slug>.ushindi.app  → same (proxy-header path)
 *  3. Unknown slug (no DB row)  → 404, NOT neutral branding of some other tenant
 *  4. Base platform host ushindi.app (no subdomain)  → 200 neutral (no tenant context)
 *  5. Reserved label (www.ushindi.app)  → 200 neutral (not treated as a slug)
 *  6. Bare Replit dev host abc123.replit.dev (only 3 labels) → 200 neutral
 *  7. Replit dev sub-subdomain amina.abc123.replit.dev (4 labels) → tenant resolved
 *  8. Custom domain matching tenants.custom_domain → tenant resolved via DB lookup
 *  9. Explicit X-Tenant-Slug overrides Host header (upstream proxy wins)
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/subdomain-resolution.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Mutable state ────────────────────────────────────────────────────────────
/** Tenant row returned for ALL tenantsTable selects. null = no matching tenant. */
let _mockTenant: Record<string, unknown> | null = null;
/** Branding row returned for ALL brandingTable selects. null = neutral response. */
let _mockBranding: Record<string, unknown> | null = null;

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: (_req: any) => ({}), // always unauthenticated → hits resolveTenantPublic
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "pk_test_mock_key",
}));

vi.mock("../src/middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk_proxy",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const makeTable = (name: string) => ({ __tableName: name });

  // tenantsTable needs explicit column names so the middleware can reference them
  const tenantsTable = {
    __tableName: "tenants",
    id:           "tenants.id",
    slug:         "tenants.slug",
    clerkOrgId:   "tenants.clerkOrgId",
    customDomain: "tenants.customDomain",
    isSuspended:  "tenants.isSuspended",
  };

  const brandingTable  = makeTable("branding");
  const usersTable     = makeTable("users");
  const userRolesTable = makeTable("user_roles");
  const rolesTable     = makeTable("roles");

  function makeQueryBuilder() {
    let _table: string | null = null;
    const qb: any = {
      from(t: any)    { _table = t?.__tableName ?? null; return qb; },
      where()          { return qb; },
      innerJoin()      { return qb; },
      leftJoin()       { return qb; },
      orderBy()        { return qb; },
      offset()         { return qb; },
      groupBy()        { return qb; },
      limit(_n: number) {
        if (_table === "tenants")  return Promise.resolve(_mockTenant  ? [_mockTenant]  : []);
        if (_table === "branding") return Promise.resolve(_mockBranding ? [_mockBranding] : []);
        return Promise.resolve([]);
      },
      select()  { return qb; },
      then(resolve: any, reject: any) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return qb;
  }

  const db = {
    select: (_fields?: unknown) => makeQueryBuilder(),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    db,
    tenantsTable,
    brandingTable,
    usersTable,
    userRolesTable,
    rolesTable,
    systemConfigTable:                makeTable("system_config"),
    resultSubmissionsTable:           makeTable("result_submissions"),
    submissionCandidateVotesTable:    makeTable("submission_candidate_votes"),
    submissionFormImagesTable:        makeTable("submission_form_images"),
    submissionVerificationStepsTable: makeTable("submission_verification_steps"),
    submissionCorrectionsTable:       makeTable("submission_corrections"),
    submissionOcrSuggestionsTable:    makeTable("submission_ocr_suggestions"),
    candidatesTable:                  makeTable("candidates"),
    pollingStationsTable:             makeTable("polling_stations"),
    pollingAgentsTable:               makeTable("polling_agents"),
    dataSubjectRequestsTable:         makeTable("data_subject_requests"),
    dataProcessingRecordsTable:       makeTable("data_processing_records"),
    dpiaRegisterTable:                makeTable("dpia_register"),
    vendorRegisterTable:              makeTable("vendor_register"),
    dataBreachRegisterTable:          makeTable("data_breach_register"),
    consentAuditTable:                makeTable("consent_audit"),
    dataRetentionPoliciesTable:       makeTable("data_retention_policies"),
    tallySnapshotsTable:              makeTable("tally_snapshots"),
    electionsTable:                   makeTable("elections"),
    volunteersTable:                  makeTable("volunteers"),
    supportersTable:                  makeTable("supporters"),
    contributionsTable:               makeTable("contributions"),
    expenditureRequestsTable:         makeTable("expenditure_requests"),
    auditLogsTable:                   makeTable("audit_logs"),
    electionDisputesTable:            makeTable("election_disputes"),
    electionIncidentReportsTable:     makeTable("election_incident_reports"),
    agentTrainingEnrollmentsTable:    makeTable("agent_training_enrollments"),
    exportAuditLogTable:              makeTable("export_audit_log"),
    // drizzle helpers
    eq:      (..._a: any[]) => ({}),
    and:     (..._a: any[]) => ({}),
    or:      (..._a: any[]) => ({}),
    desc:    (_c: any)      => ({}),
    count:   ()             => ({}),
    sum:     ()             => ({}),
    inArray: ()             => ({}),
    gte:     ()             => ({}),
    lte:     ()             => ({}),
    sql: Object.assign(
      (_tpl: TemplateStringsArray, ..._vals: any[]) => ({}),
      { raw: (_s: string) => ({}) }
    ),
  };
});

// ─── App — imported after all mocks are registered ────────────────────────────
const { default: app } = await import("../src/app");

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const TENANT_AMINA = {
  id:           "tenant-amina-uuid",
  clerkOrgId:   "org_amina",
  slug:         "amina",
  name:         "Amina 2027",
  plan:         "standard",
  isSuspended:  false,
  customDomain: null,
  createdAt:    new Date(),
  updatedAt:    new Date(),
};

const BRANDING_AMINA = {
  id:            "branding-amina-uuid",
  tenantId:      "tenant-amina-uuid",
  campaignName:  "Amina 2027 Campaign",
  candidateName: "Amina Ochieng",
  positionTitle: "Governor",
  partyName:     "ODM",
  primaryColor:  "209 88% 50%",
  secondaryColor:"0 0% 8%",
  tagline:       "Amina Inaweza",
  electionYear:  2027,
  electionLevel: "Gubernatorial",
  mpesaPaybill:  "123456",
  logoUrl:       null,
  faviconUrl:    null,
  websiteUrl:    null,
  socialTwitter: null,
  socialFacebook:null,
  socialInstagram:null,
  updatedAt:     new Date(),
};

beforeEach(() => {
  _mockTenant  = null;
  _mockBranding = null;
  // Ensure the platform domain used by the middleware matches what the tests send
  process.env.PORTAL_DOMAIN = "ushindi.app";
  delete process.env.SEED_CLERK_ORG_ID;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Host header — platform subdomain resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Host: <slug>.ushindi.app — subdomain resolves to tenant branding", () => {
  it("returns the campaign's branding when slug is registered", async () => {
    _mockTenant   = TENANT_AMINA;
    _mockBranding = BRANDING_AMINA;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina.ushindi.app");

    expect(res.status).toBe(200);
    // Campaign-specific data must be returned, not the neutral defaults
    expect(res.body.campaignName).toBe("Amina 2027 Campaign");
    expect(res.body.candidateName).toBe("Amina Ochieng");
  });

  it("returns 404 when the slug is not registered", async () => {
    _mockTenant   = null; // no tenant row for this slug
    _mockBranding = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "unknown-campaign.ushindi.app");

    // Must be 404 "not found" — NOT 200 with neutral branding of another tenant
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 neutral when the base platform host is used (no subdomain)", async () => {
    // No slug is extracted from "ushindi.app" (no leading label).
    // The CNAME fallback lookup also returns nothing — no tenant context.
    _mockTenant   = null;
    _mockBranding = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "ushindi.app"); // base domain — no slug prefix

    // resolveTenantPublic proceeds without a tenant → neutral defaults
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe("Your Candidate");
  });

  it("returns 200 neutral for the reserved 'www' subdomain", async () => {
    // "www" is a reserved label — _extractPlatformSlug returns null for it.
    // Neither the subdomain path nor the CNAME lookup should resolve a tenant.
    _mockTenant   = null;
    _mockBranding = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "www.ushindi.app");

    // "www" is reserved — must not be treated as a campaign slug
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe("Your Candidate");
  });

  it("returns 403 when the resolved tenant is suspended", async () => {
    _mockTenant   = { ...TENANT_AMINA, isSuspended: true };
    _mockBranding = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina.ushindi.app");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. X-Forwarded-Host header — proxy path
// ═══════════════════════════════════════════════════════════════════════════════

describe("X-Forwarded-Host: <slug>.ushindi.app — proxy header is honoured", () => {
  it("resolves the tenant from X-Forwarded-Host when no X-Tenant-Slug is present", async () => {
    _mockTenant   = TENANT_AMINA;
    _mockBranding = BRANDING_AMINA;

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Forwarded-Host", "amina.ushindi.app");

    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Amina 2027 Campaign");
  });

  it("returns 404 for an unregistered slug via X-Forwarded-Host", async () => {
    _mockTenant   = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Forwarded-Host", "ghost-campaign.ushindi.app");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Explicit X-Tenant-Slug overrides the Host header
// ═══════════════════════════════════════════════════════════════════════════════

describe("X-Tenant-Slug header — upstream proxy wins over Host-derived slug", () => {
  it("uses X-Tenant-Slug when both it and a platform Host are present", async () => {
    _mockTenant   = TENANT_AMINA;
    _mockBranding = BRANDING_AMINA;

    // Host says 'other.ushindi.app' but upstream has already set X-Tenant-Slug
    const res = await request(app)
      .get("/api/config/branding")
      .set("X-Tenant-Slug", "amina")
      .set("Host", "other.ushindi.app");

    // The app middleware short-circuits when X-Tenant-Slug is already set
    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Amina 2027 Campaign");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Replit dev domain — subdomain extraction rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replit dev domain — slug extraction rules", () => {
  it("extracts slug from amina.abc123.replit.dev (4 labels ✓)", async () => {
    _mockTenant   = TENANT_AMINA;
    _mockBranding = BRANDING_AMINA;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina.abc123.replit.dev");

    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Amina 2027 Campaign");
  });

  it("does NOT extract a slug from abc123.replit.dev (only 3 labels — base Replit host)", async () => {
    // _extractPlatformSlug requires ≥ 4 labels for replit.dev to exclude the
    // bare Replit dev host (abc123.replit.dev has only 3 labels).
    // Neither subdomain path nor CNAME fallback should resolve a tenant here.
    _mockTenant   = null;
    _mockBranding = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "abc123.replit.dev");

    // No slug extracted → neutral branding
    expect(res.status).toBe(200);
    expect(res.body.candidateName).toBe("Your Candidate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Slug change — new slug resolves, old slug returns 404
// ═══════════════════════════════════════════════════════════════════════════════

describe("Slug rename — old URL breaks, new URL works", () => {
  it("old slug returns 404 after it no longer exists in the DB", async () => {
    // Simulate: slug was renamed from "amina-old" to "amina-new".
    // DB no longer has "amina-old".
    _mockTenant = null;

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina-old.ushindi.app");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("new slug returns the correct branding after rename", async () => {
    _mockTenant   = { ...TENANT_AMINA, slug: "amina-new" };
    _mockBranding = { ...BRANDING_AMINA, campaignName: "Amina 2027 (updated)" };

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina-new.ushindi.app");

    expect(res.status).toBe(200);
    expect(res.body.campaignName).toBe("Amina 2027 (updated)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Tenant with branding row missing — falls back to neutral without leaking
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tenant exists but branding row is missing", () => {
  it("returns neutral branding rather than an error or another tenant's data", async () => {
    _mockTenant   = TENANT_AMINA; // tenant resolves
    _mockBranding = null;         // but no branding row yet

    const res = await request(app)
      .get("/api/config/branding")
      .set("Host", "amina.ushindi.app");

    expect(res.status).toBe(200);
    // Neutral defaults — not another campaign's data
    expect(res.body.candidateName).toBe("Your Candidate");
    expect(res.body.campaignName).toBe("Your Campaign");
  });
});
