import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIdentity } from "@/hooks/useIdentity";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Tile layout ────────────────────────────────────────────────────────────
// 10x8 tile grid approximating Kenya's geography. Keyed on IEBC county code
// (matches counties.code in the geography master data). Garissa sits between
// Isiolo and Wajir; Mombasa moved right of Kilifi to avoid overlap.
interface CountyTile {
  code: number;
  name: string;
  x: number;
  y: number;
  w?: number;
}

const COUNTY_TILES: CountyTile[] = [
  // Row 0 — northern frontier
  { code: 23, name: "Turkana", x: 0, y: 0, w: 2 },
  { code: 10, name: "Marsabit", x: 4, y: 0, w: 2 },
  { code: 9, name: "Mandera", x: 7, y: 0, w: 2 },
  // Row 1
  { code: 24, name: "West Pokot", x: 1, y: 1 },
  { code: 25, name: "Samburu", x: 3, y: 1 },
  { code: 11, name: "Isiolo", x: 5, y: 1 },
  { code: 7, name: "Garissa", x: 6, y: 1 },
  { code: 8, name: "Wajir", x: 7, y: 1, w: 2 },
  // Row 2
  { code: 26, name: "Trans Nzoia", x: 1, y: 2 },
  { code: 27, name: "Uasin Gishu", x: 2, y: 2 },
  { code: 28, name: "Elgeyo-Marakwet", x: 3, y: 2 },
  { code: 30, name: "Baringo", x: 4, y: 2 },
  { code: 31, name: "Laikipia", x: 5, y: 2 },
  { code: 12, name: "Meru", x: 6, y: 2 },
  { code: 13, name: "Tharaka-Nithi", x: 7, y: 2 },
  { code: 14, name: "Embu", x: 8, y: 2 },
  { code: 15, name: "Kitui", x: 9, y: 2 },
  // Row 3
  { code: 39, name: "Bungoma", x: 0, y: 3 },
  { code: 37, name: "Kakamega", x: 1, y: 3 },
  { code: 38, name: "Vihiga", x: 2, y: 3 },
  { code: 29, name: "Nandi", x: 3, y: 3 },
  { code: 32, name: "Kericho", x: 4, y: 3 },
  { code: 36, name: "Bomet", x: 5, y: 3 },
  { code: 33, name: "Narok", x: 6, y: 3, w: 2 },
  { code: 34, name: "Kajiado", x: 8, y: 3 },
  { code: 16, name: "Machakos", x: 9, y: 3 },
  // Row 4
  { code: 40, name: "Busia", x: 0, y: 4 },
  { code: 42, name: "Kisumu", x: 1, y: 4 },
  { code: 41, name: "Siaya", x: 2, y: 4 },
  { code: 45, name: "Kisii", x: 3, y: 4 },
  { code: 46, name: "Nyamira", x: 4, y: 4 },
  { code: 35, name: "Nakuru", x: 5, y: 4, w: 2 },
  { code: 22, name: "Kiambu", x: 7, y: 4 },
  { code: 21, name: "Murang'a", x: 8, y: 4 },
  { code: 19, name: "Nyeri", x: 9, y: 4 },
  // Row 5
  { code: 43, name: "Homa Bay", x: 0, y: 5 },
  { code: 44, name: "Migori", x: 1, y: 5 },
  { code: 18, name: "Nyandarua", x: 5, y: 5 },
  { code: 4, name: "Tana River", x: 6, y: 5 },
  { code: 5, name: "Lamu", x: 7, y: 5 },
  { code: 20, name: "Kirinyaga", x: 8, y: 5 },
  { code: 17, name: "Makueni", x: 9, y: 5 },
  // Row 6 — coast
  { code: 6, name: "Taita-Taveta", x: 5, y: 6 },
  { code: 2, name: "Kwale", x: 6, y: 6 },
  { code: 3, name: "Kilifi", x: 7, y: 6, w: 2 },
  { code: 1, name: "Mombasa", x: 9, y: 6 },
  // Row 7 — Nairobi
  { code: 47, name: "Nairobi", x: 7, y: 7, w: 2 },
];

// ─── API shapes (defensive — tally endpoints vary by permission/data) ───────
interface CountyRow {
  id: string;
  name: string;
  code: number | string;
  registeredVoters?: number | null;
}

interface ElectionRow {
  id: string;
  name: string;
  isActive?: boolean;
  status?: string;
}

interface CountyBreakdown {
  entityId: string;
  candidateResults?: { candidateId?: string | null; candidateName: string; votes: number }[];
  ourCandidateVotes?: number;
  leadingCandidate?: string;
}

interface TallyNational {
  candidates?: { candidateName: string; partyAbbreviation?: string | null; votes: number }[];
  breakdown?: CountyBreakdown[];
}

const CELL = 100;
const GAP = 6;

async function fetchJson(path: string) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export default function KenyaMap() {
  // Tenant identity: keys and gating both ride on it. A user can switch
  // campaigns in-app without a Clerk user change, so the tenant id must be in
  // every query key or a previous campaign's map data could render here.
  const { activeTenant, isLoaded: identityLoaded, isSignedIn } = useIdentity();
  const tenantId = activeTenant?.id ?? null;
  const ready = identityLoaded && isSignedIn && !!tenantId;

  const [hover, setHover] = useState<{ code: number; px: number; py: number } | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<CountyRow | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPos = useRef<{ px: number; py: number } | null>(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  // A campaign switch changes tenantId: drop transient UI state so no trace
  // of the previous campaign (open drill-down, hover tooltip) survives.
  useEffect(() => {
    setSelectedCounty(null);
    setHover(null);
  }, [tenantId]);

  // Geography (already filtered to the campaign's scope by the API)
  const countiesQuery = useQuery<CountyRow[]>({
    queryKey: ["kenya-map-counties", tenantId],
    queryFn: () => fetchJson("/api/geography/counties"),
    enabled: ready,
    retry: 1,
  });
  const counties = countiesQuery.data;

  // Active election (endpoint returns the tenant's elections, newest first)
  const { data: elections } = useQuery<ElectionRow[]>({
    queryKey: ["kenya-map-elections", tenantId],
    queryFn: () => fetchJson("/api/election-admin/elections/active"),
    enabled: ready,
    retry: 1,
  });
  const election = useMemo(() => {
    if (!Array.isArray(elections) || elections.length === 0) return null;
    return elections.find((e) => e.isActive) ?? elections[0];
  }, [elections]);

  // National tally — per-county breakdown of verified results. A 403 means
  // the viewer lacks results permission: render geography only, quietly.
  // Any other failure is surfaced as "temporarily unavailable".
  const tallyQuery = useQuery<TallyNational>({
    queryKey: ["kenya-map-tally", tenantId, election?.id],
    queryFn: () => fetchJson(`/api/tally/national/${election!.id}`),
    enabled: ready && !!election,
    retry: false,
  });
  const tally = tallyQuery.data;
  const tallyUnavailable = tallyQuery.isError && tallyQuery.error?.message !== "403";

  // Drill-down for the clicked county. Data only renders for the query keyed
  // to the CURRENT tenant + selection; a failure is not "no results".
  const countyTallyQuery = useQuery<any>({
    queryKey: ["kenya-map-county-tally", tenantId, election?.id, selectedCounty?.id],
    queryFn: () => fetchJson(`/api/tally/county/${election!.id}/${selectedCounty!.id}`),
    enabled: ready && !!election && !!selectedCounty,
    retry: false,
  });
  const countyTally = countyTallyQuery.data;
  const loadingCountyTally = countyTallyQuery.isLoading;
  const countyTallyFailed = countyTallyQuery.isError;

  const countyByCode = useMemo(() => {
    const m = new Map<number, CountyRow>();
    for (const c of counties ?? []) m.set(Number(c.code), c);
    return m;
  }, [counties]);

  const tallyByCountyId = useMemo(() => {
    const m = new Map<string, CountyBreakdown>();
    for (const b of tally?.breakdown ?? []) m.set(b.entityId, b);
    return m;
  }, [tally]);

  const maxLeadingVotes = useMemo(
    () => Math.max(0, ...(tally?.breakdown ?? []).map((b) => b.ourCandidateVotes ?? 0)),
    [tally],
  );

  const intensityFor = (b: CountyBreakdown | undefined) => {
    const v = b?.ourCandidateVotes ?? 0;
    if (!v || !maxLeadingVotes) return 0;
    // sqrt spreads the scale so small counties stay visible next to Nairobi
    return 0.25 + 0.7 * Math.sqrt(v / maxLeadingVotes);
  };

  // Tooltip position updates ride on rAF so a fast mouse doesn't force a
  // React render per mousemove; tile identity still updates on enter.
  const schedulePos = (px: number, py: number) => {
    pendingPos.current = { px, py };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingPos.current;
        if (p) setHover((h) => (h ? { ...h, px: p.px, py: p.py } : h));
      });
    }
  };

  const focusTile = (tile: CountyTile) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const scale = rect ? rect.width / (10 * CELL) : 1;
    setHover({
      code: tile.code,
      px: (tile.x * CELL + ((tile.w ?? 1) * CELL) / 2) * scale,
      py: (tile.y * CELL + CELL / 2) * scale,
    });
  };

  if (!ready || countiesQuery.isLoading) {
    return <div className="flex-1 min-h-[320px] bg-muted/40 rounded-md animate-pulse" />;
  }

  if (countiesQuery.isError) {
    return (
      <div className="flex-1 min-h-[320px] flex items-center justify-center border border-dashed border-border rounded-md">
        <p className="text-sm text-muted-foreground">
          County data could not be loaded. Refresh the page to try again.
        </p>
      </div>
    );
  }

  const hoveredTile = hover ? COUNTY_TILES.find((t) => t.code === hover.code) : null;
  const hoveredCounty = hoveredTile ? countyByCode.get(hoveredTile.code) : undefined;
  const hoveredTally = hoveredCounty ? tallyByCountyId.get(hoveredCounty.id) : undefined;

  return (
    <div ref={containerRef} className="relative flex-1 min-h-[320px]">
      <svg
        viewBox={`0 0 ${10 * CELL} ${8 * CELL}`}
        className="w-full h-auto select-none"
        role="group"
        aria-label="Map of Kenya's 47 counties coloured by leading candidate votes"
        onMouseLeave={() => setHover(null)}
      >
        {COUNTY_TILES.map((tile) => {
          const county = countyByCode.get(tile.code);
          const inScope = !!county;
          const breakdown = county ? tallyByCountyId.get(county.id) : undefined;
          const intensity = intensityFor(breakdown);
          const clickable = inScope && !!election;
          const highlighted = hover?.code === tile.code;

          return (
            <g
              key={tile.code}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? "button" : undefined}
              aria-label={clickable ? `${tile.name} county — view results` : undefined}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const px = e.clientX - rect.left;
                const py = e.clientY - rect.top;
                setHover((h) => (h?.code === tile.code ? h : { code: tile.code, px, py }));
                schedulePos(px, py);
              }}
              onClick={() => {
                if (clickable && county) setSelectedCounty(county);
              }}
              onKeyDown={(e) => {
                if (clickable && county && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setSelectedCounty(county);
                }
              }}
              onFocus={() => focusTile(tile)}
              onBlur={() => setHover(null)}
              style={{ cursor: clickable ? "pointer" : "default", outline: "none" }}
            >
              <rect
                x={tile.x * CELL + GAP / 2}
                y={tile.y * CELL + GAP / 2}
                width={(tile.w ?? 1) * CELL - GAP}
                height={CELL - GAP}
                rx={10}
                fill={intensity > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))"}
                fillOpacity={intensity > 0 ? intensity : inScope ? 0.5 : 0.25}
                stroke={highlighted ? "hsl(var(--foreground))" : "hsl(var(--border))"}
                strokeWidth={highlighted ? 3 : 1}
                strokeDasharray={inScope ? undefined : "4 3"}
              />
              <text
                x={tile.x * CELL + ((tile.w ?? 1) * CELL) / 2}
                y={tile.y * CELL + CELL / 2 - (tile.w ? 8 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={(tile.w ?? 1) > 1 ? 15 : 20}
                fontWeight={700}
                fill={intensity > 0.6 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}
                fillOpacity={inScope ? 1 : 0.45}
                pointerEvents="none"
              >
                {String(tile.code).padStart(2, "0")}
              </text>
              {(tile.w ?? 1) > 1 && (
                <text
                  x={tile.x * CELL + ((tile.w ?? 1) * CELL) / 2}
                  y={tile.y * CELL + CELL / 2 + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill={intensity > 0.6 ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))"}
                  fillOpacity={inScope ? 0.9 : 0.4}
                  pointerEvents="none"
                >
                  {tile.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover / focus tooltip */}
      {hover && hoveredTile && (
        <div
          className="absolute z-20 pointer-events-none bg-popover text-popover-foreground border border-border rounded-md shadow-lg px-3 py-2 text-sm max-w-[240px]"
          style={{
            left: hover.px + 14,
            top: Math.max(hover.py - 10, 0),
            transform: hover.px > (containerRef.current?.clientWidth ?? 600) * 0.6 ? "translateX(-110%)" : undefined,
          }}
        >
          <p className="font-bold">
            {hoveredTile.name}
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {String(hoveredTile.code).padStart(2, "0")}
            </span>
          </p>
          {!hoveredCounty ? (
            <p className="text-muted-foreground text-xs mt-1">Outside your campaign's scope</p>
          ) : hoveredTally ? (
            <div className="mt-1 space-y-0.5 text-xs">
              <p>
                Leading: <span className="font-semibold">{hoveredTally.leadingCandidate ?? "—"}</span>
              </p>
              <p className="font-mono">{(hoveredTally.ourCandidateVotes ?? 0).toLocaleString()} votes</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs mt-1">
              {tallyUnavailable
                ? "Results temporarily unavailable"
                : election
                  ? "No verified results yet"
                  : "No election configured"}
            </p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          Leading candidate votes
          <span className="inline-flex h-3 w-24 rounded-sm overflow-hidden border border-border">
            {[0.25, 0.45, 0.65, 0.85, 0.95].map((o) => (
              <span key={o} className="flex-1" style={{ background: "hsl(var(--primary))", opacity: o }} />
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: "hsl(var(--muted))", opacity: 0.5 }} />
          No verified results
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-border"
            style={{ background: "hsl(var(--muted))", opacity: 0.25, borderStyle: "dashed" }}
          />
          Outside scope
        </span>
        {tallyUnavailable && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Live results temporarily unavailable — showing geography only
          </span>
        )}
      </div>

      {/* County drill-down */}
      <Dialog open={!!selectedCounty} onOpenChange={(open) => !open && setSelectedCounty(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedCounty?.name} County</DialogTitle>
          </DialogHeader>
          {loadingCountyTally ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : countyTallyFailed ? (
            <p className="text-sm text-muted-foreground py-4">
              Results for {selectedCounty?.name} are temporarily unavailable. Close and try again.
            </p>
          ) : !countyTally || !Array.isArray(countyTally.candidates) || countyTally.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No verified results reported in {selectedCounty?.name} yet.
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold mb-2">Candidate totals</h4>
                <div className="space-y-1.5">
                  {(countyTally.candidates as any[]).map((c, i) => {
                    const max = Math.max(1, ...(countyTally.candidates as any[]).map((x) => Number(x.votes ?? x.totalVotes ?? 0)));
                    const votes = Number(c.votes ?? c.totalVotes ?? 0);
                    return (
                      <div key={i} className="text-sm">
                        <div className="flex justify-between mb-0.5">
                          <span className="font-medium">
                            {c.candidateName}
                            {c.partyAbbreviation && (
                              <span className="ml-1.5 text-xs text-muted-foreground">({c.partyAbbreviation})</span>
                            )}
                          </span>
                          <span className="font-mono">{votes.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(votes / max) * 100}%`, background: "hsl(var(--primary))" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {Array.isArray(countyTally.subUnits) && countyTally.subUnits.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">By constituency</h4>
                  <div className="max-h-56 overflow-y-auto divide-y divide-border border border-border rounded-md">
                    {(countyTally.subUnits as any[]).map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{s.entityName ?? s.name ?? `Constituency ${i + 1}`}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.leadingCandidate && s.leadingCandidate !== "—"
                            ? `${s.leadingCandidate} · ${Number(s.ourCandidateVotes ?? 0).toLocaleString()}`
                            : "No results"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
