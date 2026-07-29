import { useState, useEffect } from "react";
import { useBranding } from "@/contexts/BrandingContext";
import { getLevelOptions } from "@/lib/electionLevel";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BarChart3, AlertCircle, RefreshCw, Clock, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Level = "national" | "county" | "constituency" | "ward";

function CandidateCard({ candidate, totalVotes }: { candidate: any; totalVotes: number }) {
  const pct = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
  return (
    <div className={`p-4 border rounded ${candidate.isOurCandidate ? "border-[#1D9BF0] bg-blue-50" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-bold text-sm">{candidate.candidateName}</p>
          <p className="text-xs text-muted-foreground">{candidate.partyName} ({candidate.partyAbbreviation})</p>
        </div>
        <div className="text-right">
          <p className="font-black font-mono text-lg">{candidate.votes?.toLocaleString() ?? 0}</p>
          <p className="text-xs text-muted-foreground">{pct}%</p>
        </div>
      </div>
      <Progress value={pct} className={`h-2 ${candidate.isOurCandidate ? "[&>div]:bg-[#1D9BF0]" : ""}`} />
    </div>
  );
}

export default function TallyDashboard() {
  const branding = useBranding();
  const levelOptions = getLevelOptions(branding.electionLevel) as Level[];
  const [, navigate] = useLocation();
  const [level, setLevel] = useState<Level>(levelOptions[0] ?? "national");

  // Reset level when election type changes (e.g. switching from Presidential to MCA)
  useEffect(() => {
    if (!levelOptions.includes(level)) {
      setLevel(levelOptions[0] ?? "national");
      setCountyId("all");
      setConstituencyId("all");
      setWardId("all");
    }
  }, [branding.electionLevel]);
  const [countyId, setCountyId] = useState("all");
  const [constituencyId, setConstituencyId] = useState("all");
  const [wardId, setWardId] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const params = new URLSearchParams();
  params.set("level", level);
  if (level !== "national" && countyId !== "all") params.set("countyId", countyId);
  if (level === "ward" || level === "constituency") {
    if (constituencyId !== "all") params.set("constituencyId", constituencyId);
  }
  if (level === "ward" && wardId !== "all") params.set("wardId", wardId);

  // Fetch the active election first
  const { data: elections } = useQuery({
    queryKey: ["elections-for-tally"],
    queryFn: () =>
      // Use /elections/active — accessible to all authenticated users incl. tally viewers
      fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  const activeElection = (elections as any[] | undefined)?.find((e) => e.isActive) ?? (elections as any[])?.[0];
  const activeElectionId: string | undefined = activeElection?.id;

  // Build the correct URL based on level + entity selection
  function buildTallyUrl(): string {
    if (!activeElectionId) return "";
    if (level === "national") return `${BASE}/api/tally/national/${activeElectionId}`;
    if (level === "county" && countyId !== "all") return `${BASE}/api/tally/county/${activeElectionId}/${countyId}`;
    if (level === "constituency" && constituencyId !== "all") return `${BASE}/api/tally/constituency/${activeElectionId}/${constituencyId}`;
    if (level === "ward" && wardId !== "all") return `${BASE}/api/tally/ward/${activeElectionId}/${wardId}`;
    // Default: national when no entity is selected yet
    return `${BASE}/api/tally/national/${activeElectionId}`;
  }

  const { data: tally, isLoading, refetch } = useQuery({
    queryKey: ["tally-dashboard", level, countyId, constituencyId, wardId, activeElectionId],
    queryFn: () => {
      const url = buildTallyUrl();
      if (!url) return Promise.resolve(null);
      return fetch(url, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => { setLastUpdated(new Date()); return d; });
    },
    enabled: !!activeElectionId,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const { data: geoData } = useQuery({
    queryKey: ["tally-geo"],
    queryFn: () =>
      fetch(`${BASE}/api/geography/counties`, { credentials: "include" }).then((r) => r.json()),
  });

  const candidates: any[] = tally?.candidates ?? [];
  const totalVotes = candidates.reduce((sum, c) => sum + (c.votes ?? 0), 0);
  const sortedCandidates = [...candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

  const reporting = tally?.reporting ?? {};
  const stations = tally?.stations ?? {};

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
            <BarChart3 className="h-6 w-6 text-[#1D9BF0]" /> TALLY DASHBOARD
          </h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last updated: {lastUpdated.toLocaleTimeString("en-KE")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "bg-[#1D9BF0] hover:bg-[#1a8fd1]" : ""}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto-refresh ON (30s)" : "Auto-refresh OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh Now
          </Button>
        </div>
      </div>

      {/* Level Selector */}
      <div className="flex gap-2 flex-wrap items-center">
        {levelOptions.map((l) => (
          <Button
            key={l}
            variant={level === l ? "default" : "outline"}
            size="sm"
            className={level === l ? "bg-[#1D9BF0] hover:bg-[#1a8fd1]" : ""}
            onClick={() => { setLevel(l); setCountyId("all"); setConstituencyId("all"); setWardId("all"); }}
          >
            {l.charAt(0).toUpperCase() + l.slice(1)}
          </Button>
        ))}

        {level !== "national" && (
          <Select value={countyId} onValueChange={setCountyId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Select County" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Counties</SelectItem>
              {(geoData ?? []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : (
        <>
          {/* Candidate Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider">
                Candidate Leaderboard — {level.charAt(0).toUpperCase() + level.slice(1)} Level
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sortedCandidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">No results yet.</p>
              ) : (
                <div className="space-y-3">
                  {sortedCandidates.map((c, idx) => (
                    <div key={c.candidateId} className="flex items-start gap-3">
                      <span className={`text-2xl font-black w-8 shrink-0 ${idx === 0 ? "text-[#1D9BF0]" : "text-muted-foreground"}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <CandidateCard candidate={c} totalVotes={totalVotes} />
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

          {/* Reporting Progress */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">Reporting Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Stations Reporting", value: reporting.reporting ?? 0, total: reporting.total ?? 0, color: "bg-[#1D9BF0]" },
                  { label: "Verified", value: reporting.verified ?? 0, total: reporting.total ?? 0, color: "bg-green-600" },
                  { label: "Pending", value: reporting.pending ?? 0, total: reporting.total ?? 0, color: "bg-yellow-500" },
                ].map((item) => {
                  const pct = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{item.label}</span>
                        <span className="font-mono font-bold">{item.value.toLocaleString()} / {item.total.toLocaleString()} ({pct}%)</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
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
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Received", value: stations.received ?? 0, color: "text-[#1D9BF0]" },
                    { label: "Verified", value: stations.verified ?? 0, color: "text-green-600" },
                    { label: "Outstanding", value: stations.outstanding ?? 0, color: "text-yellow-600" },
                    { label: "Disputed", value: stations.disputed ?? 0, color: "text-red-600" },
                  ].map((item) => (
                    <div key={item.label} className="text-center p-3 border border-border rounded">
                      <p className={`text-2xl font-black font-mono ${item.color}`}>{item.value.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-bold uppercase tracking-wider">{item.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* County Breakdown (if national level) */}
          {level === "national" && (tally?.breakdown ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider">County Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">County</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Stations Reported</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Our Candidate</th>
                        <th className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider">Leading</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(tally.breakdown as any[]).map((row) => (
                        <tr
                          key={row.entityId}
                          className="border-b border-border hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/tally/county/${row.entityId}`)}
                        >
                          <td className="px-4 py-3 font-medium">{row.entityName}</td>
                          <td className="px-4 py-3 font-mono text-sm">{row.stationsReported}/{row.stationsTotal}</td>
                          <td className="px-4 py-3 font-mono font-bold text-[#1D9BF0]">{row.ourCandidateVotes?.toLocaleString() ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">{row.leadingCandidate ?? "—"}</Badge>
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
        </>
      )}
    </div>
  );
}
