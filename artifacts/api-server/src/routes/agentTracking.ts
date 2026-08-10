/**
 * Agent tracking API: GPS heartbeats from the agent app + live map for managers.
 *
 * POST /api/agent-tracking/heartbeat  — agent-self (resolves clerk → user → agent)
 * GET  /api/agent-tracking/live       — campaign managers / field officers
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db } from "@workspace/db";
import { pollingAgentsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from "../lib/withTenant";
import { recordHeartbeat, getLiveAgentTracking } from "../lib/agentTracking";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canViewTracking = requireRoles([
  "campaign-exec-director",
  "national-campaign-manager",
  "returning-officer",
  "county-coordinator",
  "constituency-coordinator",
  "polling-agent-supervisor",
]);

const heartbeatSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  recordedAt: z.coerce.date().nullish(),
  electionId: z.string().uuid().nullish(),
});

/** Resolve the caller's agent record within this tenant (same pattern as /api/polling-agents/me). */
async function resolveAgentSelf(tenantId: string, clerkId: string) {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (!user) return null;
  const [agent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
    .where(and(eq(pollingAgentsTable.userId, user.id), tenantFilter(pollingAgentsTable, tenantId)))
    .limit(1);
  return agent ?? null;
}

// POST /api/agent-tracking/heartbeat — agent GPS check-in (~every 5 min)
router.post("/heartbeat", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid heartbeat payload", details: parsed.error.flatten() });
    }
    const agent = await resolveAgentSelf(t.id, req.clerkId);
    if (!agent) return res.status(404).json({ error: "No agent record found for this user" });

    const result = await recordHeartbeat({
      tenantId: t.id,
      agentId: agent.id,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      accuracyM: parsed.data.accuracyM,
      recordedAt: parsed.data.recordedAt,
      electionId: parsed.data.electionId,
    });
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/agent-tracking/live — live agent map for managers
router.get("/live", requireAuth, canViewTracking, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    res.json(await getLiveAgentTracking(t.id));
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
