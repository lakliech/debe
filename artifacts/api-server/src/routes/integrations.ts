/**
 * Tenant integration provisioning — campaign admins connect their own
 * external services (M-PESA Daraja, WhatsApp Business Cloud) by supplying
 * their credentials. Secrets are AES-256-GCM encrypted at rest
 * (encryptSecret, lib/mpesa.ts) and are NEVER returned by the API: reads
 * expose only non-secret identifiers plus a configured flag, so credential
 * entry is write-only (re-enter to rotate).
 *
 * Mounted withTenant — every endpoint is scoped to the caller's campaign.
 * Guard: requireLevel(1) → campaign super-admin and platform operators.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  tenantMpesaConfigsTable,
  tenantWhatsappConfigsTable,
  tenantsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireLevel } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { sendRouteError } from "../lib/routeError";
import { assertTenant } from "../lib/withTenant";
import { encryptSecret } from "../lib/mpesa";
import { logger } from "../lib/logger";

const router = Router();

// Only campaign super-admins (level 1) and platform operators (level 0).
router.use(requireLevel(1));

const mask = (v: string | null | undefined) =>
  v ? `…${v.slice(-4)}` : null;

// Current provisioning state — secrets masked, never returned in full.
router.get("/", async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [mpesa] = await db.select().from(tenantMpesaConfigsTable)
      .where(eq(tenantMpesaConfigsTable.tenantId, t.id)).limit(1);
    const [wa] = await db.select().from(tenantWhatsappConfigsTable)
      .where(eq(tenantWhatsappConfigsTable.tenantId, t.id)).limit(1);
    res.json({
      mpesa: mpesa
        ? { configured: true, shortcode: mpesa.shortcode, consumerKey: mask(mpesa.consumerKey), environment: mpesa.environment, updatedAt: mpesa.updatedAt }
        : { configured: false },
      whatsapp: wa
        ? { configured: true, phoneNumberId: wa.phoneNumberId, businessAccountId: wa.businessAccountId, enabled: wa.enabled, updatedAt: wa.updatedAt }
        : { configured: false },
    });
  } catch (err) { sendRouteError(res, err); }
});

const mpesaSchema = z.object({
  shortcode: z.string().trim().regex(/^\d{5,10}$/, "Shortcode is 5–10 digits"),
  consumerKey: z.string().trim().min(5).max(200),
  consumerSecret: z.string().trim().min(5).max(200),
  passkey: z.string().trim().min(5).max(300),
  environment: z.enum(["sandbox", "production"]),
});

router.put("/mpesa", async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(mpesaSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.insert(tenantMpesaConfigsTable).values({
      tenantId: t.id,
      shortcode: parsed.shortcode,
      consumerKey: parsed.consumerKey,
      consumerSecret: encryptSecret(parsed.consumerSecret),
      passkey: encryptSecret(parsed.passkey),
      environment: parsed.environment,
    }).onConflictDoUpdate({
      target: tenantMpesaConfigsTable.tenantId,
      set: {
        shortcode: parsed.shortcode,
        consumerKey: parsed.consumerKey,
        consumerSecret: encryptSecret(parsed.consumerSecret),
        passkey: encryptSecret(parsed.passkey),
        environment: parsed.environment,
        updatedAt: new Date(),
      },
    }).returning();
    logger.info({ tenantId: t.id, env: parsed.environment }, "tenant M-PESA config provisioned");
    res.json({ configured: true, shortcode: row.shortcode, environment: row.environment, updatedAt: row.updatedAt });
  } catch (err) { sendRouteError(res, err); }
});

const whatsappSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "Phone number ID is numeric"),
  businessAccountId: z.string().trim().max(50).optional(),
  accessToken: z.string().trim().min(20).max(600),
  enabled: z.boolean().default(true),
});

router.put("/whatsapp", async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(whatsappSchema, req.body, res);
    if (!parsed) return;
    const encrypted = encryptSecret(parsed.accessToken);
    let row;
    try {
      row = await db.transaction(async (tx) => {
        // tenants.whatsapp_phone_number_id is globally unique (webhook routing) —
        // reject early with a clear error instead of a raw constraint violation.
        if (parsed.enabled) {
          const [conflict] = await tx.select({ id: tenantsTable.id }).from(tenantsTable)
            .where(and(eq(tenantsTable.whatsappPhoneNumberId, parsed.phoneNumberId), sql`${tenantsTable.id} <> ${t.id}`)).limit(1);
          if (conflict) throw Object.assign(new Error("That WhatsApp number is already connected to another campaign"), { status: 409 });
        }
        const [r] = await tx.insert(tenantWhatsappConfigsTable).values({
          tenantId: t.id,
          phoneNumberId: parsed.phoneNumberId,
          businessAccountId: parsed.businessAccountId ?? null,
          accessToken: encrypted,
          enabled: parsed.enabled,
        }).onConflictDoUpdate({
          target: tenantWhatsappConfigsTable.tenantId,
          set: {
            phoneNumberId: parsed.phoneNumberId,
            businessAccountId: parsed.businessAccountId ?? null,
            accessToken: encrypted,
            enabled: parsed.enabled,
            updatedAt: new Date(),
          },
        }).returning();
        // Keep the legacy sender-identity column in sync — older send paths read it.
        await tx.update(tenantsTable)
          .set({ whatsappPhoneNumberId: parsed.enabled ? parsed.phoneNumberId : null } as any)
          .where(eq(tenantsTable.id, t.id));
        return r;
      });
    } catch (e: any) {
      // Pre-check has a race window; the unique index is the backstop.
      if (e?.status === 409 || e?.cause?.code === "23505" || e?.code === "23505") {
        return res.status(409).json({ error: "That WhatsApp number is already connected to another campaign" });
      }
      throw e;
    }
    logger.info({ tenantId: t.id }, "tenant WhatsApp config provisioned");
    res.json({ configured: true, phoneNumberId: row.phoneNumberId, enabled: row.enabled, updatedAt: row.updatedAt });
  } catch (err) { sendRouteError(res, err); }
});

// Disconnect a provider (row removal; nothing else references the secrets).
router.delete("/:provider", async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    if (req.params.provider === "mpesa") {
      await db.delete(tenantMpesaConfigsTable).where(eq(tenantMpesaConfigsTable.tenantId, t.id));
    } else if (req.params.provider === "whatsapp") {
      await db.transaction(async (tx) => {
        await tx.delete(tenantWhatsappConfigsTable).where(eq(tenantWhatsappConfigsTable.tenantId, t.id));
        await tx.update(tenantsTable).set({ whatsappPhoneNumberId: null } as any).where(eq(tenantsTable.id, t.id));
      });
    } else {
      return res.status(404).json({ error: "Unknown provider" });
    }
    logger.info({ tenantId: t.id, provider: req.params.provider }, "tenant integration disconnected");
    res.json({ ok: true });
  } catch (err) { sendRouteError(res, err); }
});

export default router;
