/**
 * PVTDashboard — live Parallel Vote Tabulation projection dashboard.
 * Auto-refreshes every 30s during election night.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3, RefreshCw, AlertTriangle, TrendingUp, Users, Percent, Scale,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ErrorBar, ReferenceLine, Cell,
} from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PALETTE = ["#1D9BF0", "#F4212E", "#00BA7C", "#FFD400", "#7856FF", "#FF7A00"];

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function PVTDashboard() {
  const queryClient = useQueryClient();
  const [computing, setComputing] = useState(false);

  const { data: samples } = useQuery({
    queryKey: ["pvt-samples"],
    queryFn: () => api("/api/pvt/samples"),
  });
  const design = (samples as any[] | undefined)?.find((s) => s.status === "active")
    ?? (samples as any[] | undefined)?.[0];
  const designId: string | undefined = design?.id;

  const { data: projection, refetch } = useQuery({
    queryKey: ["pvt-projection", designId],
    queryFn: () => api(`/api/pvt/projections/latest?sampleDesignId=${designId}`),
    enabled: !!designId,
    refetchInterval: 30000,
  });

  const { data: alerts } = useQuery({
    queryKey: ["pvt-alerts", designId],
    queryFn: () => api(`/api/pvt/alerts?sampleDesignId=${designId}`),
    enabled: !!designId,
    refetchInterval: 30000,
  });

  const { data: strata } = useQuery({
    queryKey: ["pvt-strata", designId],
    queryFn: () => api(`/api/pvt/strata?sampleDesignId=${designId}`),
    enabled: !!designId,
    refetchInterval: 30000,
  });

  const criticalAlerts = ((alerts as any[]) ?? []).filter(
    (a) => a.status === "active" && (a.severity === "critical" || a.severity === "high"),
  );

  async function computeNow() {
    if (!designId) return;
    setComputing(true);
    try {
      await api("/api/pvt/projections/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleDesignId: designId }),
      });
      await queryClient.invalidateQueries({ queryKey: ["pvt-projection"] });
      await queryClient.invalidateQueries({ queryKey: ["pvt-alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["pvt-strata"] });
    } finally {
      setComputing(false);
    }
  }

  const candidates: any[] = projection?.candidateProjections ?? [];
  const chartData = candidates.map((c, i) => ({
    name: c.candidateName,
    share: +(c.projectedVoteShare * 100).toFixed(2),
    error: [
      +Math.max(0, (c.projectedVoteShare - c.voteShareLower) * 100).toFixed(2),
      +Math.max(0, (c.voteShareUpper - c.projectedVoteShare) * 100).toFixed(2),
    ],
    fill: PALETTE[i % PALETTE.length],
  }));

  const isLive = design?.status === "active";
  const inRecount = projection?.isWithinRecountTerritory;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-[#1D9BF0]" /> Parallel Vote Tabulation
          </h1>
          {design && (
            <Badge variant={isLive ? "default" : "secondary"} className={isLive ? "bg-green-600" : ""}>
              {isLive ? "LIVE" : design.status.toUpperCase()}
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={computeNow} disabled={!designId || computing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${computing ? "animate-spin" : ""}`} />
          Compute Now
        </Button>
      </div>

      {/* Critical alerts */}
      {criticalAlerts.map((a: any) => (
        <Alert key={a.id} variant={a.severity === "critical" ? "destructive" : "default"}
          className={a.severity === "high" ? "border-amber-500" : ""}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{a.title}</AlertTitle>
          <AlertDescription>{a.description}</AlertDescription>
        </Alert>
      ))}

      {!design ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No PVT sample yet — create one from the Sample Setup page.
        </CardContent></Card>
      ) : !projection ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No projection yet. Quick reports from sampled stations trigger projections automatically.
        </CardContent></Card>
      ) : (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <Users className="h-3 w-3" /> Sample Reporting
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-black">
                  {projection.reportedStations}<span className="text-sm text-muted-foreground">/{projection.totalSampledStations}</span>
                </p>
                <Progress value={projection.reportingRate * 100} className="h-2 mt-2" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <Percent className="h-3 w-3" /> Projected Turnout
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-black">{(projection.projectedTurnoutPercent * 100).toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Effective Sample
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-black">{Math.round(projection.effectiveSampleSize)}</p>
                <p className="text-xs text-muted-foreground">design effect {projection.designEffect.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className={inRecount ? "border-red-500" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <Scale className="h-3 w-3" /> Projected Margin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-black ${inRecount ? "text-red-600" : ""}`}>
                  {(projection.projectedMargin * 100).toFixed(2)}%
                </p>
                {inRecount && <p className="text-xs text-red-600 font-bold">RECOUNT TERRITORY</p>}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="projection">
            <TabsList>
              <TabsTrigger value="projection">Projection</TabsTrigger>
              <TabsTrigger value="candidates">Candidates</TabsTrigger>
              <TabsTrigger value="strata">Strata</TabsTrigger>
              <TabsTrigger value="alerts">Alerts</TabsTrigger>
            </TabsList>

            <TabsContent value="projection" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-black uppercase tracking-wider">
                    Projected Vote Share (95% confidence intervals)
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis unit="%" tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <Bar dataKey="share" name="Projected share">
                        {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        <ErrorBar dataKey="error" width={6} stroke="#555" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-black uppercase tracking-wider">Margin Analysis</CardTitle>
                </CardHeader>
                <CardContent className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[{
                      name: "Margin",
                      margin: +(projection.projectedMargin * 100).toFixed(2),
                      error: [
                        +Math.max(0, (projection.projectedMargin - projection.marginLower) * 100).toFixed(2),
                        +Math.max(0, (projection.marginUpper - projection.projectedMargin) * 100).toFixed(2),
                      ],
                    }]}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" />
                      <YAxis unit="%" />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <ReferenceLine y={0.5} stroke="#F4212E" strokeDasharray="6 3"
                        label={{ value: "Recount threshold 0.5%", fill: "#F4212E", fontSize: 11 }} />
                      <Bar dataKey="margin" fill={inRecount ? "#F4212E" : "#1D9BF0"} name="Projected margin">
                        <ErrorBar dataKey="error" width={6} stroke="#555" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="candidates">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {candidates.map((c: any, i: number) => (
                  <Card key={c.candidateId}>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-black w-8 shrink-0"
                          style={{ color: PALETTE[i % PALETTE.length] }}>#{i + 1}</span>
                        <div>
                          <p className="font-bold">{c.candidateName}</p>
                          <p className="text-xs text-muted-foreground">{c.partyName ?? "Independent"}</p>
                        </div>
                        <p className="ml-auto text-3xl font-black" style={{ color: PALETTE[i % PALETTE.length] }}>
                          {(c.projectedVoteShare * 100).toFixed(1)}%
                        </p>
                      </div>
                      <Progress value={c.projectedVoteShare * 100} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Projected: {Math.round(c.projectedVotes).toLocaleString()} votes</span>
                        <span>CI: {(c.voteShareLower * 100).toFixed(1)}–{(c.voteShareUpper * 100).toFixed(1)}%</span>
                        <span className="font-semibold">Win prob: {(c.winProbability * 100).toFixed(0)}%</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="strata">
              <div className="space-y-3">
                {((strata as any[]) ?? []).map((s: any) => (
                  <Card key={s.id}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="min-w-40">
                        <p className="font-bold truncate">{s.stratumName}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.registeredVoters.toLocaleString()} registered · turnout {(s.turnoutPercent * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="flex-1">
                        <Progress
                          value={s.sampledStations > 0 ? (s.reportedStations / s.sampledStations) * 100 : 0}
                          className="h-2" />
                      </div>
                      <p className="text-sm font-semibold whitespace-nowrap">
                        {s.reportedStations}/{s.sampledStations} reported
                      </p>
                    </CardContent>
                  </Card>
                ))}
                {((strata as any[]) ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No stratum data yet.</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="alerts">
              <div className="space-y-3">
                {((alerts as any[]) ?? []).map((a: any) => (
                  <Card key={a.id} className={a.severity === "critical" ? "border-red-500" : ""}>
                    <CardContent className="p-4 flex items-start gap-3">
                      <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>
                        {a.severity.toUpperCase()}
                      </Badge>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                      </div>
                      {a.status === "active" && (
                        <Button size="sm" variant="outline" onClick={async () => {
                          await api(`/api/pvt/alerts/${a.id}/acknowledge`, { method: "PATCH" });
                          await queryClient.invalidateQueries({ queryKey: ["pvt-alerts"] });
                        }}>
                          Acknowledge
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {((alerts as any[]) ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No alerts.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
