/**
 * Aspirant declaration notifications — alerts the campaign review team
 * (senior campaign roles) when a new aspirant submits a self-declaration.
 *
 * Fire-and-forget by design: a notification failure must never roll back
 * the declaration that triggered it. All errors are logged, never thrown.
 * Sends via WhatsApp (same provider chain as the comms dispatcher) AND
 * email, so reviewers are reached even if one channel is unavailable.
 */
import { logger } from "./logger";
import { sendWhatsappChannel } from "./commsDispatcher";
import { sendEmailAsync } from "./email";
import { db } from "@workspace/db";
import { userRolesTable, rolesTable, usersTable, tenantsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Roles considered part of the aspirant review team.
 * Lower level = more privileged (see roleCatalogue.ts).
 */
const ASPIRANT_REVIEW_ROLES = [
  "campaign-exec-director",
  "national-campaign-manager",
  "national-organising-director",
];

/**
 * Human-readable label for each position value stored in the database.
 */
function positionLabel(position: string): string {
  const labels: Record<string, string> = {
    parliamentary: "Parliamentary",
    gubernatorial: "Gubernatorial",
    senatorial: "Senatorial",
    women_rep: "Women Representative",
    mca: "MCA",
  };
  return labels[position] ?? position;
}

/**
 * The aspirants review page is at /aspirants in the SPA.
 * Tenant context is established via login (domain or X-Tenant-Slug header),
 * not the URL path, so no slug segment is needed.
 */
function reviewUrl(): string {
  const base = process.env.PLATFORM_URL ?? "https://example.com";
  return `${base}/aspirants`;
}

export async function notifyAspirantDeclaration(
  tenantId: string,
  aspirantName: string,
  position: string,
): Promise<void> {
  try {
    // Fetch tenant slug and name for the notification body
    const [tenant] = await db
      .select({ slug: tenantsTable.slug, name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    const campaignName = tenant?.name ?? "the campaign";
    const dashboardUrl = reviewUrl();
    const posLabel = positionLabel(position);
    const whatsappMessage =
      `📋 New aspirant declaration received on ${campaignName}.\n` +
      `Name: ${aspirantName}\nPosition: ${posLabel}\n` +
      `Review: ${dashboardUrl}`;

    // Fetch all review-team members who have a phone number or email
    const members = await db
      .select({
        phone: usersTable.phoneNumber,
        email: usersTable.email,
      })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
      .where(
        and(
          eq(userRolesTable.tenantId, tenantId),
          inArray(rolesTable.slug, ASPIRANT_REVIEW_ROLES),
        ),
      );

    const seen = new Set<string>();

    for (const m of members) {
      const key = `${m.phone ?? ""}|${m.email ?? ""}`;
      if (seen.has(key)) continue; // guard against duplicate rows from multi-role users
      seen.add(key);

      // WhatsApp — only when a phone number is present
      if (m.phone) {
        const res = await sendWhatsappChannel(tenantId, m.phone, whatsappMessage);
        if (!res.ok) {
          logger.warn({ err: res.error, to: m.phone }, "aspirant declaration WhatsApp alert failed");
        }
      }

      // Email — only when an email address is present
      if (m.email) {
        sendEmailAsync({
          to: m.email,
          template: "aspirant_declaration",
          data: {
            aspirantName,
            position: posLabel,
            campaignName,
            reviewUrl: dashboardUrl,
          },
          tenantId,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "aspirant declaration notification failed");
  }
}
