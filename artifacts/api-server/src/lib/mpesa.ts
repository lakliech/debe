/**
 * M-Pesa Daraja Sandbox Adapter
 *
 * This module provides a configurable interface for M-Pesa STK Push (Lipa Na M-Pesa Online).
 * In sandbox mode it returns realistic mock responses. Swap the adapter for live credentials
 * by setting the env vars below and using LiveMpesaAdapter.
 *
 * Required environment variables for live mode:
 *   MPESA_CONSUMER_KEY        — Daraja API consumer key
 *   MPESA_CONSUMER_SECRET     — Daraja API consumer secret
 *   MPESA_SHORTCODE           — Business shortcode (campaign's own Paybill)
 *   MPESA_PASSKEY             — Lipa Na M-Pesa passkey from Daraja portal
 *   MPESA_CALLBACK_URL        — Public HTTPS URL for STK callbacks
 *   MPESA_ENV                 — "sandbox" | "production" (default: "sandbox")
 *
 * Each campaign (tenant) can store its OWN Daraja credentials in the
 * tenant_mpesa_configs table — see createMpesaAdapterForTenant(). The env
 * vars above remain as a platform-wide fallback for tenants without a row.
 *
 * consumerSecret/passkey are stored AES-256-GCM encrypted (helpers below);
 * rows seeded with plaintext are tolerated for ops convenience.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantMpesaConfigsTable } from "@workspace/db";

export interface MpesaLiveConfig {
  shortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  environment?: string; // "sandbox" | "production" (default: "sandbox")
  callbackUrl: string;
}

// ─── Credential encryption at rest (AES-256-GCM) ─────────────────────────────

const ENC_PREFIX = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.MPESA_CONFIG_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("MPESA_CONFIG_ENCRYPTION_KEY (or SESSION_SECRET) is required for M-Pesa tenant credential encryption");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ENC_PREFIX}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(`${ENC_PREFIX}:`)) return stored; // plaintext-seeded row
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("Malformed encrypted M-Pesa credential");
  const [, iv, tag, data] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export interface StkPushRequest {
  phoneNumber: string;        // Format: 254XXXXXXXXX
  amount: number;             // KES amount (min 1)
  accountReference: string;   // e.g. "LIND-20271025-0001"
  transactionDesc: string;    // Short description shown to user
}

export interface StkPushResponse {
  success: boolean;
  merchantRequestId?: string;
  checkoutRequestId?: string;
  responseCode?: string;
  responseDescription?: string;
  customerMessage?: string;
  error?: string;
}

export interface StkCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;       // 0 = success
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

export interface IMpesaAdapter {
  initiateStkPush(req: StkPushRequest): Promise<StkPushResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SANDBOX ADAPTER (default — no live credentials required)
// ─────────────────────────────────────────────────────────────────────────────

export class SandboxMpesaAdapter implements IMpesaAdapter {
  async initiateStkPush(req: StkPushRequest): Promise<StkPushResponse> {
    // Validate phone format
    if (!/^254\d{9}$/.test(req.phoneNumber)) {
      return { success: false, error: "Phone must be in format 254XXXXXXXXX" };
    }
    if (req.amount < 1) {
      return { success: false, error: "Amount must be at least KES 1" };
    }

    // Simulate sandbox response
    const merchantRequestId = `SANDBOX-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const checkoutRequestId = `ws_CO_${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;

    console.info(`[mpesa-sandbox] STK Push: phone=${req.phoneNumber} amount=${req.amount} ref=${req.accountReference}`);
    console.info(`[mpesa-sandbox] merchantRequestId=${merchantRequestId} checkoutRequestId=${checkoutRequestId}`);

    return {
      success: true,
      merchantRequestId,
      checkoutRequestId,
      responseCode: "0",
      responseDescription: "Success. Request accepted for processing",
      customerMessage: "Success. Request accepted for processing",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UNCONFIGURED ADAPTER — fail-closed response when a campaign has no usable
//  M-Pesa configuration (never silently route money anywhere else)
// ─────────────────────────────────────────────────────────────────────────────

export class UnconfiguredMpesaAdapter implements IMpesaAdapter {
  constructor(private readonly reason: string) {}
  async initiateStkPush(_req: StkPushRequest): Promise<StkPushResponse> {
    return { success: false, error: this.reason };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE ADAPTER (requires production/sandbox Daraja credentials)
// ─────────────────────────────────────────────────────────────────────────────

export class LiveMpesaAdapter implements IMpesaAdapter {
  private readonly baseUrl: string;
  readonly shortcode: string;
  readonly environment: string;
  private readonly passkey: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly callbackUrl: string;

  constructor(config: MpesaLiveConfig) {
    this.environment = config.environment ?? "sandbox";
    this.baseUrl = this.environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
    this.shortcode = config.shortcode;
    this.passkey = config.passkey;
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.callbackUrl = config.callbackUrl;
  }

  /** Build from the platform-wide environment variables (fallback path). */
  static fromEnv(): LiveMpesaAdapter {
    return new LiveMpesaAdapter({
      shortcode: process.env.MPESA_SHORTCODE ?? "174379", // sandbox default
      consumerKey: process.env.MPESA_CONSUMER_KEY ?? "",
      consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? "",
      passkey: process.env.MPESA_PASSKEY ?? "",
      environment: process.env.MPESA_ENV ?? "sandbox",
      callbackUrl: process.env.MPESA_CALLBACK_URL ?? "",
    });
  }

  private async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (!res.ok) throw new Error(`M-Pesa auth failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  private buildPassword(timestamp: string): string {
    const raw = `${this.shortcode}${this.passkey}${timestamp}`;
    return Buffer.from(raw).toString("base64");
  }

  async initiateStkPush(req: StkPushRequest): Promise<StkPushResponse> {
    if (!/^254\d{9}$/.test(req.phoneNumber)) {
      return { success: false, error: "Phone must be in format 254XXXXXXXXX" };
    }
    try {
      const token = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
      const password = this.buildPassword(timestamp);

      const payload = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.ceil(req.amount),
        PartyA: req.phoneNumber,
        PartyB: this.shortcode,
        PhoneNumber: req.phoneNumber,
        CallBackURL: this.callbackUrl,
        AccountReference: req.accountReference,
        TransactionDesc: req.transactionDesc,
      };

      const res = await fetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `Daraja API error: ${res.status} ${err}` };
      }

      const data = await res.json() as any;
      return {
        success: data.ResponseCode === "0",
        merchantRequestId: data.MerchantRequestID,
        checkoutRequestId: data.CheckoutRequestID,
        responseCode: data.ResponseCode,
        responseDescription: data.ResponseDescription,
        customerMessage: data.CustomerMessage,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Factories
// ─────────────────────────────────────────────────────────────────────────────

/** Platform-wide fallback — live env adapter when env credentials exist, else sandbox. */
export function createMpesaAdapter(): IMpesaAdapter {
  if (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) {
    console.info("[mpesa] Using live Daraja adapter (env credentials)");
    return LiveMpesaAdapter.fromEnv();
  }
  console.info("[mpesa] Using sandbox adapter (set MPESA_CONSUMER_KEY to enable live mode)");
  return new SandboxMpesaAdapter();
}

/**
 * Tenant-aware factory: a campaign with a row in tenant_mpesa_configs pays
 * into its OWN shortcode with its OWN Daraja credentials (secrets decrypted
 * at read time).
 *
 * Fail-closed in production: a resolved tenant WITHOUT a config row gets an
 * UnconfiguredMpesaAdapter (clear error to the donor) rather than silently
 * routing payments through the platform's env credentials — and config rows
 * holding PLAINTEXT secrets are refused (encrypt via encryptSecret first).
 * Outside production the env/sandbox fallback and plaintext tolerance remain
 * available for development and one-time seeding.
 */
export async function createMpesaAdapterForTenant(tenantId?: string): Promise<IMpesaAdapter> {
  const isProduction = process.env.NODE_ENV === "production";
  if (tenantId) {
    const [cfg] = await db
      .select()
      .from(tenantMpesaConfigsTable)
      .where(eq(tenantMpesaConfigsTable.tenantId, tenantId))
      .limit(1);
    if (cfg) {
      const secretsEncrypted =
        cfg.consumerSecret.startsWith(`${ENC_PREFIX}:`) && cfg.passkey.startsWith(`${ENC_PREFIX}:`);
      if (isProduction && !secretsEncrypted) {
        console.error(`[mpesa] tenant ${tenantId} config holds plaintext credentials — refusing in production`);
        return new UnconfiguredMpesaAdapter("M-Pesa is temporarily unavailable for this campaign. Please try again later.");
      }
      console.info(`[mpesa] Using per-tenant Daraja config (tenant=${tenantId} env=${cfg.environment} shortcode=${cfg.shortcode})`);
      return new LiveMpesaAdapter({
        shortcode: cfg.shortcode,
        consumerKey: cfg.consumerKey,
        consumerSecret: decryptSecret(cfg.consumerSecret),
        passkey: decryptSecret(cfg.passkey),
        environment: cfg.environment,
        callbackUrl: process.env.MPESA_CALLBACK_URL ?? "",
      });
    }
    if (isProduction) {
      console.warn(`[mpesa] tenant ${tenantId} has no M-Pesa config — env fallback refused in production`);
      return new UnconfiguredMpesaAdapter("This campaign is not yet set up to receive M-Pesa contributions.");
    }
  }
  return createMpesaAdapter();
}

/**
 * Idempotent table provisioning — runs at every API server boot (startup
 * housekeeping). drizzle-kit push is unreliable in this repo (known journal
 * drift), so this CREATE TABLE IF NOT EXISTS is the durable path that
 * provisions staging/production/rebuilt databases. Keep column-for-column
 * in sync with tenantMpesaConfigsTable in lib/db/src/schema/finance.ts.
 */
export async function ensureMpesaConfigTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tenant_mpesa_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      shortcode text NOT NULL,
      consumer_key text NOT NULL,
      consumer_secret text NOT NULL,
      passkey text NOT NULL,
      environment text NOT NULL DEFAULT 'sandbox',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.info("[mpesa] tenant_mpesa_configs table provisioned (IF NOT EXISTS).");
}

/** Parse the STK callback and extract key fields */
export function parseStkCallback(payload: StkCallbackPayload) {
  const cb = payload.Body.stkCallback;
  const success = cb.ResultCode === 0;
  const items = cb.CallbackMetadata?.Item ?? [];

  const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;

  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: String(cb.ResultCode),
    resultDesc: cb.ResultDesc,
    success,
    mpesaReceiptNumber: success ? String(getItem("MpesaReceiptNumber") ?? "") : undefined,
    amount: success ? Number(getItem("Amount") ?? 0) : undefined,
    transactionDate: success ? String(getItem("TransactionDate") ?? "") : undefined,
    phoneNumber: success ? String(getItem("PhoneNumber") ?? "") : undefined,
  };
}
