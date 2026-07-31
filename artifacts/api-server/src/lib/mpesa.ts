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
 * Each campaign configures its own Daraja credentials via these environment
 * variables — no campaign-specific shortcode is hardcoded here.
 */

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
//  LIVE ADAPTER (requires production/sandbox Daraja credentials)
// ─────────────────────────────────────────────────────────────────────────────

export class LiveMpesaAdapter implements IMpesaAdapter {
  private readonly baseUrl: string;
  private readonly shortcode: string;
  private readonly passkey: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly callbackUrl: string;

  constructor() {
    const env = process.env.MPESA_ENV ?? "sandbox";
    this.baseUrl = env === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
    this.shortcode   = process.env.MPESA_SHORTCODE ?? "174379";  // sandbox default
    this.passkey     = process.env.MPESA_PASSKEY ?? "";
    this.consumerKey = process.env.MPESA_CONSUMER_KEY ?? "";
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET ?? "";
    this.callbackUrl = process.env.MPESA_CALLBACK_URL ?? "";
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
//  Factory — returns sandbox adapter unless MPESA_CONSUMER_KEY is set
// ─────────────────────────────────────────────────────────────────────────────

export function createMpesaAdapter(): IMpesaAdapter {
  if (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) {
    console.info("[mpesa] Using live Daraja adapter");
    return new LiveMpesaAdapter();
  }
  console.info("[mpesa] Using sandbox adapter (set MPESA_CONSUMER_KEY to enable live mode)");
  return new SandboxMpesaAdapter();
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
