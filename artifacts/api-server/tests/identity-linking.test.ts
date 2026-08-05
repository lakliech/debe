/**
 * Identity re-linking in getOrCreateLocalUser.
 *
 * When someone re-registers in Clerk (new clerk_id, same address), JIT
 * provisioning must re-link the new Clerk identity to the existing local
 * row — but ONLY on a primary address Clerk reports as verified. Anything
 * less (caller-supplied data, placeholder addresses, unverified addresses)
 * must never attach a new identity to an existing account's roles.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verified: vi.fn(async (_id: string): Promise<string | null> => null),
}));

vi.mock("../src/lib/clerkAdmin", () => ({
  clerkUserEmail: vi.fn(async () => null),
  clerkUserName: vi.fn(async () => null),
  clerkUserIdsByEmail: vi.fn(async () => []),
  clerkVerifiedPrimaryEmail: mocks.verified,
}));

// Allowlist promotion is a separate concern — keep it inert here.
vi.mock("../src/lib/platformBootstrap", () => ({
  promoteIfAllowlisted: vi.fn(async () => {}),
}));

import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateLocalUser } from "../src/lib/userIdentity";

const OWNER_EMAIL = "link-test-owner@example.com";
const OLD_CLERK = "user_link_old";
const NEW_CLERK = "user_link_new";
const ATTACKER_CLERK = "user_link_attacker";
const FRESH_CLERK = "user_link_fresh";

let ownerId: string;

beforeAll(async () => {
  const [owner] = await db
    .insert(usersTable)
    .values({ clerkId: OLD_CLERK, email: OWNER_EMAIL, fullName: "Owner", status: "active" })
    .returning();
  ownerId = owner.id;
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.email, OWNER_EMAIL));
  await db.delete(usersTable).where(eq(usersTable.clerkId, ATTACKER_CLERK));
  await db.delete(usersTable).where(eq(usersTable.clerkId, FRESH_CLERK));
});

beforeEach(() => {
  mocks.verified.mockReset();
  mocks.verified.mockResolvedValue(null);
});

describe("getOrCreateLocalUser identity linking", () => {
  it("re-links a verified re-registration to the existing local account", async () => {
    mocks.verified.mockResolvedValue(OWNER_EMAIL);

    const user = await getOrCreateLocalUser(NEW_CLERK);
    expect(user!.id).toBe(ownerId);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, OWNER_EMAIL))
      .limit(1);
    expect(row.clerkId).toBe(NEW_CLERK);
  });

  it("never links on a caller-supplied address — the claim fails closed", async () => {
    // No verified address from Clerk, but the caller SAYS they own the
    // owner's address. That claim must not attach them to the account.
    mocks.verified.mockResolvedValue(null);

    await expect(
      getOrCreateLocalUser(ATTACKER_CLERK, { email: OWNER_EMAIL, fullName: "Attacker" }),
    ).rejects.toThrow(/failed query|duplicate key/i);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, OWNER_EMAIL))
      .limit(1);
    // Untouched — still the identity from the previous test, not the attacker.
    expect(row.clerkId).toBe(NEW_CLERK);
  });

  it("never links on a placeholder address", async () => {
    mocks.verified.mockResolvedValue(null);

    const user = await getOrCreateLocalUser(FRESH_CLERK);
    expect(user!.id).not.toBe(ownerId);
    expect(user!.email).toBe(`${FRESH_CLERK}@clerk.local`);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, OWNER_EMAIL))
      .limit(1);
    expect(row.clerkId).toBe(NEW_CLERK);
  });
});
