/**
 * demoGuard — read-only enforcement for the shared demo tenant.
 *
 * Blocks all mutating HTTP methods (POST, PUT, PATCH, DELETE) when the
 * resolved tenant has slug === 'demo'. GET requests always pass through.
 *
 * One exception: the platform super admin. Curating and resetting the demo
 * campaign is a platform function, so the read-only rule consults the
 * platform override (lib/platformOverride.ts) — everyone else stays blocked.
 *
 * Wire this middleware inside `withTenant()` in routes/index.ts, after
 * resolveTenant has already attached req.tenant.
 */

import type { Request, Response, NextFunction } from "express";
import type { TenantedRequest } from "./resolveTenant";
import { hasPlatformOverride } from "../lib/platformOverride";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEMO_SLUG = "demo";

export async function demoGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenant = (req as TenantedRequest).tenant;

    // Only enforce once resolveTenant has attached the tenant.
    // (If tenant is absent the request will already have been rejected upstream.)
    if (tenant?.slug === DEMO_SLUG && MUTATING_METHODS.has(req.method)) {
      if (await hasPlatformOverride(req, res)) return next();
      res.status(403).json({
        error: "Read-only demo — sign up for a real campaign to make changes.",
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
