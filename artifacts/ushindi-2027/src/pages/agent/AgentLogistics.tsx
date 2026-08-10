import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Siren, MapPin, CheckCircle2, Truck, ShieldAlert, ClipboardList, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/logistics${path}`, {
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

const CHECK_IN_TYPES: { value: string; label: string }[] = [
  { value: "arrival", label: "Arrived at station" },
  { value: "setup_complete", label: "Setup complete" },
  { value: "voting_started", label: "Voting started" },
  { value: "voting_ended", label: "Voting ended" },
  { value: "counting_started", label: "Counting started" },
  { value: "results_submitted", label: "Results submitted" },
  { value: "departure", label: "Departing station" },
];

function getGps(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

const HOLD_MS = 3000;

export default function AgentLogistics() {
  const { data: elections } = useQuery({
    queryKey: ["elections-agent-logistics"],
    queryFn: () => fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  const electionId = (elections as any[] | undefined)?.find((e: any) => e.isActive)?.id ?? (elections as any[])?.[0]?.id ?? "";

  // ── Panic button (hold 3s to trigger) ──
  const [holding, setHolding] = useState(false);
  const [holdPct, setHoldPct] = useState(0);
  const [confirmPanic, setConfirmPanic] = useState(false);
  const [panicSent, setPanicSent] = useState(false);
  const [panicError, setPanicError] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStart = useRef(0);

  const stopHold = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
    setHoldPct(0);
  };
  const startHold = () => {
    if (panicSent) return;
    setHolding(true);
    holdStart.current = Date.now();
    holdTimer.current = setInterval(() => {
      const pct = ((Date.now() - holdStart.current) / HOLD_MS) * 100;
      if (pct >= 100) {
        stopHold();
        setConfirmPanic(true); // "Are you in danger?" confirmation
      } else {
        setHoldPct(pct);
      }
    }, 50);
  };

  const triggerPanic = async () => {
    setConfirmPanic(false);
    setPanicError(null);
    const gps = await getGps();
    try {
      await api(`/panic`, { method: "POST", body: JSON.stringify({ electionId, gpsLat: gps?.lat, gpsLon: gps?.lon }) });
      setPanicSent(true);
    } catch (e: any) {
      setPanicError(e.message);
    }
  };

  // Poll my panic status so the agent sees when help acknowledges it.
  const myPanic = useQuery({
    queryKey: ["my-panic", electionId],
    queryFn: () => api(`/my-panic?electionId=${electionId}`),
    enabled: !!electionId && panicSent,
    refetchInterval: 10_000,
  });
  const panicStatus = (myPanic.data as any)?.status;

  // ── Check-in flow ──
  const [checkInType, setCheckInType] = useState("arrival");
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkInResult, setCheckInResult] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const doCheckIn = async () => {
    setCheckInBusy(true); setCheckInResult(null); setCheckInError(null);
    const gps = await getGps();
    try {
      const res = await api(`/check-ins`, {
        method: "POST",
        body: JSON.stringify({ electionId, checkInType, gpsLat: gps?.lat, gpsLon: gps?.lon, gpsAccuracy: gps?.accuracy, source: "pwa" }),
      });
      setCheckInResult(
        res.isWithinGeofence === false
          ? `Checked in, but you appear to be ${Math.round(res.distanceFromStation)}m from your station. The command center has been notified.`
          : "Checked in successfully. Thank you!",
      );
    } catch (e: any) {
      setCheckInError(e.message);
    } finally {
      setCheckInBusy(false);
    }
  };

  // ── My transport ──
  const transport = useQuery({
    queryKey: ["my-transport", electionId],
    queryFn: () => api(`/my-transport?electionId=${electionId}`),
    enabled: !!electionId,
    refetchInterval: 30_000,
  });
  const rides = (transport.data as any[]) ?? [];

  // ── Incident report ──
  const [incident, setIncident] = useState({ incidentType: "other", severity: "medium", title: "", description: "" });
  const [incidentMsg, setIncidentMsg] = useState<string | null>(null);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const reportIncident = async () => {
    setIncidentBusy(true); setIncidentMsg(null);
    const gps = await getGps();
    try {
      await api(`/security-incidents`, {
        method: "POST",
        body: JSON.stringify({ electionId, ...incident, gpsLat: gps?.lat, gpsLon: gps?.lon }),
      });
      setIncident({ incidentType: "other", severity: "medium", title: "", description: "" });
      setIncidentMsg("Incident reported. The command center has been alerted.");
    } catch (e: any) {
      setIncidentMsg(e.message);
    } finally {
      setIncidentBusy(false);
    }
  };

  useEffect(() => () => stopHold(), []);

  return (
    <div className="max-w-md mx-auto p-4 space-y-5 pb-16">
      <h1 className="text-xl font-extrabold uppercase tracking-tight">Field Operations</h1>

      {/* PANIC */}
      <div className="border-2 border-red-600 bg-red-50 p-4 text-center space-y-3">
        {panicSent ? (
          <div className="space-y-1">
            <p className="font-black text-red-700 uppercase">Alert sent. Help is on the way.</p>
            <p className="text-xs text-red-600">
              {panicStatus === "acknowledged" ? "✅ A security officer has acknowledged your alert."
                : panicStatus === "resolved" ? "✅ Your alert has been resolved."
                : "Waiting for the command center to acknowledge…"}
            </p>
          </div>
        ) : (
          <>
            <button
              onPointerDown={startHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              className="w-full bg-red-600 text-white py-5 font-black text-lg uppercase tracking-widest active:bg-red-700 select-none touch-none relative overflow-hidden"
            >
              <span className="absolute inset-y-0 left-0 bg-red-800/60" style={{ width: `${holdPct}%` }} />
              <span className="relative flex items-center justify-center gap-2"><Siren className="h-6 w-6" />{holding ? "Keep holding…" : "PANIC — hold 3s"}</span>
            </button>
            <p className="text-xs text-red-700">Press and hold for 3 seconds to send a distress alert with your GPS location.</p>
          </>
        )}
        {panicError && <p className="text-xs font-bold text-red-800">{panicError}</p>}
      </div>

      {/* Confirm modal */}
      {confirmPanic && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
          <div className="bg-white p-6 max-w-sm w-full space-y-4 border-4 border-red-600">
            <p className="font-black text-lg text-red-700 uppercase text-center">Are you in danger?</p>
            <p className="text-sm text-center text-muted-foreground">This sends an immediate alert with your GPS location to the security team.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmPanic(false)} className="flex-1 border border-border py-3 font-bold text-sm">Cancel</button>
              <button onClick={triggerPanic} className="flex-1 bg-red-600 text-white py-3 font-black text-sm uppercase">Send Alert</button>
            </div>
          </div>
        </div>
      )}

      {/* CHECK-IN */}
      <div className="border border-border bg-card p-4 space-y-3">
        <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />Check In</h2>
        <select value={checkInType} onChange={(e) => setCheckInType(e.target.value)} className="w-full border border-input px-3 py-2.5 text-sm bg-background font-medium">
          {CHECK_IN_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button onClick={doCheckIn} disabled={checkInBusy || !electionId} className="w-full bg-primary text-white py-3 font-black text-sm uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2">
          {checkInBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          {checkInBusy ? "Capturing GPS…" : "Check In Now"}
        </button>
        {checkInResult && <p className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 p-2">{checkInResult}</p>}
        {checkInError && <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 p-2">{checkInError}</p>}
      </div>

      {/* SUBMIT RESULTS */}
      <Link href="/agent/results" className="border border-border bg-card p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors">
        <ClipboardList className="h-5 w-5 text-primary" />
        <div>
          <p className="font-black text-sm uppercase tracking-wider">Submit Results</p>
          <p className="text-xs text-muted-foreground">Complete your result form after counting</p>
        </div>
      </Link>

      {/* MY TRANSPORT */}
      <div className="border border-border bg-card p-4 space-y-2">
        <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2"><Truck className="h-4 w-4 text-blue-600" />My Transport</h2>
        {rides.length === 0 ? (
          <p className="text-xs text-muted-foreground">No transport assigned. Contact your coordinator if you expected a pickup.</p>
        ) : (
          rides.map((r) => (
            <div key={r.id} className="text-xs border border-border p-3 space-y-1">
              <p className="font-bold">{r.vehicleRegistration ?? "Vehicle"} · <span className="uppercase">{r.status}</span></p>
              <p className="text-muted-foreground">{r.originDescription ?? "Pickup"} → {r.destinationDescription ?? "Destination"}</p>
              {r.plannedDepartureAt && <p className="text-muted-foreground">Departs: {new Date(r.plannedDepartureAt).toLocaleTimeString()}</p>}
            </div>
          ))
        )}
      </div>

      {/* REPORT INCIDENT */}
      <div className="border border-border bg-card p-4 space-y-3">
        <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-orange-600" />Report Security Incident</h2>
        <div className="flex gap-2">
          <select value={incident.incidentType} onChange={(e) => setIncident({ ...incident, incidentType: e.target.value })} className="flex-1 border border-input px-2 py-2 text-xs bg-background">
            {["violence", "intimidation", "vote_buying", "ballot_stuffing", "agent_exclusion", "voter_suppression", "property_damage", "injury", "other"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })} className="border border-input px-2 py-2 text-xs bg-background">
            {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} placeholder="Short title" className="w-full border border-input px-3 py-2 text-sm bg-background" />
        <textarea value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} placeholder="What happened?" rows={3} className="w-full border border-input px-3 py-2 text-sm bg-background" />
        <button onClick={reportIncident} disabled={incidentBusy || incident.title.trim().length < 3 || !electionId} className="w-full bg-orange-600 text-white py-3 font-black text-sm uppercase tracking-wider disabled:opacity-50">
          {incidentBusy ? "Sending…" : "Send Report"}
        </button>
        {incidentMsg && <p className="text-xs font-bold text-muted-foreground">{incidentMsg}</p>}
      </div>
    </div>
  );
}
