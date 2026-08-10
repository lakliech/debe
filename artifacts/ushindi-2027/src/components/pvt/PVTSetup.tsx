/**
 * PVTSetup — configure and generate a stratified PPS sample for PVT.
 * Left: form. Right: methodology explainer + generated-sample preview.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Beaker, BarChart3, AlertTriangle, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** z-value for the usual confidence levels. */
const Z_BY_CONFIDENCE: Record<number, number> = { 0.8: 1.28, 0.85: 1.44, 0.9: 1.645, 0.95: 1.96, 0.99: 2.576 };

export default function PVTSetup() {
  const [, navigate] = useLocation();
  const [electionId, setElectionId] = useState("");
  const [stratumLevel, setStratumLevel] = useState<"county" | "constituency">("county");
  const [sampleSize, setSampleSize] = useState(500);
  const [confidence, setConfidence] = useState(95);
  const [marginOfError, setMarginOfError] = useState(1.5);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<any | null>(null);

  const { data: elections } = useQuery({
    queryKey: ["elections-pvt-setup"],
    queryFn: () => fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" }).then((r) => r.json()),
  });
  const activeElection = (elections as any[] | undefined)?.find((e: any) => e.isActive) ?? (elections as any[])?.[0];
  const effectiveElectionId = electionId || activeElection?.id || "";

  // Recommended sample size: n = z²·p(1−p)/e² with p = 0.5 (max variance)
  const recommended = useMemo(() => {
    const z = Z_BY_CONFIDENCE[confidence / 100] ?? 1.96;
    const e = marginOfError / 100;
    return Math.min(5000, Math.ceil((z * z * 0.25) / (e * e)));
  }, [confidence, marginOfError]);

  async function generate() {
    setGenerating(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(`${BASE}/api/pvt/samples`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          electionId: effectiveElectionId,
          stratumLevel,
          targetSampleSize: sampleSize,
          confidenceLevel: confidence / 100,
          marginOfError: marginOfError / 100,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setCreated(body);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function activate() {
    if (!created) return;
    const res = await fetch(`${BASE}/api/pvt/samples/${created.id}/activate`, {
      method: "POST", credentials: "include",
    });
    if (res.ok) navigate("/pvt");
  }

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
        <Beaker className="h-6 w-6 text-[#1D9BF0]" /> PVT Sample Setup
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider">Sample Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider">Election</label>
              <Select value={effectiveElectionId} onValueChange={setElectionId}>
                <SelectTrigger><SelectValue placeholder="Select election" /></SelectTrigger>
                <SelectContent>
                  {((elections as any[]) ?? []).map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} {e.isActive ? "(active)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider">Stratification Level</label>
              <Select value={stratumLevel} onValueChange={(v) => setStratumLevel(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="county">County (47 strata)</SelectItem>
                  <SelectItem value="constituency">Constituency (290 strata)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex justify-between">
                <label className="text-xs font-bold uppercase tracking-wider">Target Sample Size</label>
                <span className="text-sm font-bold">{sampleSize} stations</span>
              </div>
              <Slider min={100} max={2000} step={50} value={[sampleSize]}
                onValueChange={([v]) => setSampleSize(v)} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                Recommended for {marginOfError}% margin of error at {confidence}% confidence: <strong>{recommended.toLocaleString()}</strong>
              </p>
            </div>

            <div>
              <div className="flex justify-between">
                <label className="text-xs font-bold uppercase tracking-wider">Confidence Level</label>
                <span className="text-sm font-bold">{confidence}%</span>
              </div>
              <Slider min={80} max={99} step={1} value={[confidence]}
                onValueChange={([v]) => setConfidence(v)} className="mt-2" />
            </div>

            <div>
              <div className="flex justify-between">
                <label className="text-xs font-bold uppercase tracking-wider">Margin of Error</label>
                <span className="text-sm font-bold">±{marginOfError}%</span>
              </div>
              <Slider min={0.5} max={5} step={0.1} value={[marginOfError]}
                onValueChange={([v]) => setMarginOfError(v)} className="mt-2" />
            </div>

            {error && (
              <p className="text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </p>
            )}

            <Button className="w-full bg-[#1D9BF0] hover:bg-[#1a8fd1]"
              disabled={!effectiveElectionId || generating} onClick={generate}>
              {generating ? "Generating…" : "Generate Sample"}
            </Button>
          </CardContent>
        </Card>

        {/* Right: methodology + preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider">Methodology</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Stratified PPS sampling.</strong> Campaign stations are grouped by {stratumLevel}; within each stratum, stations are drawn with probability proportional to registered voters, so high-turnout urban stations are represented fairly.</p>
              <p><strong className="text-foreground">Design weights.</strong> Each sampled station gets weight 1/π. Urban stations (high π) weigh less; rural stations weigh more — producing unbiased projections.</p>
              <p><strong className="text-foreground">Bootstrap intervals.</strong> 2,000 resamples within strata produce 95% confidence intervals and win probabilities that respect the complex sample design.</p>
              <p><strong className="text-foreground">Recount territory.</strong> A projected margin below 0.5% triggers a critical alert (Kenyan presidential recount threshold).</p>
            </CardContent>
          </Card>

          {created && (
            <Card className="border-green-500">
              <CardContent className="p-5 space-y-3">
                <p className="flex items-center gap-2 font-bold text-green-700">
                  <CheckCircle2 className="h-5 w-5" /> Sample generated
                </p>
                <div className="text-sm space-y-1">
                  <p><strong>{created.sampledStations}</strong> stations sampled at <Badge variant="outline">{created.stratumLevel}</Badge> level</p>
                  <p className="text-muted-foreground">Status: {created.status} — review the stations, then activate for live reporting.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate("/pvt/stations")}>
                    <BarChart3 className="h-4 w-4 mr-1" /> Review Stations
                  </Button>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={activate}>
                    Activate Sample
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
