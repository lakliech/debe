/**
 * Platform bootstrap tests.
 *
 * A fresh deployment gets its own empty database: no campaigns, an incomplete
 * role catalogue, and every user defaulting to is_global_admin = false. In that
 * state the owner is locked out of their own product — every request answers
 * 403 — and there is no in-app way back in, because granting access is itself
 * an operator-only action.
 *
 * These tests pin both halves of the recovery path:
 *   - that the real owner IS recovered, and
 *   - that nobody else can ride the same path to platform privilege.
 *
 * The second half matters because the local users.email column is writable
 * from request data (campaign registration accepts a contact email), so the
 * allowlist is matched against Clerk's verified primary email instead.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db, usersTable, userRolesTable, rolesTable, ROLES } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

// Clerk is the identity authority; stub it with a small in-memory directory.
vi.mock("../lib/clerkAdmin", () => ({
  clerkVerifiedPrimaryEmail: vi.fn(),
  clerkUserIdsByEmail: vi.fn(),
  clerkUserEmail: vi.fn(),
}));

// Keep the real RBAC cache behaviour, but observe the invalidation call.
vi.mock("../middlewares/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/rbac")>();
  return { ...actual, bustActorCache: vi.fn(actual.bustActorCache) };
});

import {
  clerkVerifiedPrimaryEmail,
  clerkUserIdsByEmail,
} from "../lib/clerkAdmin";
import { bustActorCache } from "../middlewares/rbac";
import {
  runPlatformBootstrap,
  promoteIfAllowlisted,
  promoteToPlatformOperator,
  parsePlatformAdminEmails,
  isAllowlisted,
  ensureRoleCatalogue,
  hasPlatformRole,
} from "../lib/platformBootstrap";

const STAMP = Date.now();
const OWNER_EMAIL = `bootstrap_owner_${STAMP}@platform.test`;
const OWNER_CLERK_ID = `user_bootstrap_owner_${STAMP}`;
const ATTACKER_CLERK_ID = `user_bootstrap_attacker_${STAMP}`;
const UNVERIFIED_CLERK_ID = `user_bootstrap_unverified_${STAMP}`;

/** clerkId -> the address Clerk holds, and whether it is verified. */
const clerkDirectory = new Map<string, { email: string; verified: boolean }>();

let ownerId: string;
let attackerId: string;
let unverifiedId: string;

async function readState(userId: string) {
  const [user] = await db
    .select({ isGlobalAdmin: usersTable.isGlobalAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const grants = await db
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(
      and(
        eq(userRolesTable.userId, userId),
        eq(rolesTable.slug, "platform_admin"),
        isNull(userRolesTable.tenantId),
      ),
    );

  return { isGlobalAdmin: user?.isGlobalAdmin ?? false, platformRoles: grants.length };
}

async function makeUser(clerkId: string, email: string, name: string) {
  const [row] = await db
    .insert(usersTable)
    .values({ clerkId, email, fullName: name, status: "active" })
    .returning();
  return row.id;
}

let originalEnv: string | undefined;

beforeAll(async () => {
  originalEnv = process.env.PLATFORM_ADMIN_EMAILS;

  clerkDirectory.set(OWNER_CLERK_ID, { email: OWNER_EMAIL, verified: true });
  // The attacker's Clerk account owns a different address entirely...
  clerkDirectory.set(ATTACKER_CLERK_ID, {
    email: `attacker_${STAMP}@evil.test`,
    verified: true,
  });
  clerkDirectory.set(UNVERIFIED_CLERK_ID, { email: OWNER_EMAIL, verified: false });

  vi.mocked(clerkVerifiedPrimaryEmail).mockImplementation(async (clerkId: string) => {
    const entry = clerkDirectory.get(clerkId);
    if (!entry || !entry.verified) return null;
    return entry.email;
  });

  vi.mocked(clerkUserIdsByEmail).mockImplementation(async (email: string) => {
    const wanted = email.trim().toLowerCase();
    return [...clerkDirectory.entries()]
      .filter(([, v]) => v.email.toLowerCase() === wanted)
      .map(([id]) => id);
  });

  // The attacker got there first and claimed the owner's address in the local
  // row, as POST /api/register once allowed through a request-supplied
  // contactEmail. users.email is unique, so the genuine owner's own row is
  // left holding a placeholder — exactly the state that makes matching on the
  // local column dangerous.
  attackerId = await makeUser(ATTACKER_CLERK_ID, OWNER_EMAIL, "Attacker");
  ownerId = await makeUser(OWNER_CLERK_ID, `${OWNER_CLERK_ID}@clerk.local`, "Owner");
  unverifiedId = await makeUser(
    UNVERIFIED_CLERK_ID,
    `${UNVERIFIED_CLERK_ID}@clerk.local`,
    "Unverified",
  );
});

afterAll(async () => {
  if (originalEnv === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = originalEnv;

  for (const id of [ownerId, attackerId, unverifiedId]) {
    if (!id) continue;
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

beforeEach(async () => {
  for (const id of [ownerId, attackerId, unverifiedId]) {
    await db.update(usersTable).set({ isGlobalAdmin: false }).where(eq(usersTable.id, id));
    await db.delete(userRolesTable).where(eq(userRolesTable.userId, id));
  }
  process.env.PLATFORM_ADMIN_EMAILS = OWNER_EMAIL;
});

describe("allowlist parsing", () => {
  it("normalises case, whitespace and empty entries", () => {
    expect(parsePlatformAdminEmails(" Owner@Example.com , ,second@example.com ")).toEqual([
      "owner@example.com",
      "second@example.com",
    ]);
  });

  it("returns nothing when unset", () => {
    expect(parsePlatformAdminEmails(undefined)).toEqual([]);
    expect(parsePlatformAdminEmails(null)).toEqual([]);
    expect(parsePlatformAdminEmails("")).toEqual([]);
  });

  it("matches regardless of case or padding", () => {
    expect(isAllowlisted(`  ${OWNER_EMAIL.toUpperCase()} `)).toBe(true);
  });

  it("never matches a locally-minted placeholder address", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "someone@clerk.local,other@placeholder.invalid";
    expect(isAllowlisted("someone@clerk.local")).toBe(false);
    expect(isAllowlisted("other@placeholder.invalid")).toBe(false);
  });
});

describe("role catalogue", () => {
  it("provides every catalogued role, with platform_admin at the top level", async () => {
    await ensureRoleCatalogue();

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(rolesTable);
    expect(total).toBeGreaterThanOrEqual(ROLES.length);

    const [platform] = await db
      .select({ level: rolesTable.level })
      .from(rolesTable)
      .where(eq(rolesTable.slug, "platform_admin"))
      .limit(1);
    expect(platform).toBeDefined();
    expect(platform.level).toBe(0);
  });

  it("does not overwrite a customised role name on every boot", async () => {
    const customName = `Customised ${STAMP}`;
    await db
      .update(rolesTable)
      .set({ name: customName })
      .where(eq(rolesTable.slug, "volunteer"));

    await ensureRoleCatalogue();

    const [role] = await db
      .select({ name: rolesTable.name })
      .from(rolesTable)
      .where(eq(rolesTable.slug, "volunteer"))
      .limit(1);
    expect(role.name).toBe(customName);

    // Restore the catalogue name so the suite leaves no trace.
    const catalogued = ROLES.find((r) => r.slug === "volunteer")!;
    await db
      .update(rolesTable)
      .set({ name: catalogued.name })
      .where(eq(rolesTable.slug, "volunteer"));
  });
});

describe("runPlatformBootstrap", () => {
  it("recovers the owner who was locked out of an empty environment", async () => {
    expect((await readState(ownerId)).isGlobalAdmin).toBe(false);

    await runPlatformBootstrap();

    const after = await readState(ownerId);
    expect(after.isGlobalAdmin).toBe(true);
    expect(after.platformRoles).toBe(1);
    expect(await hasPlatformRole(ownerId)).toBe(true);
  });

  it("does NOT promote an account whose local email column was spoofed", async () => {
    // The attacker's row claims OWNER_EMAIL, but Clerk says that address
    // belongs to the owner's account, not theirs.
    await runPlatformBootstrap();

    const attacker = await readState(attackerId);
    expect(attacker.isGlobalAdmin).toBe(false);
    expect(attacker.platformRoles).toBe(0);
  });

  it("does NOT promote an account whose email is unverified", async () => {
    await runPlatformBootstrap();

    const unverified = await readState(unverifiedId);
    expect(unverified.isGlobalAdmin).toBe(false);
    expect(unverified.platformRoles).toBe(0);
  });

  it("grants nobody anything when the allowlist is unset", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await runPlatformBootstrap();

    expect((await readState(ownerId)).isGlobalAdmin).toBe(false);
  });

  it("matches the allowlist regardless of letter case", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = OWNER_EMAIL.toUpperCase();
    await runPlatformBootstrap();

    expect((await readState(ownerId)).isGlobalAdmin).toBe(true);
  });

  it("is safe to run repeatedly — no duplicate grants", async () => {
    await runPlatformBootstrap();
    await runPlatformBootstrap();
    await runPlatformBootstrap();

    const after = await readState(ownerId);
    expect(after.isGlobalAdmin).toBe(true);
    expect(after.platformRoles).toBe(1);
  });

  it("is safe under concurrent boots — the database enforces uniqueness", async () => {
    await Promise.all([
      runPlatformBootstrap(),
      runPlatformBootstrap(),
      runPlatformBootstrap(),
    ]);

    expect((await readState(ownerId)).platformRoles).toBe(1);
  });

  it("invalidates the cached privileges of the account it promotes", async () => {
    // The server listens before the bootstrap runs, so an early request can
    // cache "no roles" for the actor. Without invalidation the owner keeps
    // getting 403 until that entry expires.
    vi.mocked(bustActorCache).mockClear();

    await runPlatformBootstrap();

    expect(bustActorCache).toHaveBeenCalledWith(OWNER_CLERK_ID);
  });

  it("holds the platform role outside any campaign", async () => {
    await runPlatformBootstrap();

    const rows = await db
      .select({ tenantId: userRolesTable.tenantId })
      .from(userRolesTable)
      .where(and(eq(userRolesTable.userId, ownerId), isNull(userRolesTable.tenantId)));
    expect(rows.length).toBe(1);
  });
});

describe("promotion on first sign-in", () => {
  it("promotes the owner's account created after boot", async () => {
    await promoteIfAllowlisted(ownerId, OWNER_CLERK_ID);
    expect((await readState(ownerId)).isGlobalAdmin).toBe(true);
  });

  it("ignores an account Clerk says owns a different address", async () => {
    await promoteIfAllowlisted(attackerId, ATTACKER_CLERK_ID);
    expect((await readState(attackerId)).isGlobalAdmin).toBe(false);
  });

  it("refuses a direct promotion call for a non-allowlisted account", async () => {
    const granted = await promoteToPlatformOperator(attackerId, ATTACKER_CLERK_ID);
    expect(granted).toBe(false);
    expect((await readState(attackerId)).isGlobalAdmin).toBe(false);
  });

  it("refuses when Clerk cannot confirm the account at all", async () => {
    const granted = await promoteToPlatformOperator(ownerId, "user_unknown_to_clerk");
    expect(granted).toBe(false);
    expect((await readState(ownerId)).isGlobalAdmin).toBe(false);
  });
});
