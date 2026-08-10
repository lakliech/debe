import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, AlertCircle, ChevronLeft, RefreshCw, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LEVEL_LABELS: Record<string, string> = {
  national: "National",
  county: "County",
  constituency: "Constituency",
  ward: "Ward",
};

const NEXT_LEVEL: Record<string, string> = {
  national: "county",
  county: "constituency",
  constituency: "ward",
  ward: "station",
};

function CandidateBar({ candidate, totalVotes }: { candidate: any; totalVotes: number }) {
  const pct = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
  return (
    <div className={`p-3 border rounded ${candidate.isOurCandidate ? "border-[#1D9BF0] bg-blue-50" : "border-border"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold">{candidate.candidateName}</span>
        <span className="font-mono font-black text-sm">{candidate.votes?.toLocaleString() ?? 0} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span></span>
      </div>
      <Progress value={pct} className={`h-1.5 ${candidate.isOurCandidate ? "[&>div]:bg-[#1D9BF0]" : ""}`} />
    </div>
  );
}

export default function TallyDrilldown() {
  const params = useParams();
  const level = params.level as string;
  const entityId = params.entityId as string;
  const [, navigate] = useLocation();
  const [autoRefresh] = useState(false);

  // Fetch the active election to get its ID for tally API
  const { data: elections } = useQuery({
    queryKey: ["elections-for-tally-drilldown"],
    queryFn: () =>
      // Use /elections/active — accessible to all authenticated users incl. tally viewers
      fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  const activeElection = (elections as any[] | undefined)?.find((e: any) => e.isActive) ?? (elections as any[])?.[0];
  const activeElectionId: string | undefined = activeElection?.id;

  function buildDrillUrl(): string {
    if (!activeElectionId || !level || !entityId) return "";
    if (level === "county") return `${BASE}/api/tally/county/${activeElectionId}/${entityId}`;
    if (level === "constituency") return `${BASE}/api/tally/constituency/${activeElectionId}/${entityId}`;
    if (level === "ward") return `${BASE}/api/tally/ward/${activeElectionId}/${entityId}`;
    if (level === "station") return `${BASE}/api/tally/station/${activeElectionId}/${entityId}`;
    return `${BASE}/api/tally/national/${activeElectionId}`;
  }

  const { data: tally, isLoading, refetch } = useQuery({
    queryKey: ["tally-drilldown", level, entityId, activeElectionId],
    queryFn: () => {
      const url = buildDrillUrl();
      if (!url) return Promise.resolve(null);
      return fetch(url, { credentials: "include" }).then(async (r) => {
        if (r.status === 403) {
          const body = await r.json().catch(() => ({}));
          if (body?.code === "OUT_OF_SCOPE") return { outOfScope: true, error: body.error };
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
    enabled: !!level && !!entityId && !!activeElectionId,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const candidates: any[] = tally?.candidates ?? [];
  const totalVotes = candidates.reduce((sum: number, c: any) => sum + (c.votes ?? 0), 0);
  const sortedCandidates = [...candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
  const subUnits: any[] = tally?.subUnits ?? [];
  const reporting = tally?.reporting ?? {};
  const stations = tally?.stations ?? {};
  const nextLevel = NEXT_LEVEL[level] ?? "";

  const backLevel = level === "county" ? "national" : level === "constituency" ? "county" : level === "ward" ? "constituency" : null;

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
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/tally")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Tally Dashboard
        </Button>
        {backLevel && tally?.parentEntityId && (
          <Button variant="ghost" size="sm" onClick={() => navigate(`/tally/${backLevel}/${tally.parentEntityId}`)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Up to {LEVEL_LABELS[backLevel]}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs uppercase tracking-wider">{LEVEL_LABELS[level] ?? level}</Badge>
          <h1 className="text-2xl font-black tracking-tight uppercase">
            {isLoading ? "Loading…" : (tally?.entityName ?? entityId)}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
          <BarChart3 className="h-4 w-4" /> Election Results Drill-Down
        </p>
      </div>

      {tally?.outOfScope ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-semibold text-amber-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {tally.error}
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <>
          {/* Candidate Results */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider">
                Candidate Results — {tally?.entityName ?? entityId}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sortedCandidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">No results yet for this area.</p>
              ) : (
                <div className="space-y-3">
                  {sortedCandidates.map((c, idx) => (
                    <div key={c.candidateId} className="flex items-start gap-3">
                      <span className={`text-xl font-black w-7 shrink-0 pt-1 ${idx === 0 ? "text-[#1D9BF0]" : "text-muted-foreground"}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <CandidateBar candidate={c} totalVotes={totalVotes} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-border flex justify-between text-sm">
                <span className="text-muted-foreground">Total Valid Votes</span>
                <span className="font-black font-mono">{totalVotes.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {/* Reporting & Station Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">Reporting Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Reporting", value: reporting.reporting ?? 0, total: reporting.total ?? 0, color: "bg-[#1D9BF0]" },
                  { label: "Verified", value: reporting.verified ?? 0, total: reporting.total ?? 0, color: "bg-green-600" },
                  { label: "Pending", value: reporting.pending ?? 0, total: reporting.total ?? 0, color: "bg-yellow-500" },
                ].map((item) => {
                  const pct = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{item.label}</span>
                        <span className="font-mono">{item.value}/{item.total} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">Station Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Received", value: stations.received ?? 0, color: "text-[#1D9BF0]" },
                    { label: "Verified", value: stations.verified ?? 0, color: "text-green-600" },
                    { label: "Outstanding", value: stations.outstanding ?? 0, color: "text-yellow-600" },
                    { label: "Disputed", value: stations.disputed ?? 0, color: "text-red-600" },
                  ].map((item) => (
                    <div key={item.label} className="text-center p-3 border border-border rounded">
                      <p className={`text-xl font-black font-mono ${item.color}`}>{item.value.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-bold uppercase">{item.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sub-units Table */}
          {subUnits.length > 0 && nextLevel !== "station" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">
                  {LEVEL_LABELS[nextLevel] ?? nextLevel} Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">
                          {LEVEL_LABELS[nextLevel] ?? "Sub-unit"}
                        </th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Stations</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Our Candidate</th>
                        {sortedCandidates.slice(0, 3).map((c) => (
                          <th key={c.candidateId} className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">
                            {c.partyAbbreviation}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Leading</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {subUnits.map((unit: any) => (
                        <tr
                          key={unit.entityId}
                          className="border-b border-border hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/tally/${nextLevel}/${unit.entityId}`)}
                        >
                          <td className="px-4 py-3 font-medium">{unit.entityName}</td>
                          <td className="px-4 py-3 font-mono text-xs">{unit.stationsReported}/{unit.stationsTotal}</td>
                          <td className="px-4 py-3 font-mono font-bold text-[#1D9BF0]">
                            {unit.ourCandidateVotes?.toLocaleString() ?? "—"}
                          </td>
                          {sortedCandidates.slice(0, 3).map((c) => {
                            const res = (unit.candidateResults ?? []).find((r: any) => r.candidateId === c.candidateId);
                            return (
                              <td key={c.candidateId} className="px-4 py-3 font-mono text-sm">
                                {res?.votes?.toLocaleString() ?? "—"}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">{unit.leadingCandidate ?? "—"}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Station-level table */}
          {subUnits.length > 0 && nextLevel === "station" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">Station Results</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Station</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Code</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Registered</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Our Candidate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subUnits.map((unit: any) => (
                        <tr
                          key={unit.entityId}
                          className="border-b border-border hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/election-results/${unit.submissionId}`)}
                        >
                          <td className="px-4 py-3 font-medium">{unit.entityName}</td>
                          <td className="px-4 py-3 font-mono text-xs">{unit.code ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-sm">{unit.registeredVoters?.toLocaleString() ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">{unit.status ?? "pending"}</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-[#1D9BF0]">
                            {unit.ourCandidateVotes?.toLocaleString() ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
