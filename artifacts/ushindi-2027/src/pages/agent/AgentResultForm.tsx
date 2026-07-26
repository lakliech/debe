/**
 * Offline-first Polling Agent Result Submission Form
 * Works fully offline — drafts saved to IndexedDB, synced when reconnected.
 * Can be installed as a PWA on Android.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  WifiOff,
  Wifi,
  Save,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Camera,
  MessageSquare,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  getDraftByStation,
  saveDraft,
  enqueueSubmission,
  getPendingCount,
  generateSmsCode,
  getDeviceId,
  type DraftSubmission,
} from "@/lib/agentIdb";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DEVICE_ID = getDeviceId();

function captureGPS(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

interface Candidate {
  id: string;
  fullName: string;
  partyAbbreviation?: string;
}

export default function AgentResultForm() {
  const { toast } = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [draft, setDraft] = useState<DraftSubmission | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSmsCode, setShowSmsCode] = useState(false);
  const [step, setStep] = useState<"station" | "ballot" | "candidates" | "observations" | "review">("station");
  const [stationCode, setStationCode] = useState("");
  const [stationInfo, setStationInfo] = useState<any>(null);
  const [electionId, setElectionId] = useState("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track online/offline
  useEffect(() => {
    const handleOnline = () => { setOnline(true); syncPending(); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("sw-submission-synced", () => {
      getPendingCount().then(setPendingCount);
      toast({ title: "Submission synced!", description: "Your result has been sent to the server." });
    });
    getPendingCount().then(setPendingCount);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Auto-save draft every 30s
  useEffect(() => {
    if (!draft) return;
    autoSaveTimer.current = setTimeout(() => {
      saveDraft({ ...draft, isDirty: false }).catch(() => {});
    }, 30_000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [draft]);

  // Fetch active election
  const { data: elections } = useQuery<any[]>({
    queryKey: ["active-elections"],
    queryFn: () =>
      // Use /elections/active — accessible to any authenticated user, including polling agents
      fetch(`${BASE}/api/election-admin/elections/active`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : [])
        .catch(() => []),
    enabled: online,
    staleTime: 5 * 60_000,
  });

  const activeElection = elections?.find((e: any) => e.isActive) ?? elections?.[0];

  // Resolve the current user's agent record
  const { data: myAgent } = useQuery<any>({
    queryKey: ["agent-me"],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents/me`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null),
    enabled: online,
    staleTime: 10 * 60_000,
  });

  // Fetch candidates for active election
  const { data: candidates } = useQuery<Candidate[]>({
    queryKey: ["candidates", activeElection?.id],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections/${activeElection!.id}/candidates`, { credentials: "include" })
        .then((r) => r.json())
        .catch(() => []),
    enabled: !!activeElection?.id && online,
    staleTime: 10 * 60_000,
  });

  const syncPending = useCallback(async () => {
    const reg = await navigator.serviceWorker?.ready.catch(() => null);
    reg?.active?.postMessage({ type: "REQUEST_SYNC" });
    setTimeout(() => getPendingCount().then(setPendingCount), 2000);
  }, []);

  const lookupStation = async () => {
    if (!stationCode.trim()) return;
    try {
      const resp = await fetch(`${BASE}/api/geography/polling-stations?search=${encodeURIComponent(stationCode)}`, { credentials: "include" });
      const data = await resp.json();
      const station = data?.data?.[0] ?? data?.[0];
      if (!station) { toast({ title: "Station not found", variant: "destructive" }); return; }
      setStationInfo(station);
      const eid = activeElection?.id ?? "";
      setElectionId(eid);
      const existing = await getDraftByStation(station.id, eid);
      if (existing) {
        setDraft(existing);
        toast({ title: "Draft loaded", description: "Continuing from saved draft." });
      } else {
        const newDraft: DraftSubmission = {
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          stationId: station.id,
          electionId: eid,
          agentId: myAgent?.id ?? "",  // pre-filled from /me lookup
          candidateVotes: (candidates ?? []).reduce((acc: any, c: Candidate) => ({
            ...acc, [c.id]: { name: c.fullName, party: c.partyAbbreviation, votes: 0 },
          }), {}),
          images: [],
          deviceId: DEVICE_ID,
          offlineCapturedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDirty: false,
        };
        const gps = await captureGPS();
        if (gps) { newDraft.gpsLat = gps.lat; newDraft.gpsLon = gps.lon; }
        setDraft(newDraft);
      }
      setStep("ballot");
    } catch {
      toast({ title: "Could not reach server", description: "Station lookup failed. Ensure you have connectivity.", variant: "destructive" });
    }
  };

  const updateDraft = (updates: Partial<DraftSubmission>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates, isDirty: true, updatedAt: new Date().toISOString() };
      saveDraft(updated).catch(() => {});
      return updated;
    });
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveDraft({ ...draft, isDirty: false });
      toast({ title: "Draft saved", description: "Saved to your device." });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!draft) return;
    setSubmitting(true);
    const payload = {
      pollingStationId: draft.stationId,
      electionId: draft.electionId,
      agentId: draft.agentId,
      registeredVoters: draft.registeredVoters,
      ballotsReceived: draft.ballotsReceived,
      ballotsIssued: draft.ballotsIssued,
      unusedBallots: draft.unusedBallots,
      spoiltBallots: draft.spoiltBallots,
      rejectedBallots: draft.rejectedBallots,
      totalValidVotes: draft.totalValidVotes,
      totalVotesCast: draft.totalVotesCast,
      agentSigned: draft.agentSigned,
      agentReceivedCopy: draft.agentReceivedCopy,
      resultsDisplayed: draft.resultsDisplayed,
      objectionRaised: draft.objectionRaised,
      agentComments: draft.agentComments,
      offlineCapturedAt: draft.offlineCapturedAt,
      deviceId: draft.deviceId,
      gpsLat: draft.gpsLat,
      gpsLon: draft.gpsLon,
      candidateVotes: Object.entries(draft.candidateVotes).map(([candidateId, v]) => ({
        candidateId,
        candidateName: v.name,
        partyAbbreviation: v.party,
        voteCount: v.votes,
      })),
    };

    // Use the combined agent-submit endpoint — atomically creates + validates
    const agentSubmitEndpoint = `${BASE}/api/election-results/submissions/agent-submit`;

    if (online) {
      try {
        const resp = await fetch(agentSubmitEndpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (resp.ok) {
          const result = await resp.json();
          const subId = result.submission?.id ?? result.submissionId;
          toast({ title: "✅ Submitted!", description: `Ref: ${subId ?? "recorded"}` });
          setStep("station");
          setDraft(null);
          setStationInfo(null);
          setStationCode("");
        } else {
          throw new Error("Server error");
        }
      } catch {
        // Queue for later with combined endpoint
        await enqueueSubmission({
          id: `queue-${Date.now()}`,
          stationId: draft.stationId,
          electionId: draft.electionId,
          endpoint: agentSubmitEndpoint,
          method: "POST",
          payload,
        });
        setPendingCount((n) => n + 1);
        toast({ title: "Queued offline", description: "Will sync when you reconnect.", variant: "default" });
      }
    } else {
      await enqueueSubmission({
        id: `queue-${Date.now()}`,
        stationId: draft.stationId,
        electionId: draft.electionId,
        endpoint: agentSubmitEndpoint,
        method: "POST",
        payload,
      });
      setPendingCount((n) => n + 1);
      toast({ title: "📴 Saved offline", description: "Will auto-sync when connected." });
    }
    setSubmitting(false);
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const candidateTotal = draft
    ? Object.values(draft.candidateVotes).reduce((s, v) => s + (v.votes || 0), 0)
    : 0;
  const validationFlags: string[] = [];
  if (draft) {
    if (draft.totalValidVotes !== undefined && candidateTotal !== draft.totalValidVotes) {
      validationFlags.push(`Candidate total (${candidateTotal}) ≠ total valid votes (${draft.totalValidVotes})`);
    }
    if (draft.totalVotesCast !== undefined && draft.registeredVoters !== undefined && draft.totalVotesCast > draft.registeredVoters) {
      validationFlags.push("Votes cast exceeds registered voters");
    }
    if (draft.ballotsIssued !== undefined && draft.totalVotesCast !== undefined && draft.unusedBallots !== undefined && draft.spoiltBallots !== undefined && draft.rejectedBallots !== undefined) {
      const reconc = (draft.totalVotesCast || 0) + (draft.unusedBallots || 0) + (draft.spoiltBallots || 0) + (draft.rejectedBallots || 0);
      if (reconc !== draft.ballotsIssued) {
        validationFlags.push(`Ballot reconciliation: ${reconc} ≠ ${draft.ballotsIssued} issued`);
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-black text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="text-xs font-black tracking-widest uppercase text-[#1D9BF0]">LINDA MWANANCHI 2027</p>
          <p className="text-sm font-bold">Agent Results Form</p>
        </div>
        <div className="flex items-center gap-2">
          {online
            ? <Badge className="bg-green-600 text-white text-xs"><Wifi className="h-3 w-3 mr-1" />Online</Badge>
            : <Badge className="bg-red-600 text-white text-xs"><WifiOff className="h-3 w-3 mr-1" />Offline</Badge>
          }
          {pendingCount > 0 && (
            <Badge className="bg-yellow-500 text-black text-xs cursor-pointer" onClick={syncPending}>
              <RefreshCw className="h-3 w-3 mr-1" />{pendingCount} pending
            </Badge>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Disclaimer */}
        <div className="bg-[#1D9BF0]/10 border border-[#1D9BF0] p-3 rounded text-xs">
          <p className="font-bold text-[#1D9BF0] uppercase tracking-wide">Campaign Agent Tool</p>
          <p className="text-muted-foreground mt-0.5">
            This form is for capturing form 37A data for our campaign records. It is NOT an official declaration by the IEBC.
          </p>
        </div>

        {/* Step: Station lookup */}
        {step === "station" && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">Find Your Station</h2>
            <p className="text-sm text-muted-foreground">Enter your polling station code or name to begin.</p>
            <div className="flex gap-2">
              <Input
                placeholder="Station code or name..."
                value={stationCode}
                onChange={(e) => setStationCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupStation()}
              />
              <Button onClick={lookupStation} disabled={!stationCode.trim()} className="bg-[#1D9BF0] text-white font-bold">
                Find
              </Button>
            </div>
            {!online && (
              <div className="bg-yellow-50 border border-yellow-300 p-3 rounded text-sm">
                <WifiOff className="h-4 w-4 inline mr-2 text-yellow-600" />
                You are offline. Station lookup requires connectivity. Previously saved drafts can be loaded below.
              </div>
            )}
          </div>
        )}

        {/* Station confirmed */}
        {stationInfo && step !== "station" && (
          <div className="bg-card border border-border p-3 rounded space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Your Station</p>
            <p className="font-bold">{stationInfo.name}</p>
            <p className="text-xs text-muted-foreground">{stationInfo.code} · Reg. voters: {stationInfo.registeredVoters?.toLocaleString()}</p>
          </div>
        )}

        {/* Step: Ballot Accounting */}
        {step === "ballot" && draft && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">Ballot Accounting</h2>
            <p className="text-xs text-muted-foreground">Fill in ALL figures from form 37A exactly as printed.</p>
            {[
              ["registeredVoters", "Registered Voters"],
              ["ballotsReceived", "Ballots Received"],
              ["ballotsIssued", "Ballots Issued"],
              ["unusedBallots", "Unused Ballots"],
              ["spoiltBallots", "Spoilt Ballots"],
              ["rejectedBallots", "Rejected Ballots"],
              ["totalVotesCast", "Total Votes Cast"],
              ["totalValidVotes", "Total Valid Votes"],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
                <Input
                  type="number"
                  min={0}
                  value={(draft as any)[field] ?? ""}
                  onChange={(e) => updateDraft({ [field]: e.target.value === "" ? undefined : parseInt(e.target.value) })}
                  className="text-right font-mono"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving} className="flex-1">
                <Save className="h-4 w-4 mr-1" />{saving ? "Saving…" : "Save Draft"}
              </Button>
              <Button className="flex-1 bg-[#1D9BF0] text-white font-bold" onClick={() => setStep("candidates")}>
                Next: Candidates →
              </Button>
            </div>
          </div>
        )}

        {/* Step: Candidate Votes */}
        {step === "candidates" && draft && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">Candidate Votes</h2>
            <p className="text-xs text-muted-foreground">Enter votes per candidate exactly as on form 37A.</p>
            {Object.entries(draft.candidateVotes).map(([candidateId, v]) => (
              <div key={candidateId} className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-bold">{v.name}</p>
                  {v.party && <p className="text-xs text-muted-foreground">{v.party}</p>}
                </div>
                <Input
                  type="number"
                  min={0}
                  className="w-28 text-right font-mono"
                  value={v.votes || ""}
                  onChange={(e) => updateDraft({
                    candidateVotes: {
                      ...draft.candidateVotes,
                      [candidateId]: { ...v, votes: parseInt(e.target.value) || 0 },
                    },
                  })}
                />
              </div>
            ))}
            <div className="border-t border-border pt-2 flex justify-between text-sm font-bold">
              <span>CANDIDATE TOTAL</span>
              <span className={candidateTotal !== (draft.totalValidVotes ?? candidateTotal) ? "text-red-600" : "text-green-700"}>
                {candidateTotal.toLocaleString()}
              </span>
            </div>
            {candidateTotal !== (draft.totalValidVotes ?? candidateTotal) && (
              <div className="bg-red-50 border border-red-200 p-2 rounded text-xs text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                Candidate total ({candidateTotal}) does not match Total Valid Votes ({draft.totalValidVotes ?? "not set"}).
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("ballot")}>← Ballot</Button>
              <Button className="flex-1 bg-[#1D9BF0] text-white font-bold" onClick={() => setStep("observations")}>
                Next: Observations →
              </Button>
            </div>
          </div>
        )}

        {/* Step: Observations */}
        {step === "observations" && draft && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">Observations</h2>
            {[
              ["agentSigned", "I signed the form (Form 37A)"],
              ["agentReceivedCopy", "I received a copy of the results"],
              ["resultsDisplayed", "Results were publicly displayed"],
              ["objectionRaised", "I raised an objection"],
            ].map(([field, label]) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!(draft as any)[field]}
                  onChange={(e) => updateDraft({ [field]: e.target.checked })}
                  className="h-5 w-5 accent-[#1D9BF0]"
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
            ))}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Comments</label>
              <Textarea
                value={draft.agentComments ?? ""}
                onChange={(e) => updateDraft({ agentComments: e.target.value })}
                placeholder="Any observations, irregularities, or notes..."
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("candidates")}>← Candidates</Button>
              <Button className="flex-1 bg-[#1D9BF0] text-white font-bold" onClick={() => setStep("review")}>
                Review & Submit →
              </Button>
            </div>
          </div>
        )}

        {/* Step: Review & Submit */}
        {step === "review" && draft && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">Review & Submit</h2>

            {/* Validation flags */}
            {validationFlags.length > 0 ? (
              <div className="bg-red-50 border border-red-300 p-3 rounded space-y-1">
                <p className="text-xs font-bold uppercase text-red-700 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Validation Issues
                </p>
                {validationFlags.map((f) => <p key={f} className="text-xs text-red-700">• {f}</p>)}
                <p className="text-xs text-red-600">You can still submit — the system will flag for review.</p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-300 p-3 rounded flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-700" />
                <p className="text-xs text-green-700 font-bold">All figures reconcile correctly.</p>
              </div>
            )}

            {/* Summary */}
            <div className="bg-card border border-border rounded p-3 space-y-2 text-sm">
              <p className="font-bold">Ballot Summary</p>
              {[
                ["Registered Voters", draft.registeredVoters],
                ["Total Valid Votes", draft.totalValidVotes],
                ["Total Votes Cast", draft.totalVotesCast],
                ["Rejected Ballots", draft.rejectedBallots],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-bold">{val?.toLocaleString() ?? "—"}</span>
                </div>
              ))}
            </div>

            {/* Candidate breakdown */}
            <div className="bg-card border border-border rounded p-3 space-y-2 text-sm">
              <p className="font-bold">Candidate Votes</p>
              {Object.entries(draft.candidateVotes).map(([cid, v]) => (
                <div key={cid} className="flex justify-between">
                  <span>{v.name} {v.party && <span className="text-muted-foreground text-xs">({v.party})</span>}</span>
                  <span className="font-mono font-bold">{(v.votes || 0).toLocaleString()}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>TOTAL</span>
                <span>{candidateTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* GPS + Device */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Device: {draft.deviceId}</p>
              {draft.gpsLat && <p>GPS: {draft.gpsLat.toFixed(5)}, {draft.gpsLon!.toFixed(5)}</p>}
              <p>Captured: {new Date(draft.offlineCapturedAt).toLocaleString()}</p>
            </div>

            {/* SMS Fallback */}
            <button
              onClick={() => setShowSmsCode(!showSmsCode)}
              className="text-xs text-[#1D9BF0] flex items-center gap-1 underline"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {showSmsCode ? "Hide" : "Show"} SMS fallback code
            </button>
            {showSmsCode && (
              <div className="bg-muted p-3 rounded font-mono text-xs break-all select-all">
                {generateSmsCode(draft)}
                <p className="font-sans text-muted-foreground mt-1 text-[10px]">Send this code to your supervisor via SMS if you cannot sync.</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("observations")}>← Back</Button>
              <Button
                className="flex-1 bg-[#1D9BF0] text-white font-bold"
                onClick={handleSubmit}
                disabled={submitting}
              >
                <Send className="h-4 w-4 mr-1" />
                {submitting ? "Submitting…" : online ? "Submit Now" : "Queue for Sync"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
