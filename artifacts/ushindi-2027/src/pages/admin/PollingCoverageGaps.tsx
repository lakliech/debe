/**
 * PollingCoverageGaps — Coordinator view showing which polling stations
 * across all counties still have no polling agent assigned.
 *
 * Data flows from GET /api/polling-stations-mgmt/coverage-gaps which
 * returns ward-level rows aggregated with a left-join on the tenant's
 * campaign_station_profiles.  The frontend groups rows into a
 * county → constituency → ward hierarchy.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, ChevronDown, ChevronRight, MapPin,
  CheckCircle2, XCircle, BarChart3, Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface WardRow {
  countyId: string;
  countyName: string;
  constituencyId: string;
  constituencyName: string;
  wardId: string;
  wardName: string;
  total: number;
  assigned: number;
  unassigned: number;
}

interface Summary {
  total: number;
  assigned: number;
  unassigned: number;
  coveragePct: number;
}

interface GapData {
  summary: Summary;
  rows: WardRow[];
  counties: { id: string; name: string }[];
}

// ── Helper components ─────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={cn("text-3xl font-black font-mono", color ?? "text-foreground")}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1 font-medium">{sub}</p>}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-2 rounded-full transition-all",
            pct === 0 ? "bg-red-500" : pct < 25 ? "bg-orange-400" : pct < 60 ? "bg-yellow-400" : "bg-green-500",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs font-bold text-muted-foreground w-9 text-right">{pct}%</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PollingCoverageGaps() {
  const [countyFilter, setCountyFilter]   = useState("all");
  const [constFilter, setConstFilter]     = useState("all");
  const [expandedCounties, setExpandedCounties] = useState<Set<string>>(new Set());
  const [expandedConsts, setExpandedConsts]     = useState<Set<string>>(new Set());
  // "county" | "constituency" | "ward"
  const [viewLevel, setViewLevel] = useState<"county" | "constituency" | "ward">("constituency");

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const params = new URLSearchParams();
  if (countyFilter !== "all") params.set("countyId", countyFilter);
  if (constFilter !== "all")  params.set("constituencyId", constFilter);

  const { data, isLoading } = useQuery<GapData>({
    queryKey: ["coverage-gaps", countyFilter, constFilter],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/coverage-gaps?${params}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  // Constituencies for cascade dropdown (derived from fetched rows when a county is chosen)
  const { data: constData } = useQuery({
    queryKey: ["geo-constituencies", countyFilter],
    queryFn: () =>
      fetch(`${BASE}/api/geography/constituencies?countyId=${countyFilter}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: countyFilter !== "all",
  });

  const summary   = data?.summary;
  const rows: WardRow[] = data?.rows ?? [];
  const counties  = data?.counties ?? [];
  // /api/geography/constituencies returns a bare array (not { data: [] })
  const consts: { id: string; name: string }[] = Array.isArray(constData) ? constData : (constData?.data ?? []);

  // ── Client-side grouping ────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    // county → constituency → ward
    const countyMap = new Map<string, {
      countyId: string;
      countyName: string;
      total: number;
      assigned: number;
      consts: Map<string, {
        constituencyId: string;
        constituencyName: string;
        total: number;
        assigned: number;
        wards: WardRow[];
      }>;
    }>();

    for (const row of rows) {
      if (!countyMap.has(row.countyId)) {
        countyMap.set(row.countyId, {
          countyId: row.countyId,
          countyName: row.countyName,
          total: 0, assigned: 0,
          consts: new Map(),
        });
      }
      const co = countyMap.get(row.countyId)!;
      co.total    += row.total;
      co.assigned += row.assigned;

      if (!co.consts.has(row.constituencyId)) {
        co.consts.set(row.constituencyId, {
          constituencyId: row.constituencyId,
          constituencyName: row.constituencyName,
          total: 0, assigned: 0,
          wards: [],
        });
      }
      const cs = co.consts.get(row.constituencyId)!;
      cs.total    += row.total;
      cs.assigned += row.assigned;
      cs.wards.push(row);
    }

    // Sort counties by unassigned descending
    return Array.from(countyMap.values())
      .sort((a, b) => (b.total - b.assigned) - (a.total - a.assigned))
      .map((co) => ({
        ...co,
        unassigned: co.total - co.assigned,
        consts: Array.from(co.consts.values())
          .sort((a, b) => (b.total - b.assigned) - (a.total - a.assigned))
          .map((cs) => ({
            ...cs,
            unassigned: cs.total - cs.assigned,
            wards: cs.wards.slice().sort((a, b) => b.unassigned - a.unassigned),
          })),
      }));
  }, [rows]);

  function toggleCounty(id: string) {
    setExpandedCounties((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleConst(id: string) {
    setExpandedConsts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setCountyFilter("all");
    setConstFilter("all");
  }

  const isFiltered = countyFilter !== "all" || constFilter !== "all";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase flex items-center gap-2">
          <MapPin className="h-6 w-6 text-primary" />
          Coverage Gaps
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Polling stations with no assigned agent — grouped by county and constituency.
          Biggest gaps are listed first.
        </p>
      </div>

      {/* Summary tiles */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryTile label="Total Stations"    value={summary.total}       color="text-foreground" />
          <SummaryTile label="Agents Assigned"   value={summary.assigned}    color="text-green-600"
            sub={`${summary.coveragePct}% coverage`} />
          <SummaryTile label="Still Unassigned"  value={summary.unassigned}  color="text-red-600"
            sub={`${100 - summary.coveragePct}% uncovered`} />
          <SummaryTile label="Campaign Coverage" value={`${summary.coveragePct}%`}
            color={summary.coveragePct >= 60 ? "text-green-600" : summary.coveragePct >= 25 ? "text-yellow-600" : "text-red-600"} />
        </div>
      ) : null}

      {/* Critical gap alert */}
      {!isLoading && summary && summary.unassigned > 0 && (
        <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-sm text-red-800 dark:text-red-300 uppercase tracking-wide">
              {summary.unassigned.toLocaleString()} stations have no agent
            </p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              Use the table below to find the constituencies with the largest gaps.
              Click a constituency name to view its unassigned stations.
            </p>
          </div>
        </div>
      )}

      {/* Filters + view level */}
      <div className="flex flex-wrap gap-3 items-center border border-border p-4 bg-muted/20 shadow-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">Filter:</span>
        </div>

        <select
          value={countyFilter}
          onChange={(e) => { setCountyFilter(e.target.value); setConstFilter("all"); }}
          className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary font-medium"
        >
          <option value="all">All Counties</option>
          {counties.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {countyFilter !== "all" && (
          <select
            value={constFilter}
            onChange={(e) => setConstFilter(e.target.value)}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary font-medium"
          >
            <option value="all">All Constituencies</option>
            {consts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {isFiltered && (
          <button
            onClick={resetFilters}
            className="px-3 py-2 text-xs font-bold border border-border hover:bg-muted transition-colors"
          >
            Clear Filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">Group by:</span>
          {(["county", "constituency", "ward"] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setViewLevel(lvl)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold border transition-colors capitalize",
                viewLevel === lvl
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Main table */}
      <div className="border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
          <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Agent Coverage by {viewLevel === "county" ? "County" : viewLevel === "constituency" ? "Constituency" : "Ward"}
            {!isLoading && <span className="text-muted-foreground font-medium">({grouped.length} counties)</span>}
          </h2>
          {isLoading && <Skeleton className="h-4 w-16" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                {["Location", "Total Stations", "Assigned", "Unassigned", "Coverage"].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {isLoading && (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {[1, 2, 3, 4, 5].map((j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              )}

              {!isLoading && grouped.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No data found. Try clearing the filters.
                  </td>
                </tr>
              )}

              {!isLoading && grouped.map((co) => {
                const coExpanded = expandedCounties.has(co.countyId);
                const coPct      = co.total > 0 ? Math.round((co.assigned / co.total) * 100) : 0;
                const coIsGap    = co.unassigned > 0;

                return (
                  <>
                    {/* County row */}
                    <tr
                      key={`co-${co.countyId}`}
                      className={cn(
                        "border-b border-border transition-colors",
                        viewLevel === "county"
                          ? coIsGap && co.assigned === 0
                            ? "bg-red-50/60 dark:bg-red-950/20"
                            : "hover:bg-muted/20"
                          : "bg-muted/40 cursor-pointer hover:bg-muted/60",
                      )}
                      onClick={viewLevel !== "county" ? () => toggleCounty(co.countyId) : undefined}
                    >
                      <td className="px-4 py-3 font-black text-sm">
                        <span className="flex items-center gap-2">
                          {viewLevel !== "county" && (
                            coExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          {co.countyName}
                          {co.unassigned === co.total && co.total > 0 && (
                            <span className="text-[10px] text-red-600 font-black bg-red-100 dark:bg-red-950/50 px-1.5 py-0.5">
                              0% COVERED
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">{co.total.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-green-700 font-bold">{co.assigned.toLocaleString()}</td>
                      <td className={cn("px-4 py-3 font-mono font-bold", co.unassigned > 0 ? "text-red-600" : "text-muted-foreground")}>
                        {co.unassigned.toLocaleString()}
                      </td>
                      <td className="px-4 py-3"><CoverageBar pct={coPct} /></td>
                    </tr>

                    {/* Constituency rows (expanded or viewLevel=constituency/ward) */}
                    {(viewLevel !== "county" && (coExpanded || countyFilter !== "all")) && co.consts.map((cs) => {
                      const csExpanded = expandedConsts.has(cs.constituencyId);
                      const csPct      = cs.total > 0 ? Math.round((cs.assigned / cs.total) * 100) : 0;
                      const csIsZero   = cs.assigned === 0 && cs.total > 0;

                      return (
                        <>
                          <tr
                            key={`cs-${cs.constituencyId}`}
                            className={cn(
                              "border-b border-border transition-colors",
                              csIsZero
                                ? "bg-red-50/40 dark:bg-red-950/10"
                                : "hover:bg-muted/20",
                              viewLevel === "ward" ? "cursor-pointer" : "",
                            )}
                            onClick={viewLevel === "ward" ? () => toggleConst(cs.constituencyId) : undefined}
                          >
                            <td className="px-4 py-2.5 pl-10 text-sm">
                              <span className="flex items-center gap-2">
                                {viewLevel === "ward" && (
                                  csExpanded
                                    ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                                    : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                )}
                                <Link
                                  href={`/polling-stations?constituencyId=${cs.constituencyId}${cs.unassigned > 0 ? "&unassigned=true" : ""}`}
                                  className="font-semibold hover:text-primary hover:underline transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {cs.constituencyName}
                                </Link>
                                {csIsZero && (
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                )}
                                {!csIsZero && cs.unassigned === 0 && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-sm font-medium">{cs.total.toLocaleString()}</td>
                            <td className="px-4 py-2.5 font-mono text-sm text-green-700 font-medium">{cs.assigned.toLocaleString()}</td>
                            <td className={cn("px-4 py-2.5 font-mono text-sm font-medium", cs.unassigned > 0 ? "text-red-500" : "text-muted-foreground")}>
                              {cs.unassigned.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5"><CoverageBar pct={csPct} /></td>
                          </tr>

                          {/* Ward rows */}
                          {viewLevel === "ward" && csExpanded && cs.wards.map((w) => {
                            const wPct    = w.total > 0 ? Math.round((w.assigned / w.total) * 100) : 0;
                            const wIsZero = w.assigned === 0 && w.total > 0;
                            return (
                              <tr
                                key={`w-${w.wardId}`}
                                className={cn(
                                  "border-b border-border transition-colors",
                                  wIsZero ? "bg-red-50/30 dark:bg-red-950/5" : "hover:bg-muted/10",
                                )}
                              >
                                <td className="px-4 py-2 pl-16 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1.5">
                                    <Link
                                      href={`/polling-stations?wardId=${w.wardId}${w.unassigned > 0 ? "&unassigned=true" : ""}`}
                                      className="hover:text-primary hover:underline transition-colors"
                                    >
                                      {w.wardName}
                                    </Link>
                                    {wIsZero && <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                                  </span>
                                </td>
                                <td className="px-4 py-2 font-mono text-xs">{w.total.toLocaleString()}</td>
                                <td className="px-4 py-2 font-mono text-xs text-green-700">{w.assigned.toLocaleString()}</td>
                                <td className={cn("px-4 py-2 font-mono text-xs", w.unassigned > 0 ? "text-red-500" : "text-muted-foreground")}>
                                  {w.unassigned.toLocaleString()}
                                </td>
                                <td className="px-4 py-2"><CoverageBar pct={wPct} /></td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer hint */}
        {!isLoading && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Click a constituency name to open its unassigned station list.
            Switch to <span className="font-bold">Ward</span> view for the finest granularity.
          </div>
        )}
      </div>
    </div>
  );
}
