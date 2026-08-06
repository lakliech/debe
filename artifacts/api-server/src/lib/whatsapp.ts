/**
 * WhatsApp Business Cloud API adapter (Meta Graph API).
 *
 * Configured via environment:
 *   WHATSAPP_ACCESS_TOKEN      — Meta system-user access token (secret)
 *   WHATSAPP_PHONE_NUMBER_ID   — phone_number_id of the platform's sender
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN — hub verification token (secret, webhook route)
 *
 * Inbound events arrive at /api/webhooks/whatsapp (see routes/whatsappWebhook.ts).
 * When the Cloud API is not configured, the comms dispatcher falls back to the
 * generic COMMS_WHATSAPP_WEBHOOK_URL provider, so both paths stay usable.
 */
import { logger } from "./logger";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Configured when the app token exists AND a sender number is available —
 * either the campaign's own phone_number_id (per-tenant sender identity) or
 * the platform default.
 */
export function whatsappCloudConfigured(phoneNumberId?: string): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN && !!(phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Meta expects digits-only international format ("2547…"), no leading "+". */
export function toWaAddress(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * Send a text message. `phoneNumberId` overrides the platform default sender
 * with the campaign's own connected number (tenants.whatsapp_phone_number_id).
 */
export async function sendWhatsAppText(to: string, body: string, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID): Promise<{
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !phoneNumberId) return { ok: false, error: "WhatsApp Cloud API not configured" };

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toWaAddress(to),
        type: "text",
        text: { body },
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `graph api responded ${res.status}` };
    }
    return { ok: true, providerMessageId: data?.messages?.[0]?.id };
  } catch (err: any) {
    logger.warn({ err }, "whatsapp cloud send failed");
    return { ok: false, error: err?.message ?? "network error" };
  }
}
