import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, MapPin, Truck, ShieldAlert, Users, Radio, Siren } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { OpsOverview } from "@/components/command/OpsOverview";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/logistics${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Request failed (${r.status})`);
  return r.json();
}

function useElectionId() {
  const { data } = useQuery({
    queryKey: ["elections-logistics"],
    queryFn: () => fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  return (data as any[] | undefined)?.find((e: any) => e.isActive)?.id ?? (data as any[])?.[0]?.id ?? "";
}

// ─── Kenya scatter map (dependency-free) ────────────────────────────────────
// Kenya bounding box: lat -4.7..5.1, lon 33.9..41.9
const KENYA = { minLat: -4.7, maxLat: 5.1, minLon: 33.9, maxLon: 41.9 };
function project(lat: number, lon: number, w: number, h: number) {
  const x = ((lon - KENYA.minLon) / (KENYA.maxLon - KENYA.minLon)) * w;
  const y = h - ((lat - KENYA.minLat) / (KENYA.maxLat - KENYA.minLat)) * h;
  return { x, y };
}

type MapDot = { id: string; lat: number; lon: number; color: string; label: string; sub: string };

function LiveMap({ dots, selected, onSelect }: { dots: MapDot[]; selected: MapDot | null; onSelect: (d: MapDot) => void }) {
  const W = 800, H = 620;
  return (
    <div className="border border-border bg-[#0b1622] relative overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        <rect width={W} height={H} fill="#0b1622" />
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={(W / 9) * (i + 1)} y1={0} x2={(W / 9) * (i + 1)} y2={H} stroke="#1c2c3d" strokeWidth="0.5" />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(H / 7) * (i + 1)} x2={W} y2={(H / 7) * (i + 1)} stroke="#1c2c3d" strokeWidth="0.5" />
        ))}
        {dots.map((d) => {
          const { x, y } = project(d.lat, d.lon, W, H);
          const isSel = selected?.id === d.id;
          return (
            <g key={d.id} onClick={() => onSelect(d)} className="cursor-pointer">
              {d.color === "#ef4444" && <circle cx={x} cy={y} r={14} fill="#ef4444" opacity={0.25}><animate attributeName="r" values="10;20;10" dur="1.5s" repeatCount="indefinite" /></circle>}
              <circle cx={x} cy={y} r={isSel ? 8 : 5} fill={d.color} stroke={isSel ? "#fff" : "none"} strokeWidth={2} opacity={0.9} />
            </g>
          );
        })}
      </svg>
      {selected && (
        <div className="absolute bottom-3 left-3 bg-card border border-border p-3 text-xs shadow-lg max-w-[260px]">
          <p className="font-black text-sm">{selected.label}</p>
          <p className="text-muted-foreground mt-0.5">{selected.sub}</p>
        </div>
      )}
      <div className="absolute top-3 right-3 bg-card/90 border border-border px-3 py-2 text-[10px] space-y-1 font-bold">
        <p><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />Checked in</p>
        <p><span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1.5" />Outside geofence</p>
        <p><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />Panic</p>
        <p><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1.5" />Vehicle</p>
      </div>
    </div>
  );
}

// ─── Alerts feed (SSE) ──────────────────────────────────────────────────────

type AlertEvent = { kind: string; at: string; severity?: string; agentName?: string; title?: string; type?: string; geofence?: boolean };

function playPanicSound() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = "square";
      gain.gain.setValueAtTime(0.12, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* audio unavailable */ }
}

function alertText(e: AlertEvent): string {
  if (e.kind === "panic") return `🚨 PANIC — ${e.agentName ?? "agent"}`;
  if (e.kind === "incident") return `${e.severity === "critical" ? "🔴" : "🟠"} Incident: ${e.title}`;
  if (e.kind === "transport_delayed") return `🚌 Transport delayed`;
  return `${e.geofence === false ? "⚠️" : "✅"} ${e.agentName ?? "Agent"} checked in (${String(e.type ?? "").replace(/_/g, " ")})`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

const TABS = ["Operations", "Agents", "Transport", "Security"] as const;

export default function LogisticsCommandCenter() {
  const electionId = useElectionId();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Operations");
  const [selectedDot, setSelectedDot] = useState<MapDot | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  const q = (key: string, path: string, refetchMs = 10_000) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["logistics", key, electionId],
      queryFn: () => api(path),
      enabled: !!electionId,
      refetchInterval: refetchMs,
    });

  const overview = q("overview", `/command-center/overview?electionId=${electionId}`);
  const liveMap = q("live-map", `/command-center/live-map?electionId=${electionId}`);
  const checkIns = q("check-ins", `/check-ins?electionId=${electionId}`, 15_000);
  const missing = q("missing", `/check-ins/missing?electionId=${electionId}`, 30_000);
  const transport = q("transport", `/transport-assignments?electionId=${electionId}`, 15_000);
  const vehicles = q("vehicles", `/vehicles`, 15_000);
  const incidents = q("incidents", `/security-incidents?electionId=${electionId}`, 15_000);
  const panics = q("panics", `/panic?electionId=${electionId}`, 10_000);

  // SSE alerts feed
  useEffect(() => {
    if (!electionId) return;
    const es = new EventSource(`${BASE}/api/logistics/command-center/alerts-feed?electionId=${electionId}`, { withCredentials: true });
    es.addEventListener("alert", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as AlertEvent;
        if (data.kind === "panic") playPanicSound();
        setAlerts((prev) => [data, ...prev].slice(0, 100));
      } catch { /* ignore malformed frames */ }
    });
    return () => es.close();
  }, [electionId]);

  const dots: MapDot[] = useMemo(() => {
    const d: MapDot[] = [];
    const panicAgents = new Set(((panics.data as any[]) ?? []).filter((p) => p.status === "active").map((p) => p.agentId));
    for (const a of (liveMap.data as any)?.agents ?? []) {
      if (a.gpsLat == null) continue;
      d.push({
        id: `a-${a.agentId}`,
        lat: a.gpsLat, lon: a.gpsLon,
        color: panicAgents.has(a.agentId) ? "#ef4444" : a.isWithinGeofence === false ? "#fb923c" : "#22c55e",
        label: a.agentName ?? "Agent",
        sub: `${a.stationName ?? "—"} · ${String(a.checkInType ?? "").replace(/_/g, " ")} · ${new Date(a.at).toLocaleTimeString()}`,
      });
    }
    for (const v of (liveMap.data as any)?.vehicles ?? []) {
      if (v.gpsLat == null) continue;
      d.push({ id: `v-${v.id}`, lat: v.gpsLat, lon: v.gpsLon, color: "#60a5fa", label: `Vehicle ${v.registrationNumber}`, sub: `Status: ${v.status}` });
    }
    return d;
  }, [liveMap.data, panics.data]);

  const o = overview.data as any;
  const stats = [
    { label: "Total Agents", value: o?.totalAgents, icon: Users, cls: "text-foreground" },
    { label: "Checked In", value: o ? `${o.checkedInPct}%` : null, icon: Radio, cls: "text-green-600" },
    { label: "Missing", value: o?.missingAgents, icon: AlertTriangle, cls: "text-yellow-600" },
    { label: "Vehicles En Route", value: o?.vehiclesEnRoute, icon: Truck, cls: "text-blue-600" },
    { label: "Active Incidents", value: o?.activeIncidents, icon: ShieldAlert, cls: "text-orange-600" },
    { label: "Panic Alerts", value: o?.activePanicAlerts, icon: Siren, cls: "text-red-600" },
  ];

  const act = (path: string, body?: any) => api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight uppercase">Election Day Command Center</h1>
        <p className="text-muted-foreground text-sm mt-1">Live logistics, agent check-ins, and security posture. Auto-refreshes every 10s.</p>
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <s.icon className={cn("h-3.5 w-3.5", s.cls)} />
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{s.label}</p>
            </div>
            {s.value == null ? <Skeleton className="h-7 w-14" /> : <p className={cn("text-2xl font-black font-mono", s.cls)}>{s.value}</p>}
          </div>
        ))}
      </div>

      {/* Map + alerts feed */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {liveMap.isLoading ? <Skeleton className="h-72 w-full" /> : <LiveMap dots={dots} selected={selectedDot} onSelect={setSelectedDot} />}
        </div>
        <div className="border border-border bg-card flex flex-col max-h-[520px]">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <Radio className="h-4 w-4 text-red-500 animate-pulse" />
            <h2 className="font-black text-xs uppercase tracking-wider">Live Alerts</h2>
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto divide-y divide-border">
            {alerts.length === 0 && <p className="p-4 text-xs text-muted-foreground">Listening for live events… alerts appear here as they happen.</p>}
            {alerts.map((a, i) => (
              <div key={`${a.at}-${i}`} className={cn("px-4 py-2.5 text-xs", a.kind === "panic" && "bg-red-50 animate-pulse")}>
                <p className={cn("font-bold", a.severity === "critical" ? "text-red-700" : a.severity === "high" ? "text-orange-700" : "text-foreground")}>{alertText(a)}</p>
                <p className="text-muted-foreground mt-0.5">{new Date(a.at).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 -mb-px", tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t}{t === "Security" && (o?.activePanicAlerts ?? 0) > 0 && <span className="ml-1.5 bg-red-600 text-white px-1.5 py-0.5 rounded-sm">{o.activePanicAlerts}</span>}
          </button>
        ))}
      </div>

      {tab === "Operations" && <OpsOverview />}
      {tab === "Agents" && (
        <AgentsTab checkIns={(checkIns.data as any[]) ?? []} missing={(missing.data as any[]) ?? []} loading={checkIns.isLoading} />
      )}
      {tab === "Transport" && (
        <TransportTab
          assignments={(transport.data as any[]) ?? []}
          vehicles={(vehicles.data as any[]) ?? []}
          onDepart={(id) => act(`/transport-assignments/${id}/depart`).then(() => transport.refetch())}
          onArrive={(id) => act(`/transport-assignments/${id}/arrive`).then(() => transport.refetch())}
          onVehicleCreated={() => vehicles.refetch()}
        />
      )}
      {tab === "Security" && (
        <div className="space-y-6">
          <section>
            <h2 className="font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
              <Siren className="h-4 w-4 text-red-600" />Panic Alerts
              {(o?.activePanicAlerts ?? 0) > 0 && <span className="bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-sm">{o.activePanicAlerts} active</span>}
            </h2>
            <PanicTab
              panics={(panics.data as any[]) ?? []}
              onAck={(id) => act(`/panic/${id}/acknowledge`).then(() => panics.refetch())}
              onResolve={(id) => act(`/panic/${id}/resolve`, {}).then(() => panics.refetch())}
            />
          </section>
          <section>
            <h2 className="font-black text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-600" />Security Incidents
            </h2>
            <SecurityTab
              incidents={(incidents.data as any[]) ?? []}
              onEscalate={(id) => act(`/security-incidents/${id}/escalate`).then(() => incidents.refetch())}
              onResolve={(id) => api(`/security-incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) }).then(() => incidents.refetch())}
            />
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function AgentsTab({ checkIns, missing, loading }: { checkIns: any[]; missing: any[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm">
          <p className="font-black text-yellow-800 uppercase text-xs tracking-wide">Missing check-ins ({missing.length})</p>
          <p className="text-yellow-700 text-xs mt-1">{missing.slice(0, 8).map((m) => m.fullName).join(", ")}{missing.length > 8 ? ` +${missing.length - 8} more` : ""}</p>
        </div>
      )}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>{["Agent", "Station", "Milestone", "Geofence", "Time"].map((c) => <th key={c} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{c}</th>)}</tr>
          </thead>
          <tbody>
            {checkIns.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No check-ins yet today.</td></tr>}
            {checkIns.map((c) => (
              <tr key={c.id} className="border-b border-border">
                <td className="px-4 py-2.5 font-bold">{c.agentName ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.stationName ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs font-bold">{String(c.checkInType).replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5">
                  {c.isWithinGeofence == null ? <span className="text-xs text-muted-foreground">n/a</span>
                    : c.isWithinGeofence ? <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5">IN</span>
                    : <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5">OUT{c.distanceFromStation != null ? ` (${Math.round(c.distanceFromStation)}m)` : ""}</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransportTab({ assignments, vehicles, onDepart, onArrive, onVehicleCreated }: {
  assignments: any[]; vehicles: any[];
  onDepart: (id: string) => void; onArrive: (id: string) => void; onVehicleCreated: () => void;
}) {
  const [reg, setReg] = useState("");
  const [vtype, setVtype] = useState("car");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addVehicle = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/vehicles`, { method: "POST", body: JSON.stringify({ registrationNumber: reg, vehicleType: vtype, capacity: capacity ? Number(capacity) : undefined }) });
      setReg(""); setCapacity("");
      onVehicleCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="border border-border p-4 bg-muted/20 flex flex-wrap items-end gap-3">
        <div><label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Registration</label>
          <input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="KDJ 123A" className="border border-input px-3 py-2 text-sm bg-background w-36" /></div>
        <div><label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Type</label>
          <select value={vtype} onChange={(e) => setVtype(e.target.value)} className="border border-input px-3 py-2 text-sm bg-background">
            {["car", "van", "bus", "motorbike", "truck"].map((v) => <option key={v} value={v}>{v}</option>)}
          </select></div>
        <div><label className="text-xs font-black uppercase tracking-wider text-muted-foreground block mb-1">Capacity</label>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" className="border border-input px-3 py-2 text-sm bg-background w-24" /></div>
        <button disabled={reg.trim().length < 2 || busy} onClick={addVehicle} className="bg-primary text-white px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50">Add Vehicle</button>
        {err && <span className="text-xs text-red-600 font-bold">{err}</span>}
      </div>

      <div className="border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>{["Vehicle", "Route", "Passengers", "Planned", "Actual", "Status", ""].map((c) => <th key={c} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{c}</th>)}</tr>
          </thead>
          <tbody>
            {assignments.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No transport assignments.</td></tr>}
            {assignments.map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="px-4 py-2.5 font-bold">{a.vehicleRegistration ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">{a.originDescription ?? "—"} → {a.destinationDescription ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs font-mono">{(a.passengerAgentIds ?? []).length}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.plannedDepartureAt ? new Date(a.plannedDepartureAt).toLocaleTimeString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.actualDepartureAt ? new Date(a.actualDepartureAt).toLocaleTimeString() : "—"}</td>
                <td className="px-4 py-2.5"><span className={cn("text-xs font-bold uppercase px-2 py-0.5", a.status === "delayed" ? "bg-red-100 text-red-700" : a.status === "en_route" ? "bg-blue-100 text-blue-700" : a.status === "arrived" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>{a.status}</span></td>
                <td className="px-4 py-2.5 text-right">
                  {a.status === "scheduled" && <button onClick={() => onDepart(a.id)} className="text-xs font-bold text-blue-600 hover:underline">Depart</button>}
                  {(a.status === "en_route" || a.status === "delayed") && <button onClick={() => onArrive(a.id)} className="text-xs font-bold text-green-700 hover:underline">Arrive</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-border overflow-x-auto">
        <div className="px-4 py-3 border-b border-border bg-muted/30"><h3 className="font-black text-xs uppercase tracking-wider">Fleet ({vehicles.length})</h3></div>
        <table className="w-full text-sm">
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-b border-border">
                <td className="px-4 py-2.5 font-bold">{v.registrationNumber}</td>
                <td className="px-4 py-2.5 text-xs">{v.make ?? ""} {v.model ?? ""} {v.vehicleType ? `· ${v.vehicleType}` : ""}</td>
                <td className="px-4 py-2.5 text-xs">{v.currentFuelLevel != null ? `⛽ ${v.currentFuelLevel}L` : "—"}</td>
                <td className="px-4 py-2.5"><span className={cn("text-xs font-bold uppercase px-2 py-0.5", v.status === "deployed" ? "bg-blue-100 text-blue-700" : v.status === "available" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>{v.status}</span></td>
              </tr>
            ))}
            {vehicles.length === 0 && <tr><td className="px-4 py-6 text-center text-muted-foreground text-sm">No vehicles registered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SecurityTab({ incidents, onEscalate, onResolve }: { incidents: any[]; onEscalate: (id: string) => void; onResolve: (id: string) => void }) {
  const [sevFilter, setSevFilter] = useState("");
  const list = sevFilter ? incidents.filter((i) => i.severity === sevFilter) : incidents;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {["", "critical", "high", "medium", "low"].map((s) => (
          <button key={s} onClick={() => setSevFilter(s)} className={cn("px-3 py-1.5 text-xs font-bold uppercase border", sevFilter === s ? "bg-primary text-white border-primary" : "border-border text-muted-foreground")}>{s || "All"}</button>
        ))}
      </div>
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border">
            <tr>{["Title", "Type", "Severity", "Escalation", "Status", ""].map((c) => <th key={c} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{c}</th>)}</tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No incidents.</td></tr>}
            {list.map((i) => (
              <tr key={i.id} className="border-b border-border">
                <td className="px-4 py-2.5 font-bold text-sm">{i.title}</td>
                <td className="px-4 py-2.5 text-xs">{String(i.incidentType).replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5"><span className={cn("text-xs font-bold uppercase px-2 py-0.5", i.severity === "critical" ? "bg-red-100 text-red-700" : i.severity === "high" ? "bg-orange-100 text-orange-700" : i.severity === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-muted text-muted-foreground")}>{i.severity}</span></td>
                <td className="px-4 py-2.5 text-xs font-mono">L{i.escalationLevel}</td>
                <td className="px-4 py-2.5 text-xs font-bold uppercase">{i.status}</td>
                <td className="px-4 py-2.5 text-right space-x-2">
                  {!["resolved", "false_alarm"].includes(i.status) && (
                    <>
                      <button onClick={() => onEscalate(i.id)} className="text-xs font-bold text-orange-600 hover:underline">Escalate</button>
                      <button onClick={() => onResolve(i.id)} className="text-xs font-bold text-green-700 hover:underline">Resolve</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanicTab({ panics, onAck, onResolve }: { panics: any[]; onAck: (id: string) => void; onResolve: (id: string) => void }) {
  return (
    <div className="border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b border-border">
          <tr>{["Agent", "Station", "Raised", "Acknowledged", "Status", ""].map((c) => <th key={c} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{c}</th>)}</tr>
        </thead>
        <tbody>
          {panics.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No panic alerts. 🎉</td></tr>}
          {panics.map((p) => (
            <tr key={p.id} className={cn("border-b border-border", p.status === "active" && "bg-red-50")}>
              <td className="px-4 py-2.5 font-bold">{p.agentName ?? "—"}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.stationName ?? "—"}</td>
              <td className="px-4 py-2.5 text-xs">{new Date(p.createdAt).toLocaleTimeString()}</td>
              <td className="px-4 py-2.5 text-xs">{p.acknowledgedAt ? new Date(p.acknowledgedAt).toLocaleTimeString() : "—"}</td>
              <td className="px-4 py-2.5"><span className={cn("text-xs font-black uppercase px-2 py-0.5", p.status === "active" ? "bg-red-600 text-white animate-pulse" : p.status === "acknowledged" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-700")}>{p.status}</span></td>
              <td className="px-4 py-2.5 text-right space-x-2">
                {p.status === "active" && <button onClick={() => onAck(p.id)} className="text-xs font-bold text-yellow-700 hover:underline">Acknowledge</button>}
                {(p.status === "active" || p.status === "acknowledged") && <button onClick={() => onResolve(p.id)} className="text-xs font-bold text-green-700 hover:underline">Resolve</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
