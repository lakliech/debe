/**
 * Public events visibility — only announced events appear on the portal.
 *
 * Regression for "portal events filter used a status that never exists":
 * the filter first used "published" (permanently empty list); the real
 * management lifecycle is draft → pending_approval → approved with
 * registration open for approved/active. Only approved/active events are
 * public — draft, pending_approval, proposed, completed, cancelled hidden.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/public-events-visibility.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { tenantsTable, eventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import publicPortalRouter from "../src/routes/publicPortal";

const SLUG = `pub-events-${randomUUID().slice(0, 8)}`;
let tenantId: string;
let app: express.Express;

const VISIBLE = ["approved", "active"];
const HIDDEN = ["draft", "pending_approval", "proposed", "completed", "cancelled"];

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: "Public Events Test", slug: SLUG })
    .returning();
  tenantId = tenant.id;

  for (const status of [...VISIBLE, ...HIDDEN]) {
    await db.insert(eventsTable).values({
      tenantId,
      title: `Event ${status}`,
      status,
      eventDate: "2099-01-01",
    });
  }

  app = express();
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantId };
    next();
  });
  app.use("/", publicPortalRouter);
});

afterAll(async () => {
  // Tenant cascade removes the events.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("public events visibility", () => {
  it("returns only approved and active events", async () => {
    const res = await request(app).get("/events");
    expect(res.status).toBe(200);
    const statuses = res.body.map((e: any) => e.status).sort();
    expect(statuses).toEqual(["active", "approved"]);
  });

  it("returns an empty list when the request carries no tenant", async () => {
    const bare = express();
    bare.use("/", publicPortalRouter);
    const res = await request(bare).get("/events");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
