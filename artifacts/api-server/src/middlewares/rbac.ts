/**
 * Role-Based Access Control middleware for the Ushindi / Linda Mwananchi API.
 *
 * Usage:
 *   router.post("/sensitive", requireAuth, requireRoles(["super-admin", "campaign-exec-director"]), handler);
 *
 * requireLevel(maxLevel) allows any role whose `level` field is <= maxLevel.
 * Lower level numbers = more privileged (level 1 = Super Administrator).
 */

import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  clerkId: string;
  actorId: string | null;       // local users.id UUID, null if not yet provisioned
  actorRoles: string[];         // role slugs
  actorLevel: number;           // minimum (most privileged) level across all roles; 999 if no roles
}

// Shared: resolve the current actor from DB. Attaches to req and calls next().
// Must run after requireAuth (which sets req.clerkId).
export async function resolveActor(req: Request, res: Response, next: NextFunction) {
  const r = req as AuthedRequest;
  const [row] = await db
    .select({
      id: usersTable.id,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, r.clerkId))
    .limit(1);

  if (!row) {
    r.actorId = null;
    r.actorRoles = [];
    r.actorLevel = 999;
    return next();
  }

  r.actorId = row.id;

  const roles = await db
    .select({
      slug: rolesTable.slug,
      level: rolesTable.level,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, row.id));

  r.actorRoles = roles.map((x) => x.slug);
  r.actorLevel = roles.length > 0 ? Math.min(...roles.map((x) => x.level)) : 999;
  next();
}

/**
 * Require that the actor holds at least one of the given role slugs.
 * Super-admins (slug "super-admin") always pass.
 */
export function requireRoles(slugs: string[]) {
  const allowed = new Set(["super-admin", ...slugs]);
  return async (req: Request, res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    // Ensure actor is resolved
    if (r.actorRoles === undefined) await resolveActor(req, res, () => {});
    if (!r.actorRoles) return res.status(403).json({ error: "Forbidden — no roles assigned" });
    const hasRole = r.actorRoles.some((s) => allowed.has(s));
    if (!hasRole) return res.status(403).json({ error: "Forbidden — insufficient role" });
    return next();
  };
}

/**
 * Require that the actor's minimum role level is at most maxLevel.
 * (Level 1 = most privileged; level 10 = least privileged.)
 * Super-admins always pass.
 */
export function requireLevel(maxLevel: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    if (r.actorRoles === undefined) await resolveActor(req, res, () => {});
    if (r.actorRoles?.includes("super-admin")) return next();
    if (r.actorLevel <= maxLevel) return next();
    return res.status(403).json({ error: `Forbidden — requires role level ≤ ${maxLevel}` });
  };
}

// Convenience exports for common guard combinations
export const requireSuperAdmin = requireRoles(["super-admin"]);

export const requireNationalStaff = requireLevel(2); // levels 1-2 (national leadership)

export const requireCountyOrAbove = requireLevel(3); // levels 1-3
