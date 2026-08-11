import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { useIdentity } from "@/hooks/useIdentity";
import { GeoCascadeSelect } from "@/components/GeoCascadeSelect";
import { Users, ShieldCheck, Vote, Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const err: any = new Error(body?.error ?? `Request failed (${r.status})`);
    err.code = body?.code;
    throw err;
  }
  return r.json();
}

type Path = "volunteer" | "agent" | "candidate";
const ELECTION_LEVELS = ["Presidential", "Gubernatorial", "Senatorial", "Women Rep", "MP", "MCA", "Not sure yet"];

export default function Onboarding() {
  const { isLoaded, isPlatformOperator, campaigns } = useIdentity();
  const [path, setPath] = useState<Path | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tenantId, setTenantId] = useState("");
  const [form, setForm] = useState({ fullName: "", phoneNumber: "", email: "", nationalId: "", organisation: "", electionLevel: "Not sure yet", message: "" });
  const [geoId, setGeoId] = useState(""); // ward (volunteer) or station (agent)

  const { data: campaignsList } = useQuery({
    queryKey: ["enrollment-campaigns"],
    queryFn: () => api("/enrollments/campaigns"),
    enabled: path === "volunteer" || path === "agent",
  });

  // Poll the applicant's own status once submitted.
  const myEnrollments = useQuery({
    queryKey: ["my-enrollments"],
    queryFn: () => api<any[]>("/enrollments/me"),
    enabled: done && path !== "candidate",
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (myEnrollments.data?.some((e) => e.status === "approved")) {
      window.location.href = `${BASE}/dashboard`; // role granted — full reload rebuilds identity
    }
  }, [myEnrollments.data]);

  if (!isLoaded) return null;
  if (isPlatformOperator) return <Redirect to="/platform-admin" />;
  if (campaigns.length > 0) return <Redirect to="/dashboard" />;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (path === "candidate") {
        await api("/enquiries", {
          method: "POST",
          body: JSON.stringify({
            fullName: form.fullName,
            email: form.email,
            organisation: form.organisation,
            electionLevel: form.electionLevel,
            message: form.message || "Campaign onboarding application",
          }),
        });
      } else {
        await api("/enrollments", {
          method: "POST",
          body: JSON.stringify({
            tenantId,
            intendedRole: path === "agent" ? "polling-agent" : "volunteer",
            fullName: form.fullName,
            phoneNumber: form.phoneNumber,
            email: form.email,
            nationalId: path === "agent" ? form.nationalId : undefined,
            ...(path === "agent" ? { preferredStationId: geoId || undefined } : { wardId: geoId || undefined }),
          }),
        });
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const formValid = form.fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email)
    && (path === "candidate" ? form.organisation.trim().length >= 2
      : !!tenantId && form.phoneNumber.trim().length >= 5 && (path !== "agent" || form.nationalId.trim().length >= 5));

  const latest = myEnrollments.data?.[0];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight uppercase">Welcome to Ushindi</h1>
          <p className="text-muted-foreground text-sm mt-2">
            {done ? "Your application has been submitted." : "How would you like to take part?"}
          </p>
        </div>

        {/* Path choice */}
        {!path && !done && (
          <div className="grid gap-3">
            {([
              { key: "volunteer", icon: Users, title: "I'm a Volunteer", desc: "Join a campaign's ground team — events, canvassing, and voter outreach." },
              { key: "agent", icon: ShieldCheck, title: "I'm a Polling Agent", desc: "Represent a campaign at a polling station on election day." },
              { key: "candidate", icon: Vote, title: "I'm a Candidate", desc: "Run your own campaign on the platform — we'll set everything up with you." },
            ] as const).map((p) => (
              <button key={p.key} onClick={() => setPath(p.key)} className="border border-border bg-card p-5 text-left hover:border-primary transition-colors flex gap-4 items-start">
                <p.icon className="h-6 w-6 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-black text-sm uppercase tracking-wider">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{p.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Form */}
        {path && !done && (
          <div className="border border-border bg-card p-5 space-y-4">
            <button onClick={() => setPath(null)} className="text-xs font-bold text-muted-foreground hover:text-foreground">← Back</button>
            <h2 className="font-black text-sm uppercase tracking-wider">
              {path === "volunteer" ? "Volunteer application" : path === "agent" ? "Polling agent application" : "Campaign application"}
            </h2>

            {path !== "candidate" && (
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Campaign</label>
                <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="w-full border border-input px-3 py-2.5 text-sm bg-background">
                  <option value="">Choose a campaign…</option>
                  {(campaignsList ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <Field label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            {path !== "candidate" && <Field label="Phone (WhatsApp)" value={form.phoneNumber} onChange={(v) => setForm({ ...form, phoneNumber: v })} placeholder="+2547…" />}
            {path === "agent" && <Field label="National ID number" value={form.nationalId} onChange={(v) => setForm({ ...form, nationalId: v })} />}
            {path === "candidate" && (
              <>
                <Field label="Campaign / party name" value={form.organisation} onChange={(v) => setForm({ ...form, organisation: v })} />
                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Seat</label>
                  <select value={form.electionLevel} onChange={(e) => setForm({ ...form, electionLevel: e.target.value })} className="w-full border border-input px-3 py-2.5 text-sm bg-background">
                    {ELECTION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Anything we should know?</label>
                  <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} className="w-full border border-input px-3 py-2 text-sm bg-background" />
                </div>
              </>
            )}
            {path === "volunteer" && (
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Your ward (optional)</label>
                <GeoCascadeSelect level="ward" value={geoId} onChange={setGeoId} optional />
              </div>
            )}
            {path === "agent" && (
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Preferred polling station (optional)</label>
                <GeoCascadeSelect level="station" value={geoId} onChange={setGeoId} optional />
              </div>
            )}

            {error && <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 p-2">{error}</p>}
            <button onClick={submit} disabled={!formValid || busy} className="w-full bg-primary text-white py-3 font-black text-sm uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Submit application
            </button>
            <p className="text-[11px] text-muted-foreground">
              {path === "candidate" ? "Our team reviews every campaign application and will be in touch." : "A campaign coordinator will review your application before access is granted."}
            </p>
          </div>
        )}

        {/* Pending / status screen */}
        {done && (
          <div className="border border-border bg-card p-6 text-center space-y-4">
            {path === "candidate" ? (
              <>
                <Clock className="h-10 w-10 text-yellow-600 mx-auto" />
                <p className="font-black uppercase tracking-wider text-sm">Application under review</p>
                <p className="text-xs text-muted-foreground">The platform team will contact you at {form.email} to set up your campaign. You can close this page — sign in again any time to check.</p>
              </>
            ) : latest ? (
              <>
                {latest.status === "pending" && <Clock className="h-10 w-10 text-yellow-600 mx-auto" />}
                {latest.status === "approved" && <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />}
                {latest.status === "rejected" && <XCircle className="h-10 w-10 text-red-600 mx-auto" />}
                <p className="font-black uppercase tracking-wider text-sm">
                  {latest.status === "pending" ? "Awaiting coordinator approval" : latest.status === "approved" ? "Approved!" : "Not approved"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {latest.status === "pending" && `Your ${latest.intendedRole.replace("-", " ")} application to ${latest.campaignName} is in the queue. This page updates automatically.`}
                  {latest.status === "approved" && "Redirecting you to your dashboard…"}
                  {latest.status === "rejected" && (latest.reviewReason ? `Reason: ${latest.reviewReason}` : "Contact the campaign team for details.")}
                </p>
              </>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn("w-full border border-input px-3 py-2.5 text-sm bg-background")} />
    </div>
  );
}
