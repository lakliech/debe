import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plug, Smartphone, MessageSquare, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/integrations${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Request failed (${r.status})`);
  return r.json();
}

export default function Integrations() {
  const status = useQuery({ queryKey: ["integrations"], queryFn: () => api("/") });

  return (
    <div className="space-y-6 pb-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight uppercase flex items-center gap-2">
          <Plug className="h-6 w-6 text-primary" />Integrations
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect your campaign's own M-PESA and WhatsApp Business accounts. Secrets are encrypted at rest
          and never displayed again after saving — re-enter them to rotate.
        </p>
      </div>
      {status.isLoading ? (
        <><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></>
      ) : (
        <>
          <MpesaCard state={status.data?.mpesa} onChanged={() => status.refetch()} />
          <WhatsappCard state={status.data?.whatsapp} onChanged={() => status.refetch()} />
        </>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: any }) {
  if (!state?.configured) return <span className="text-xs font-bold uppercase px-2 py-0.5 bg-muted text-muted-foreground">Not connected</span>;
  return <span className="text-xs font-bold uppercase px-2 py-0.5 bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Connected</span>;
}

function Field({ label, value, onChange, type = "text", placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoComplete="off" className="w-full border border-input px-3 py-2.5 text-sm bg-background font-mono" />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function useSave(path: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (body: any) => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api(path, { method: "PUT", body: JSON.stringify(body) });
      setSaved(true); onChanged();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect this integration? Sending will fall back to the platform default.")) return;
    setBusy(true); setError(null);
    try { await api(path, { method: "DELETE" }); onChanged(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return { busy, error, saved, submit, disconnect };
}

function MpesaCard({ state, onChanged }: { state: any; onChanged: () => void }) {
  const [form, setForm] = useState({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "", environment: "sandbox" });
  const { busy, error, saved, submit, disconnect } = useSave("/mpesa", onChanged);
  const valid = /^\d{5,10}$/.test(form.shortcode) && form.consumerKey.length >= 5 && form.consumerSecret.length >= 5 && form.passkey.length >= 5;

  return (
    <div className="border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-green-700" />M-PESA (Daraja)
        </h2>
        <StatusBadge state={state} />
      </div>
      {state?.configured && (
        <div className="text-xs text-muted-foreground border border-border bg-muted/30 p-3 flex items-center justify-between">
          <span>Shortcode <b className="font-mono">{state.shortcode}</b> · Consumer key <b className="font-mono">{state.consumerKey}</b> · {state.environment}</span>
          <button onClick={disconnect} className="text-red-700 font-bold flex items-center gap-1 hover:underline"><Trash2 className="h-3 w-3" />Disconnect</button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Shortcode (Paybill/Till)" value={form.shortcode} onChange={(v) => setForm({ ...form, shortcode: v })} placeholder="174379" />
        <div>
          <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Environment</label>
          <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="w-full border border-input px-3 py-2.5 text-sm bg-background">
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production (live payments)</option>
          </select>
        </div>
        <Field label="Consumer Key" value={form.consumerKey} onChange={(v) => setForm({ ...form, consumerKey: v })} />
        <Field label="Consumer Secret" type="password" value={form.consumerSecret} onChange={(v) => setForm({ ...form, consumerSecret: v })} />
        <Field label="Passkey" type="password" value={form.passkey} onChange={(v) => setForm({ ...form, passkey: v })} hint="From the Safaricom Daraja portal" />
      </div>
      {form.environment === "production" && (
        <p className="text-xs font-bold text-yellow-800 bg-yellow-50 border border-yellow-200 p-2">
          Production credentials process real money. Verify the shortcode carefully before saving.
        </p>
      )}
      <FormFooter busy={busy} error={error} saved={saved} valid={valid} onSave={() => submit(form)} />
    </div>
  );
}

function WhatsappCard({ state, onChanged }: { state: any; onChanged: () => void }) {
  const [form, setForm] = useState({ phoneNumberId: "", businessAccountId: "", accessToken: "" });
  const { busy, error, saved, submit, disconnect } = useSave("/whatsapp", onChanged);
  const valid = /^\d{5,25}$/.test(form.phoneNumberId) && form.accessToken.length >= 20;

  return (
    <div className="border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-green-600" />WhatsApp Business
        </h2>
        <StatusBadge state={state} />
      </div>
      {state?.configured && (
        <div className="text-xs text-muted-foreground border border-border bg-muted/30 p-3 flex items-center justify-between">
          <span>Phone number ID <b className="font-mono">{state.phoneNumberId}</b>{state.businessAccountId ? <> · WABA <b className="font-mono">{state.businessAccountId}</b></> : null}</span>
          <button onClick={disconnect} className="text-red-700 font-bold flex items-center gap-1 hover:underline"><Trash2 className="h-3 w-3" />Disconnect</button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Phone Number ID" value={form.phoneNumberId} onChange={(v) => setForm({ ...form, phoneNumberId: v })} hint="Meta Business → WhatsApp → API Setup" />
        <Field label="Business Account ID (optional)" value={form.businessAccountId} onChange={(v) => setForm({ ...form, businessAccountId: v })} />
        <div className="sm:col-span-2">
          <Field label="Permanent Access Token" type="password" value={form.accessToken} onChange={(v) => setForm({ ...form, accessToken: v })} hint="System-user token with whatsapp_business_messaging permission" />
        </div>
      </div>
      <FormFooter busy={busy} error={error} saved={saved} valid={valid} onSave={() => submit(form)} />
    </div>
  );
}

function FormFooter({ busy, error, saved, valid, onSave }: { busy: boolean; error: string | null; saved: boolean; valid: boolean; onSave: () => void }) {
  return (
    <div className="space-y-2">
      {error && <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 p-2">{error}</p>}
      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={!valid || busy}
          className={cn("bg-primary text-white px-5 py-2.5 font-black text-xs uppercase tracking-wider disabled:opacity-50 flex items-center gap-2")}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save credentials
        </button>
        {saved && <span className="text-xs font-bold text-green-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Saved — secrets encrypted</span>}
      </div>
    </div>
  );
}
