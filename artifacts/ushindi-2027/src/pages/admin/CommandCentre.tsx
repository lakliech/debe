import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Monitor, AlertCircle, RefreshCw, Clock, Users, ClipboardList,
  CheckCircle2, AlertOctagon, Scale, Wifi, WifiOff, BarChart3
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LiveAgentMap from "@/components/LiveAgentMap";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-l-4 border-l-red-600",
  high: "bg-orange-50 text-orange-800 border-l-4 border-l-orange-500",
  medium: "bg-yellow-50 text-yellow-800 border-l-4 border-l-yellow-400",
  low: "bg-gray-50 text-gray-700 border-l-4 border-l-gray-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-700",
};

function KPICard({ label, value, icon: Icon, color, onClick }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-card border border-border p-4 shadow-sm ${onClick ? "cursor-pointer hover:border-[#1D9BF0] transition-colors" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <p className={`text-3xl font-black font-mono ${color}`}>{value}</p>
    </div>
  );
}

export default function CommandCentre() {
  const [, navigate] = useLocation();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Fetch active election first
  const { data: elections } = useQuery({
    queryKey: ["elections-for-cc"],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections`, { credentials: "include" }).then((r) => r.json()),
  });
  const electionArray: any[] = Array.isArray(elections) ? elections : [];
  const activeElection = electionArray.find((e: any) => e.isActive) ?? electionArray[0];
  const activeElectionId: string | undefined = activeElection?.id;

  // Command centre dashboard: all KPIs in one call
  const { data: dashboard, isLoading: kpisLoading, refetch: refetchKpis } = useQuery({
    queryKey: ["command-dashboard", tick, activeElectionId],
    queryFn: () => {
      if (!activeElectionId) return Promise.resolve(null);
      return fetch(`${BASE}/api/command-centre/dashboard/${activeElectionId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { setLastUpdated(new Date()); return d; });
    },
    enabled: !!activeElectionId,
  });

  const { data: tally, refetch: refetchTally } = useQuery({
    queryKey: ["command-tally", tick, activeElectionId],
    queryFn: () => {
      if (!activeElectionId) return Promise.resolve(null);
      return fetch(`${BASE}/api/tally/national/${activeElectionId}`, { credentials: "include" }).then((r) => r.json());
    },
    enabled: !!activeElectionId,
  });

  const { data: incidents, refetch: refetchIncidents } = useQuery({
    queryKey: ["command-incidents", tick],
    queryFn: () =>
      fetch(`${BASE}/api/election-incidents?status=open&limit=10`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: tasks, refetch: refetchTasks } = useQuery({
    queryKey: ["command-tasks", tick],
    queryFn: () =>
      fetch(`${BASE}/api/command-centre/tasks?status=open&limit=10`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: outstanding, refetch: refetchOutstanding } = useQuery({
    queryKey: ["command-outstanding", tick],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations?limit=10`, { credentials: "include" }).then((r) => r.json()),
  });

  const handleRefreshAll = () => {
    setTick((t) => t + 1);
    refetchKpis();
    refetchTally();
    refetchIncidents();
    refetchTasks();
    refetchOutstanding();
    setLastUpdated(new Date());
  };

  // Derive KPI values from dashboard response (structure: stationsSummary, incidentSummary, nationalTally, pendingTasks, agentSyncSummary)
  const kpis = {
    stationsOpened: dashboard?.stationsSummary?.verified ?? 0,
    stationsReporting: dashboard?.stationsSummary?.submitted ?? 0,
    stationsPending: dashboard?.stationsSummary?.draft ?? 0,
    agentsPresent: dashboard?.agentSyncSummary?.synced ?? 0,
    resultsReceived: dashboard?.stationsSummary?.submitted ?? 0,
    resultsVerified: dashboard?.stationsSummary?.verified ?? 0,
    criticalIncidents: dashboard?.incidentSummary?.critical ?? 0,
    highIncidents: dashboard?.incidentSummary?.high ?? 0,
    incidentsOpen: (dashboard?.incidentSummary?.critical ?? 0) + (dashboard?.incidentSummary?.high ?? 0) + (dashboard?.incidentSummary?.medium ?? 0),
    legalEscalations: dashboard?.incidentSummary?.legal_escalation ?? 0,
    openTasks: dashboard?.pendingTasks?.length ?? 0,
    syncBacklog: dashboard?.agentSyncSummary?.pending ?? 0,
  };

  const candidates: any[] = tally?.candidates ?? [];
  const totalVotes = candidates.reduce((sum: number, c: any) => sum + (c.votes ?? 0), 0);
  const top3 = [...candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)).slice(0, 3);

  const incidentList: any[] = incidents?.data ?? [];
  const taskList: any[] = tasks?.data ?? [];
  const outstandingList: any[] = outstanding?.data ?? [];

  const critical = incidentList.filter((i) => i.severity === "critical");
  const highSev = incidentList.filter((i) => i.severity === "high");

  return (
    <div className="space-y-6 pb-8">
      {/* Disclaimer Banner */}
      <div className="bg-[#1D9BF0] text-white rounded p-4 flex items-start gap-3">
        <AlertCircle className="h-6 w-6 shrink-0 mt-0.5" />
        <div>
          <p className="font-black uppercase tracking-wide text-sm mb-1">IMPORTANT DISCLAIMER</p>
          <p className="text-sm opacity-90">
            Campaign tally based on polling-station forms received and verified by the campaign.
            <strong> This is not an official declaration by the electoral commission.</strong>
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <Monitor className="h-6 w-6 text-[#1D9BF0]" /> ELECTION COMMAND CENTRE
          </h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last updated: {lastUpdated.toLocaleTimeString("en-KE")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            {autoRefresh ? (
              <><Wifi className="h-4 w-4 text-green-600" /><span className="text-green-700 font-bold">LIVE (30s)</span></>
            ) : (
              <><WifiOff className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">PAUSED</span></>
            )}
          </div>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "bg-[#1D9BF0] hover:bg-[#1a8fd1]" : ""}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto ON" : "Auto OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefreshAll}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh All
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPICard
            label="Stations Opened"
            value={kpis?.stationsOpened ?? 0}
            icon={CheckCircle2}
            color="text-green-600"
            onClick={() => navigate("/polling-stations")}
          />
          <KPICard
            label="Agents Present"
            value={kpis?.agentsPresent ?? 0}
            icon={Users}
            color="text-[#1D9BF0]"
            onClick={() => navigate("/polling-agents")}
          />
          <KPICard
            label="Results Received"
            value={kpis?.resultsReceived ?? 0}
            icon={ClipboardList}
            color="text-indigo-600"
            onClick={() => navigate("/election-results")}
          />
          <KPICard
            label="Results Verified"
            value={kpis?.resultsVerified ?? 0}
            icon={CheckCircle2}
            color="text-emerald-600"
            onClick={() => navigate("/election-results")}
          />
          <KPICard
            label="Incidents Open"
            value={kpis?.incidentsOpen ?? 0}
            icon={AlertOctagon}
            color={Number(kpis?.incidentsOpen) > 0 ? "text-red-600" : "text-muted-foreground"}
            onClick={() => navigate("/election-incidents")}
          />
          <KPICard
            label="Legal Escalations"
            value={kpis?.legalEscalations ?? 0}
            icon={Scale}
            color={Number(kpis?.legalEscalations) > 0 ? "text-purple-600" : "text-muted-foreground"}
            onClick={() => navigate("/election-disputes")}
          />
        </div>
      )}

      {/* Live Agent Tracking — geofence map, refreshes every 30s */}
      <LiveAgentMap />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tally Summary */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#1D9BF0]" /> Tally Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {top3.length === 0 ? (
                <p className="text-muted-foreground text-sm">No results yet.</p>
              ) : (
                top3.map((c, idx) => {
                  const pct = totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0;
                  return (
                    <div key={c.candidateId} className={`p-3 rounded border ${c.isOurCandidate ? "border-[#1D9BF0] bg-blue-50" : "border-border"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold">{idx + 1}. {c.candidateName}</span>
                        <span className="font-mono text-sm font-black">{pct}%</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">{c.partyAbbreviation} · {c.votes?.toLocaleString()} votes</p>
                      <Progress value={pct} className={`h-1.5 ${c.isOurCandidate ? "[&>div]:bg-[#1D9BF0]" : ""}`} />
                    </div>
                  );
                })
              )}
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => navigate("/tally")}>
                Full Tally Dashboard →
              </Button>

              {/* Sync Backlog */}
              {kpis?.syncBacklog != null && kpis.syncBacklog > 0 && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded flex items-center gap-2">
                  <WifiOff className="h-4 w-4 text-orange-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-orange-800">Sync Backlog</p>
                    <p className="text-xs text-orange-700">{kpis.syncBacklog} agents not synced</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Active Incidents */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-red-600" />
                  Active Incidents
                  {critical.length > 0 && (
                    <Badge className="bg-red-600 text-white text-xs animate-pulse">
                      {critical.length} CRITICAL
                    </Badge>
                  )}
                </span>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => navigate("/election-incidents")}>
                  View All →
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {incidentList.length === 0 ? (
                <div className="flex items-center gap-2 text-green-700 p-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">No open incidents</span>
                </div>
              ) : (
                incidentList.slice(0, 8).map((inc: any) => (
                  <div
                    key={inc.id}
                    className={`p-3 rounded cursor-pointer hover:opacity-80 transition-opacity ${SEVERITY_COLORS[inc.severity] ?? "bg-gray-50 border-l-4 border-l-gray-300"}`}
                    onClick={() => navigate("/election-incidents")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide">{inc.incidentType?.replace(/_/g, " ")}</p>
                        <p className="text-sm font-medium truncate">{inc.title}</p>
                        <p className="text-xs opacity-70">{inc.stationName ?? "—"} · {inc.severity?.toUpperCase()}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">{inc.status}</Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outstanding Stations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center justify-between">
              <span>Outstanding Stations</span>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => navigate("/polling-stations")}>View All →</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {outstandingList.length === 0 ? (
              <div className="flex items-center gap-2 text-green-700 p-4">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">All stations reporting</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {outstandingList.map((s: any) => (
                  <div
                    key={s.id}
                    className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/polling-stations/${s.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{s.code} · {s.constituencyName}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{s.primaryAgentName ?? "No agent"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task Board */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider">Open Tasks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {taskList.length === 0 ? (
              <div className="flex items-center gap-2 text-green-700 p-4">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">No open tasks</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {taskList.map((task: any) => (
                  <div key={task.id} className="px-4 py-3 flex items-start gap-3">
                    <Badge
                      className={`text-xs mt-0.5 shrink-0 ${PRIORITY_COLORS[task.priority] ?? "bg-gray-100 text-gray-700"}`}
                      variant="outline"
                    >
                      {task.priority?.toUpperCase()}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{task.assignedToName ?? "Unassigned"}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{task.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
