/**
 * demo — public auto-login into the shared read-only demo campaign.
 *
 * A prospective customer should be able to look round the product before they
 * decide to register, so this endpoint hands out a short-lived Clerk sign-in
 * ticket for one fixed demo account. The visitor exchanges the ticket for a
 * session in the browser and lands in the demo campaign's Command Centre.
 *
 * What keeps this safe:
 *   - It only ever grants the ONE demo account, pinned to the tenant whose
 *     slug is 'demo'. There is no caller-supplied input at all.
 *   - That tenant is read-only: resolveTenant/demoGuard reject every mutating
 *     method on it, so a demo visitor can look but never write.
 *   - The demo account is a plain campaign member, never a platform operator.
 *   - Tickets expire in five minutes and the route is rate-limited per IP.
 *
 * When the demo tenant has not been seeded, or Clerk is not configured, the
 * endpoint says so with a 503 rather than silently signing the visitor into
 * something else.
 */

import { Router, type IRouter } from "express";
import { db, tenantsTable, usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { clerkPost, clerkUserIdsByEmail } from "../lib/clerkAdmin";
import { getOrCreateLocalUser } from "../lib/userIdentity";
import { bustActorCache } from "../middlewares/rbac";
import { demoSessionLimiter } from "../middlewares/rateLimits";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEMO_SLUG = "demo";

/**
 * The demo visitor's role inside the demo campaign.
 *
 * Full campaign visibility is the point — the guided tour walks through the
 * roster, the deployment map, the live tally and the transparency portal, and
 * a reduced role would leave half the tour highlighting nav items the visitor
 * cannot open. It is safe because the demo tenant refuses every write.
 */
const DEMO_ROLE_NAME = "Super Administrator";

/** Sign-in tickets are single-use and short-lived — long enough to redirect. */
const TICKET_TTL_SECONDS = 300;

const UNAVAILABLE =
  "The live demo is not available right now. Please register a campaign or contact us.";

function demoAccountEmail(): string {
  return process.env.DEMO_VISITOR_EMAIL?.trim() || "demo-visitor@demo.debe.ke";
}

/**
 * The Clerk account behind the demo, created on first use.
 *
 * One shared account rather than one per visitor: the tenant is read-only, so
 * there is nothing to keep separate, and provisioning an account per curious
 * visitor would fill the identity provider with abandoned records.
 */
async function resolveDemoClerkUserId(email: string): Promise<string> {
  const existing = await clerkUserIdsByEmail(email);
  if (existing.length > 0) return existing[0];

  const created: any = await clerkPost("/users", {
    email_address: [email],
    first_name: "Demo",
    last_name: "Visitor",
    skip_password_requirement: true,
  });

  const id = created?.id;
  if (typeof id !== "string") {
    throw new Error("Clerk did not return an id for the demo account");
  }
  logger.info({ email }, "[demo] Provisioned the shared demo Clerk account.");
  return id;
}

/** Idempotently give the demo account its role inside the demo campaign. */
async function ensureDemoMembership(userId: string, tenantId: string): Promise<void> {
  const [role] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(eq(rolesTable.name, DEMO_ROLE_NAME))
    .limit(1);
  if (!role) {
    throw new Error(`Role "${DEMO_ROLE_NAME}" is missing — seed the role catalogue`);
  }

  const [existing] = await db
    .select({ id: userRolesTable.id })
    .from(userRolesTable)
    .where(
      and(
        eq(userRolesTable.userId, userId),
        eq(userRolesTable.roleId, role.id),
        eq(userRolesTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(userRolesTable).values({ userId, roleId: role.id, tenantId });
  }
}

/**
 * GET /api/demo/session
 *
 * Returns { ticket, expiresInSeconds } — a Clerk sign-in ticket the browser
 * exchanges via signIn.create({ strategy: "ticket", ticket }).
 */
router.get("/session", demoSessionLimiter, async (_req, res) => {
  try {
    if (!process.env.CLERK_SECRET_KEY) {
      logger.warn("[demo] CLERK_SECRET_KEY is not set — cannot mint demo sessions.");
      return res.status(503).json({ error: UNAVAILABLE });
    }

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, DEMO_SLUG))
      .limit(1);

    if (!tenant) {
      logger.warn("[demo] No tenant with slug 'demo' — run the demo seed first.");
      return res.status(503).json({ error: UNAVAILABLE });
    }
    if (tenant.isSuspended) {
      logger.warn("[demo] The demo tenant is suspended — refusing to hand out sessions.");
      return res.status(503).json({ error: UNAVAILABLE });
    }

    const email = demoAccountEmail();
    const clerkId = await resolveDemoClerkUserId(email);

    const user = await getOrCreateLocalUser(clerkId, {
      email,
      fullName: "Demo Visitor",
    });
    if (!user) throw new Error("Could not provision the local demo user row");

    // A global admin must never be handed out unauthenticated. If someone has
    // flagged the demo account, stop rather than mint a platform session.
    if (user.isGlobalAdmin) {
      logger.error(
        { clerkId },
        "[demo] The demo account is flagged as a global admin — refusing to issue a session.",
      );
      return res.status(503).json({ error: UNAVAILABLE });
    }

    await ensureDemoMembership(user.id, tenant.id);

    // Pin the context so the visitor lands in the demo campaign even if the
    // account later picks up another membership.
    if (user.activeTenantId !== tenant.id) {
      await db
        .update(usersTable)
        .set({ activeTenantId: tenant.id, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
    }

    // The membership and context must be visible on the visitor's very first
    // authenticated request, which follows within seconds.
    bustActorCache(clerkId);

    const token: any = await clerkPost("/sign_in_tokens", {
      user_id: clerkId,
      expires_in_seconds: TICKET_TTL_SECONDS,
    });

    const ticket = token?.token;
    if (typeof ticket !== "string") {
      throw new Error("Clerk did not return a sign-in ticket");
    }

    return res.json({
      ticket,
      expiresInSeconds: TICKET_TTL_SECONDS,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });
  } catch (err) {
    logger.error({ err }, "[demo] Failed to start a demo session.");
    return res.status(503).json({ error: UNAVAILABLE });
  }
});

export default router;
