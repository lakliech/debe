/**
 * Live Agent Map — Command Centre widget.
 *
 * Plots every assigned agent's latest GPS heartbeat as a dot coloured by
 * geofence status (green = on station ≤200m, yellow = nearby ≤1km,
 * red = away/missing). Agents with no recent check-in are listed below the
 * map with a tap-to-call link so field officers can follow up immediately.
 * Polls /api/agent-tracking/live every 30s.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Phone } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type PresenceStatus = "on_station" | "nearby" | "away" | "missing" | "no_station_gps" | "unassigned";

interface LiveAgent {
  agentId: string;
  fullName: string;
  phoneNumber: string;
  stationName: string;
  stationCode: string;
  stationLat: number | null;
  stationLon: number | null;
  lastPingAt: string | null;
  lat: number | null;
  lon: number | null;
  distanceM: number | null;
  minutesSincePing: number | null;
  status: PresenceStatus;
}

const STATUS_STYLE: Record<PresenceStatus, { color: string; label: string }> = {
  on_station: { color: "#16a34a", label: "On station" },
  nearby: { color: "#eab308", label: "Nearby" },
  away: { color: "#dc2626", label: "Away" },
  missing: { color: "#991b1b", label: "Missing" },
  no_station_gps: { color: "#6b7280", label: "No station GPS" },
  unassigned: { color: "#6b7280", label: "Unassigned" },
};

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lon]) => L.latLng(lat, lon)));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
  }, [map, points]);
  return null;
}

export default function LiveAgentMap() {
  const { data, isLoading } = useQuery<LiveAgent[]>({
    queryKey: ["agent-tracking-live"],
    queryFn: () =>
      fetch(`${BASE}/api/agent-tracking/live`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const agents = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { on_station: 0, nearby: 0, away: 0, missing: 0, no_station_gps: 0 };
    for (const a of agents) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [agents]);

  const mappable = agents.filter((a) => a.lat != null && a.lon != null);
  // Agents with no ping still appear — at their assigned station, hollow dashed.
  const stationOnly = agents.filter(
    (a) => a.lat == null && a.stationLat != null && a.stationLon != null,
  );
  const missing = agents.filter((a) => a.status === "missing" || a.status === "away");

  const points: [number, number][] = useMemo(() => {
    const pts: [number, number][] = mappable.map((a) => [a.lat!, a.lon!]);
    for (const a of agents) {
      if (a.stationLat != null && a.stationLon != null) pts.push([a.stationLat, a.stationLon]);
    }
    return pts;
  }, [agents, mappable]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Live Agent Tracking
        </CardTitle>
        <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-semibold">
          <span className="flex items-center gap-1"><Dot c="#16a34a" /> {counts.on_station} on station</span>
          <span className="flex items-center gap-1"><Dot c="#eab308" /> {counts.nearby} nearby</span>
          <span className="flex items-center gap-1"><Dot c="#dc2626" /> {(counts.away ?? 0) + (counts.missing ?? 0)} away/missing</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-[320px] rounded-md overflow-hidden border">
          <MapContainer center={[-0.5, 37.0]} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={points} />
            {mappable.map((a) => (
              <CircleMarker
                key={a.agentId}
                center={[a.lat!, a.lon!]}
                radius={8}
                pathOptions={{
                  color: STATUS_STYLE[a.status].color,
                  fillColor: STATUS_STYLE[a.status].color,
                  fillOpacity: 0.85,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1">
                    <p className="font-bold">{a.fullName}</p>
                    <p>{a.stationName} ({a.stationCode})</p>
                    <p>
                      {STATUS_STYLE[a.status].label}
                      {a.distanceM != null && ` — ${a.distanceM}m from station`}
                    </p>
                    <p>Last check-in: {a.minutesSincePing != null ? `${a.minutesSincePing} min ago` : "—"}</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            {stationOnly.map((a) => (
              <CircleMarker
                key={`st-${a.agentId}`}
                center={[a.stationLat!, a.stationLon!]}
                radius={8}
                pathOptions={{
                  color: STATUS_STYLE[a.status].color,
                  fillColor: STATUS_STYLE[a.status].color,
                  fillOpacity: 0.2,
                  weight: 2,
                  dashArray: "4 3",
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1">
                    <p className="font-bold">{a.fullName}</p>
                    <p>{a.stationName} ({a.stationCode})</p>
                    <p>{STATUS_STYLE[a.status].label} — no check-in yet, shown at assigned station</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground">Loading agent positions…</p>}
        {!isLoading && agents.length === 0 && (
          <p className="text-xs text-muted-foreground">No agents with station assignments yet.</p>
        )}

        {missing.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-red-700">Needs follow-up</p>
            {missing.map((a) => (
              <div key={a.agentId} className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{a.fullName} <span className="font-normal text-muted-foreground">· {a.stationName}</span></p>
                  <p className="text-[11px] text-red-700">
                    {a.status === "missing"
                      ? `No check-in ${a.minutesSincePing != null ? `for ${a.minutesSincePing} min` : "ever"}`
                      : `${a.distanceM}m away from station`}
                  </p>
                </div>
                <a href={`tel:${a.phoneNumber}`} className="ml-2 shrink-0 rounded-md bg-red-600 p-2 text-white hover:bg-red-700" aria-label={`Call ${a.fullName}`}>
                  <Phone className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} />;
}
