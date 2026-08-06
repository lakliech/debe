/**
 * Result alerts — WhatsApp "Station X just reported / verified" pings to
 * campaign managers. Fire-and-forget by design: alerting must never delay or
 * break the result pipeline, so failures are logged, never thrown. Sends
 * through the same provider chain as the comms dispatcher (WhatsApp Cloud
 * API when configured, else the generic channel webhook).
 */
import { logger } from "./logger";
import { sendWhatsappChannel } from "./commsDispatcher";
import { db } from "@workspace/db";
import { userRolesTable, rolesTable, usersTable, pollingStationsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

const RESULT_ALERT_ROLES = ["campaign-exec-director", "national-campaign-manager"];

export async function alertResultEvent(
  tenantId: string,
  kind: "reported" | "verified",
  pollingStationId: string,
): Promise<void> {
  try {
    const [station] = await db.select({ name: pollingStationsTable.name })
      .from(pollingStationsTable)
      .where(eq(pollingStationsTable.id, pollingStationId))
      .limit(1);
    const label = station?.name ?? "A station";
    const message = kind === "reported"
      ? `📥 ${label} just reported results — now in the verification queue.`
      : `✅ ${label} results verified and added to the tally.`;

    const managers = await db.select({ phone: usersTable.phoneNumber })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
      .where(and(
        eq(userRolesTable.tenantId, tenantId),
        inArray(rolesTable.slug, RESULT_ALERT_ROLES),
        isNotNull(usersTable.phoneNumber),
      ));

    for (const m of managers) {
      const res = await sendWhatsappChannel(tenantId, m.phone!, message);
      if (!res.ok) logger.warn({ err: res.error }, "result alert send failed");
    }
  } catch (err) {
    logger.warn({ err }, "result alert failed");
  }
}
