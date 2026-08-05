/**
 * Bulk import endpoints — CSV/Excel upload for agents, volunteers, candidates.
 *
 * Covers the parser (CSV + XLSX, header aliases, row numbering) and the
 * route wiring (per-tenant inserts, partial-failure reporting, URL-scoped
 * election for candidates, missing-file 400).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/bulk-import.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "bulk-import-clerk" }),
}));

vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));

vi.mock("../src/middlewares/resolveTenant", () => ({
  resolveTenant: (_req: any, _res: any, next: any) => next(),
}));

import { db } from "@workspace/db";
import {
  tenantsTable,
  electionsTable,
  pollingAgentsTable,
  volunteersTable,
  candidatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseTabularFile, remapRow, validateImportRows } from "../src/lib/bulkImport";
import pollingAgentsRouter from "../src/routes/pollingAgentsMgmt";
import volunteersRouter from "../src/routes/volunteers";
import electionAdminRouter from "../src/routes/electionAdmin";

const SLUG = `bulk-import-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let electionId: string;
let app: express.Express;

function xlsxBuffer(header: string[], rows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Bulk Import Test", slug: SLUG })
    .returning();
  tenantId = tenant.id;

  const [election] = await db
    .insert(electionsTable)
    .values({ tenantId, name: "Import Election", year: 2099 })
    .returning();
  electionId = election.id;

  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/polling-agents", pollingAgentsRouter);
  app.use("/volunteers", volunteersRouter);
  app.use("/election-admin", electionAdminRouter);
});

afterAll(async () => {
  // Tenant cascade removes agents, volunteers, election, and candidates.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("parseTabularFile", () => {
  it("parses a CSV buffer", () => {
    const rows = parseTabularFile(Buffer.from("name,phone\nJane,254712345678\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Jane");
  });

  it("parses an XLSX buffer", () => {
    const rows = parseTabularFile(xlsxBuffer(["Full Name", "Phone"], [["Jane", "254712345678"]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]["Full Name"]).toBe("Jane");
  });

  it("rejects a file with a header but no data rows", () => {
    expect(() => parseTabularFile(Buffer.from("name,phone\n"))).toThrow(/no data rows/i);
  });
});

describe("remapRow + validateImportRows", () => {
  it("maps aliases and normalises headers", () => {
    const out = remapRow(
      { "Full Name": "Jane", MSISDN: "2547", extra: "x" },
      { fullName: ["name"], phoneNumber: ["msisdn", "phone"] },
    );
    expect(out).toEqual({ fullName: "Jane", phoneNumber: "2547" });
  });

  it("reports failing row numbers with the header as row 1", () => {
    const schema = {
      safeParse: (v: any) =>
        v.fullName
          ? { success: true as const, data: v }
          : { success: false as const, error: { issues: [{ path: ["fullName"], message: "Required" }] } },
    };
    const { valid, errors } = validateImportRows(
      [{ fullName: "A" }, { phoneNumber: "x" }],
      schema,
      { fullName: [], phoneNumber: [] },
    );
    expect(valid).toHaveLength(1);
    expect(errors[0].row).toBe(3); // second data row = Excel row 3
  });
});

describe("import routes", () => {
  it("imports polling agents from CSV with row-level failure reporting", async () => {
    const csv = [
      "fullName,phoneNumber,nationalId",
      "Jane Wanjiku,254712345678,12345678",
      "John Otieno,254798765432,",
      ",254700000099,999", // missing fullName → fails, Excel row 4
    ].join("\n");

    const res = await request(app).post("/polling-agents/import").attach("file", Buffer.from(csv), "agents.csv");
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.errors[0].row).toBe(4);

    const agents = await db.select().from(pollingAgentsTable).where(eq(pollingAgentsTable.tenantId, tenantId));
    expect(agents).toHaveLength(2);
  });

  it("imports volunteers from XLSX", async () => {
    const buf = xlsxBuffer(
      ["fullName", "phoneNumber", "email", "skills"],
      [
        ["Mary Achieng", "254711111111", "mary@example.com", "organising, data entry"],
        ["Peter Njoroge", "254722222222", "", "driving"],
      ],
    );
    const res = await request(app).post("/volunteers/import").attach("file", buf, "volunteers.xlsx");
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toBe(0);

    const volunteers = await db.select().from(volunteersTable).where(eq(volunteersTable.tenantId, tenantId));
    expect(volunteers).toHaveLength(2);
    expect(volunteers.every((v) => v.status === "pending")).toBe(true);
    expect(volunteers.find((v) => v.fullName === "Mary Achieng")?.skills).toEqual(["organising", "data entry"]);
  });

  it("imports candidates against the URL election, parsing booleans and ints", async () => {
    const csv = [
      "fullName,partyName,partyAbbreviation,isOurCandidate,displayOrder",
      "Alice Muthoni,Linda Mwananchi,LM,yes,1",
      "Bob Kiprop,United Democratic Alliance,UDA,no,2",
    ].join("\n");

    const res = await request(app)
      .post(`/election-admin/elections/${electionId}/candidates/import`)
      .attach("file", Buffer.from(csv), "candidates.csv");
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);

    const candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.electionId, electionId));
    expect(candidates).toHaveLength(2);
    const alice = candidates.find((c) => c.fullName === "Alice Muthoni");
    const bob = candidates.find((c) => c.fullName === "Bob Kiprop");
    expect(alice?.isOurCandidate).toBe(true);
    expect(alice?.displayOrder).toBe(1);
    expect(bob?.isOurCandidate).toBe(false);
    expect(candidates.every((c) => c.tenantId === tenantId)).toBe(true);
  });

  it("rejects a candidate import for an election the tenant does not own", async () => {
    const csv = "fullName\nNobody Special";
    const res = await request(app)
      .post(`/election-admin/elections/${randomUUID()}/candidates/import`)
      .attach("file", Buffer.from(csv), "candidates.csv");
    expect(res.status).toBe(404);
  });

  it("rejects an import with no file attached", async () => {
    const res = await request(app).post("/polling-agents/import");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/form field/i);
  });

  it("ignores client-supplied tenantId/electionId columns (isolation guarantee)", async () => {
    const csv = [
      "fullName,tenantId,electionId",
      `Carol Wambui,${randomUUID()},${randomUUID()}`, // attacker-supplied values
    ].join("\n");

    const res = await request(app)
      .post(`/election-admin/elections/${electionId}/candidates/import`)
      .attach("file", Buffer.from(csv), "candidates.csv");
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);

    const carol = (await db.select().from(candidatesTable).where(eq(candidatesTable.electionId, electionId)))
      .find((c) => c.fullName === "Carol Wambui");
    expect(carol).toBeDefined();
    // Forced to the resolved tenant and the URL election — never the row's.
    expect(carol!.tenantId).toBe(tenantId);
    expect(carol!.electionId).toBe(electionId);
  });
});
