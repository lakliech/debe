/**
 * PlatformOps — Election-Day Operations Monitor
 *
 * Live cross-tenant view of submission rates, coverage gaps, and silent agents.
 * Auto-refreshes every 60 seconds. Global admins only.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Radio,
  RefreshCw,
  Users,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantOps {
  tenantId: string;
  name: string;
  slug: string;
  isSuspended: boolean;
  totalStations: number;
  assignedStations: number;
  submissionsReceived: number;
  coveragePct: number;
  lastSubmissionAt: string | null;
  activeAgents: number;
  submissionRate: Array<{ bucket: string; count: number }>;
}

interface OpsResponse {
  tenants: TenantOps[];
  updatedAt: string;
}

interface CountyBreakdownRow {
  countyId: string;
  countyName: string;
  totalStations: number;
  assignedStations: number;
  submissionsReceived: number;
}

interface SilentStation {
  stationId: string;
  stationName: string;
  stationCode: string;
  countyName: string;
  constituencyName: string;
  wardName: string;
  primaryAgentId: string | null;
  lastSeenAt: string | null;
  syncStatus: string | null;
  pendingSubmissions: number | null;
}

interface DrilldownResponse {
  countyBreakdown: CountyBreakdownRow[];
  silentStations: SilentStation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function coverageColour(pct: number) {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-600";
}

function coverageBg(pct: number) {
  if (pct >= 80) return "bg-green-50 border-green-200";
  if (pct >= 50) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAgo(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// Mini spark-bar showing 15-min submission rate buckets
function SparkBars({ data }: { data: Array<{ bucket: string; count: number }> }) {
  if (!data.length) return <span className="text-xs text-muted-foreground">no data</span>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-px h-6">
      {data.map((d, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <div
              className="w-1.5 rounded-sm bg-primary/70 cursor-default"
              style={{ height: `${Math.max(2, Math.round((d.count / max) * 24))}px` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              {new Date(d.bucket).toLocaleTimeString("en-KE", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              — {d.count} submission{d.count !== 1 ? "s" : ""}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ── Drilldown panel ───────────────────────────────────────────────────────────

function TenantDrilldown({ tenant }: { tenant: TenantOps }) {
  const { data, isLoading, isError } = useQuery<DrilldownResponse>({
    queryKey: ["platform-ops-drilldown", tenant.tenantId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/platform/ops/${tenant.tenantId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`/api/platform/ops/${tenant.tenantId} ${r.status}`);
      const data = await r.json();
      return { countyBreakdown: data.countyBreakdown ?? [], silentStations: data.silentStations ?? [] } as DrilldownResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  if (isError || !data)
    return <p className="py-4 text-sm text-destructive">Failed to load drilldown.</p>;

  return (
    <div className="space-y-6">
      {/* County breakdown */}
      <div>
        <h3 className="font-semibold text-sm mb-2">County Coverage</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>County</TableHead>
              <TableHead className="text-right">Stations</TableHead>
              <TableHead className="text-right">Assigned</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.countyBreakdown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                  No stations registered for this campaign yet.
                </TableCell>
              </TableRow>
            ) : (
              data.countyBreakdown.map((row) => {
                const pct =
                  row.totalStations > 0
                    ? Math.round((row.submissionsReceived / row.totalStations) * 100)
                    : 0;
                return (
                  <TableRow key={row.countyId}>
                    <TableCell className="font-medium">{row.countyName}</TableCell>
                    <TableCell className="text-right">{row.totalStations}</TableCell>
                    <TableCell className="text-right">{row.assignedStations}</TableCell>
                    <TableCell className="text-right">{row.submissionsReceived}</TableCell>
                    <TableCell className={cn("text-right font-semibold", coverageColour(pct))}>
                      {pct}%
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Silent stations */}
      <div>
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
          <WifiOff className="h-4 w-4 text-destructive" />
          Silent Stations
          <span className="text-muted-foreground font-normal">
            — assigned agent, no submission, last seen &gt; 2 h ago
          </span>
          <Badge variant="destructive" className="ml-1">
            {data.silentStations.length}
          </Badge>
        </h3>
        {data.silentStations.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> All assigned agents have checked in recently.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead className="text-right">Pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.silentStations.map((s) => (
                <TableRow key={s.stationId} className="bg-red-50/40">
                  <TableCell>
                    <p className="font-medium text-sm">{s.stationName}</p>
                    <p className="text-xs text-muted-foreground">{s.stationCode}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.countyName} / {s.constituencyName} / {s.wardName}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.lastSeenAt ? (
                      <span className="text-destructive">{fmtAgo(s.lastSeenAt)}</span>
                    ) : (
                      <span className="text-muted-foreground italic">never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.syncStatus ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          s.syncStatus === "synced"
                            ? "border-green-400 text-green-700"
                            : s.syncStatus === "offline"
                              ? "border-red-400 text-red-700"
                              : "border-yellow-400 text-yellow-700",
                        )}
                      >
                        {s.syncStatus}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs font-medium">
                    {s.pendingSubmissions ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ── Tenant card ───────────────────────────────────────────────────────────────

function TenantCard({
  tenant,
  selected,
  onSelect,
}: {
  tenant: TenantOps;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-all hover:shadow-md",
        selected ? "ring-2 ring-primary border-primary" : coverageBg(tenant.coveragePct),
        tenant.isSuspended && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-sm leading-tight">{tenant.name}</p>
          <p className="text-xs text-muted-foreground">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-1">
          {tenant.isSuspended && (
            <Badge variant="destructive" className="text-xs">suspended</Badge>
          )}
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              selected && "rotate-90",
            )}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {/* Coverage */}
        <div>
          <p className="text-xs text-muted-foreground">Coverage</p>
          <p className={cn("text-xl font-bold", coverageColour(tenant.coveragePct))}>
            {tenant.coveragePct}%
          </p>
          <p className="text-xs text-muted-foreground">
            {tenant.submissionsReceived}/{tenant.totalStations} stations
          </p>
        </div>

        {/* Active agents */}
        <div>
          <p className="text-xs text-muted-foreground">Active agents</p>
          <p className="text-xl font-bold">{tenant.activeAgents}</p>
          <p className="text-xs text-muted-foreground">last 30 min</p>
        </div>

        {/* Last submission */}
        <div>
          <p className="text-xs text-muted-foreground">Last submission</p>
          <p className="text-sm font-medium">{fmtTime(tenant.lastSubmissionAt)}</p>
        </div>

        {/* Assigned */}
        <div>
          <p className="text-xs text-muted-foreground">Assigned</p>
          <p className="text-sm font-medium">
            {tenant.assignedStations}/{tenant.totalStations}
          </p>
        </div>
      </div>

      {/* Spark bars */}
      {tenant.submissionRate.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-1">Last 6 h (15-min buckets)</p>
          <SparkBars data={tenant.submissionRate} />
        </div>
      )}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PlatformOps() {
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<OpsResponse>({
      queryKey: ["platform-ops"],
      queryFn: async () => {
        const r = await fetch(`${BASE}/api/platform/ops`, { credentials: "include" });
        if (!r.ok) throw new Error(`/api/platform/ops ${r.status}`);
        const data = await r.json();
        return { tenants: data.tenants ?? [], updatedAt: data.updatedAt ?? new Date().toISOString() } as OpsResponse;
      },
      refetchInterval: 60_000,
      staleTime: 30_000,
    });

  const selected = data?.tenants.find((t) => t.tenantId === selectedTenant) ?? null;

  // Summary totals across all tenants
  const totals = data?.tenants.reduce(
    (acc, t) => ({
      stations: acc.stations + t.totalStations,
      submitted: acc.submitted + t.submissionsReceived,
      agents: acc.agents + t.activeAgents,
    }),
    { stations: 0, submitted: 0, agents: 0 },
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Radio className="h-6 w-6 text-primary" />
              Operations Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live election-day view across all campaigns
            </p>
          </div>
          <div className="flex items-center gap-3">
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground">
                Updated {fmtAgo(new Date(dataUpdatedAt).toISOString())}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Platform-wide summary tiles */}
        {totals && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Activity className="h-8 w-8 text-primary/70" />
                  <div>
                    <p className="text-2xl font-bold">{totals.submitted}</p>
                    <p className="text-xs text-muted-foreground">
                      of {totals.stations} stations submitted
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-primary/70" />
                  <div>
                    <p className="text-2xl font-bold">{totals.agents}</p>
                    <p className="text-xs text-muted-foreground">active agents (last 30 min)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Wifi className="h-8 w-8 text-primary/70" />
                  <div>
                    <p className="text-2xl font-bold">
                      {totals.stations > 0
                        ? `${Math.round((totals.submitted / totals.stations) * 100)}%`
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">platform-wide coverage</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading / error */}
        {isLoading && (
          <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading operations data…
          </div>
        )}
        {isError && (
          <Card className="border-destructive">
            <CardContent className="pt-5 text-sm text-destructive flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Failed to load operations data. Check your
              connection and try again.
            </CardContent>
          </Card>
        )}

        {/* Tenant grid + drilldown */}
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Tenant cards */}
            <div className="lg:col-span-1 space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Campaigns ({data.tenants.length})
              </h2>
              {data.tenants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No campaigns registered yet.</p>
              ) : (
                data.tenants.map((t) => (
                  <TenantCard
                    key={t.tenantId}
                    tenant={t}
                    selected={selectedTenant === t.tenantId}
                    onSelect={() =>
                      setSelectedTenant(selectedTenant === t.tenantId ? null : t.tenantId)
                    }
                  />
                ))
              )}
            </div>

            {/* Drilldown panel */}
            <div className="lg:col-span-2">
              {selected ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{selected.name} — Detailed View</span>
                      <div className="flex items-center gap-2">
                        {selected.coveragePct >= 80 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : selected.coveragePct >= 50 ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span className={cn("text-sm font-bold", coverageColour(selected.coveragePct))}>
                          {selected.coveragePct}% coverage
                        </span>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TenantDrilldown tenant={selected} />
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                  <Clock className="h-10 w-10 mb-3 opacity-30" />
                  <p className="font-medium">Select a campaign</p>
                  <p className="text-sm mt-1">Click a campaign card to see county breakdown and silent stations</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
  );
}
