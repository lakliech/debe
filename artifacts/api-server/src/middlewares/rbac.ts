/**
 * Role-Based Access Control middleware for the Campaign Management API.
 *
 * Usage:
 *   router.post("/sensitive", requireAuth, resolveTenant, requireRoles(["super-admin"]), handler);
 *
 * requireLevel(maxLevel) allows any role whose `level` field is <= maxLevel.
 * Lower level numbers = more privileged (level 1 = Super Administrator).
 *
 * All role lookups are tenant-scoped: a user's roles in tenant A have no
 * effect on their access in tenant B.
 *
 * Actor resolution is cached in-process for ACTOR_CACHE_TTL_MS (default 30 s)
 * to avoid two sequential DB round-trips on every protected request.  Call
 * bustActorCache(clerkId) after any mutation that changes a user's roles so the
 * next request picks up the updated state.
 */

import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, userRolesTable, rolesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { TenantedRequest } from "./resolveTenant";

export interface AuthedRequest extends Request {
  clerkId: string;
  actorId: string | null;       // local users.id UUID, null if not yet provisioned
  actorRoles: string[];         // role slugs (tenant-scoped + platform)
  actorLevel: number;           // minimum (most privileged) level across all roles; 999 if no roles
  isGlobalAdmin: boolean;       // true → platform_admin + super-admin on every route
}

// ── In-memory actor cache ────────────────────────────────────────────────────
// Cache shape: Map<"clerkId:tenantId", { actorId, actorRoles, actorLevel, expiresAt }>
// The tenantId segment is an empty string when there is no active tenant.

interface CachedActor {
  actorId: string | null;
  actorRoles: string[];
  actorLevel: number;
  isGlobalAdmin: boolean;
  expiresAt: number; // Date.now() + TTL
}

const _actorCache = new Map<string, CachedActor>();

const ACTOR_CACHE_TTL_MS = process.env.ACTOR_CACHE_TTL_MS
  ? parseInt(process.env.ACTOR_CACHE_TTL_MS, 10)
  : 30_000; // 30 seconds default

function _cacheKey(clerkId: string, tenantId: string | undefined): string {
  return `${clerkId}:${tenantId ?? ""}`;
}

/**
 * Evict all cached entries for a given Clerk user (across every tenant).
 * Call this immediately after any mutation that adds or removes roles for the user.
 */
export function bustActorCache(clerkId: string): void {
  const prefix = `${clerkId}:`;
  for (const key of _actorCache.keys()) {
    if (key.startsWith(prefix)) _actorCache.delete(key);
  }
}

// Prune expired entries periodically so the map doesn't grow unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _actorCache) {
    if (entry.expiresAt <= now) _actorCache.delete(key);
  }
}, 60_000).unref(); // unref so this timer doesn't keep the process alive

// ── resolveActor ─────────────────────────────────────────────────────────────

/**
 * Resolve the current actor from DB (or cache) and attach to the request.
 * Must run after requireAuth (which sets req.clerkId) and resolveTenant.
 */
export async function resolveActor(req: Request, res: Response, next: NextFunction) {
  const r = req as AuthedRequest;
  const tenantId = (req as TenantedRequest).tenant?.id;
  const cacheKey = _cacheKey(r.clerkId, tenantId);

  // Cache hit?
  const cached = _actorCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    r.actorId = cached.actorId;
    r.actorRoles = cached.actorRoles;
    r.actorLevel = cached.actorLevel;
    r.isGlobalAdmin = cached.isGlobalAdmin;
    return next();
  }

  // Cache miss — fetch from DB.
  const [row] = await db
    .select({ id: usersTable.id, isGlobalAdmin: usersTable.isGlobalAdmin })
    .from(usersTable)
    .where(eq(usersTable.clerkId, r.clerkId))
    .limit(1);

  if (!row) {
    r.actorId = null;
    r.actorRoles = [];
    r.actorLevel = 999;
    r.isGlobalAdmin = false;
    _actorCache.set(cacheKey, {
      actorId: null,
      actorRoles: [],
      actorLevel: 999,
      isGlobalAdmin: false,
      expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
    });
    return next();
  }

  r.actorId = row.id;

  // Global admins bypass all tenant-scoped RBAC and are granted platform_admin
  // (level 0) + super-admin on every route — regardless of active tenant.
  if (row.isGlobalAdmin) {
    r.isGlobalAdmin = true;
    r.actorRoles = ["platform_admin", "super-admin"];
    r.actorLevel = 0;
    _actorCache.set(cacheKey, {
      actorId: row.id,
      actorRoles: r.actorRoles,
      actorLevel: 0,
      isGlobalAdmin: true,
      expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
    });
    return next();
  }

  r.isGlobalAdmin = false;

  // Build the where clause — always scope by user; add tenant filter when available.
  const roleWhere = tenantId
    ? and(eq(userRolesTable.userId, row.id), eq(userRolesTable.tenantId, tenantId))
    : eq(userRolesTable.userId, row.id);

  const roles = await db
    .select({ slug: rolesTable.slug, level: rolesTable.level })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(roleWhere);

  r.actorRoles = roles.map((x) => x.slug);
  r.actorLevel = roles.length > 0 ? Math.min(...roles.map((x) => x.level)) : 999;

  _actorCache.set(cacheKey, {
    actorId: row.id,
    actorRoles: r.actorRoles,
    actorLevel: r.actorLevel,
    isGlobalAdmin: false,
    expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
  });

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
