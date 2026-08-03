import type { Response } from "express";
import { NoTenantContextError, NO_CAMPAIGN_SELECTED } from "./withTenant";

/**
 * Uniform catch-block responder for route handlers.
 *
 * Routers behind withTenant() are guarded by requireTenantContext, so a
 * missing campaign never reaches their handlers. Mixed routers (public +
 * authenticated on the same router) cannot be blanket-guarded — their public
 * endpoints must stay reachable with no campaign — so assertTenant can throw
 * inside a handler that owns its own try/catch. Those catch blocks would
 * otherwise report "no campaign selected" as a 500.
 *
 * Use this instead of `res.status(500).json({ error: err.message })` so the
 * 409 NO_CAMPAIGN_SELECTED contract holds everywhere the frontend might land.
 */
export function sendRouteError(res: Response, err: any): void {
  if (err instanceof NoTenantContextError) {
    res.status(409).json({ code: NO_CAMPAIGN_SELECTED, error: err.message });
    return;
  }
  res.status(500).json({ error: err?.message ?? "Internal server error" });
}
