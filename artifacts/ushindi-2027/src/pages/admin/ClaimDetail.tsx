import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Archive, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const URGENCY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border border-red-200",
  high: "bg-orange-100 text-orange-800 border border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  low: "bg-gray-100 text-gray-700 border border-gray-200",
};

const VERDICT_BADGE: Record<string, string> = {
  true: "bg-green-100 text-green-800",
  false: "bg-red-100 text-red-800",
  partially_true: "bg-yellow-100 text-yellow-800",
  misleading: "bg-orange-100 text-orange-800",
  unverifiable: "bg-gray-100 text-gray-700",
};

const STATUS_STEPS = [
  { key: "intake", label: "Intake" },
  { key: "assigned", label: "Assigned" },
  { key: "fact_checking", label: "Fact Check" },
  { key: "legal_review", label: "Legal Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

function StatusStepper({ currentStatus }: { currentStatus: string }) {
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === currentStatus);
  return (
    <div className="flex items-center gap-0 flex-wrap">
      {STATUS_STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div className={`flex flex-col items-center ${i <= currentIndex ? "opacity-100" : "opacity-40"}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 ${
                i < currentIndex
                  ? "bg-[#1D9BF0] border-[#1D9BF0] text-white"
                  : i === currentIndex
                  ? "border-[#1D9BF0] text-[#1D9BF0]"
                  : "border-muted-foreground text-muted-foreground"
              }`}
            >
              {i < currentIndex ? "✓" : i + 1}
            </div>
            <span className="text-xs font-bold mt-1 hidden sm:block whitespace-nowrap">{step.label}</span>
          </div>
          {i < STATUS_STEPS.length - 1 && (
            <div
              className={`h-0.5 w-8 sm:w-10 mx-1 ${i < currentIndex ? "bg-[#1D9BF0]" : "bg-muted-foreground/30"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ClaimDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [factCheckSheetOpen, setFactCheckSheetOpen] = useState(false);
  const [factCheckForm, setFactCheckForm] = useState({
    verdict: "false",
    evidenceSummary: "",
    sourcesUsed: "",
  });
  const [legalSheetOpen, setLegalSheetOpen] = useState(false);
  const [legalForm, setLegalForm] = useState({ legalClearance: false, legalNotes: "" });
  const [correctionSheetOpen, setCorrectionSheetOpen] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({
    correctionBodyEn: "",
    correctionBodySw: "",
    distributionChannels: [] as string[],
  });

  const { data: claim, isLoading } = useQuery({
    queryKey: ["claim", id],
    queryFn: () =>
      fetch(`${BASE}/api/rapid-response/claims/${id}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["claim", id] });

  const { mutate: assignClaim, isPending: assigning } = useMutation({
    mutationFn: (assignedTo: string) =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/assign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Claim assigned" });
      invalidate();
      setAssignDialogOpen(false);
      setAssignTo("");
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: submitFactCheck, isPending: factChecking } = useMutation({
    mutationFn: (body: typeof factCheckForm) =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/fact-checks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: body.verdict,
          evidenceSummary: body.evidenceSummary,
          sourcesUsed: body.sourcesUsed
            ? body.sourcesUsed.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Fact check submitted" });
      invalidate();
      setFactCheckSheetOpen(false);
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: submitLegalReview, isPending: legalReviewing } = useMutation({
    mutationFn: (body: typeof legalForm) =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/legal-review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Legal review submitted" });
      invalidate();
      setLegalSheetOpen(false);
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveClaim, isPending: approving } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Claim approved for publishing" });
      invalidate();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: publishCorrection, isPending: publishingCorrection } = useMutation({
    mutationFn: (body: typeof correctionForm) =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/corrections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Correction published" });
      invalidate();
      setCorrectionSheetOpen(false);
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: archiveClaim, isPending: archiving } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/rapid-response/claims/${id}/archive`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Claim archived" });
      invalidate();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  function toggleChannel(ch: string) {
    setCorrectionForm((f) => ({
      ...f,
      distributionChannels: f.distributionChannels.includes(ch)
        ? f.distributionChannels.filter((c) => c !== ch)
        : [...f.distributionChannels, ch],
    }));
  }

  if (isLoading) {
    return (
        <div className="space-y-4 animate-pulse">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48 w-full" />
        </div>
    );
  }

  const c = claim ?? {};
  const factChecks: any[] = Array.isArray(c.factChecks) ? c.factChecks : [];
  const corrections: any[] = Array.isArray(c.corrections) ? c.corrections : [];
  const status: string = c.status ?? "intake";

  return (
    <>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/rapid-response")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Rapid Response
        </button>

        {/* Claim Header */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <span
              className={`px-3 py-1 text-xs font-black uppercase tracking-wider ${
                URGENCY_BADGE[c.urgency] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {c.urgency ?? "—"} URGENCY
            </span>
            <button
              onClick={() => archiveClaim()}
              disabled={archiving || status === "archived"}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          </div>
          <div className="bg-muted/30 p-4 mb-4">
            <p className="text-sm leading-relaxed">{c.claimText ?? "—"}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="font-bold">
              Platform:{" "}
              <span className="uppercase">{(c.platform ?? "—").replace(/_/g, " ")}</span>
            </span>
            {c.sourceUrl && (
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[#1D9BF0] hover:underline"
              >
                Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <span>Reported: {c.createdAt ? fmtDate(c.createdAt) : "—"}</span>
          </div>
        </div>

        {/* Status Stepper */}
        <div className="bg-card border border-border p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
            Progress
          </p>
          <StatusStepper currentStatus={status} />
        </div>

        {/* Status-Based Action Panel */}
        <div className="bg-card border border-border p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
            Actions
          </p>
          <div className="flex gap-3 flex-wrap">
            {status === "intake" && (
              <button
                onClick={() => setAssignDialogOpen(true)}
                className="px-4 py-2 text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Assign
              </button>
            )}
            {status === "assigned" && (
              <button
                onClick={() => setFactCheckSheetOpen(true)}
                className="px-4 py-2 text-sm font-bold bg-purple-600 text-white hover:bg-purple-700"
              >
                Submit Fact Check
              </button>
            )}
            {status === "fact_checking" && (
              <button
                onClick={() => setLegalSheetOpen(true)}
                className="px-4 py-2 text-sm font-bold bg-orange-500 text-white hover:bg-orange-600"
              >
                Legal Review
              </button>
            )}
            {status === "legal_review" && (
              <button
                onClick={() => approveClaim()}
                disabled={approving}
                className="px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve for Publishing
              </button>
            )}
            {status === "approved" && (
              <button
                onClick={() => setCorrectionSheetOpen(true)}
                className="px-4 py-2 text-sm font-bold bg-[#1D9BF0] text-white hover:bg-[#1A8CD8]"
              >
                Publish Correction
              </button>
            )}
            {(status === "published" || status === "archived") && (
              <p className="text-sm text-muted-foreground">No further actions available.</p>
            )}
          </div>
        </div>

        {/* Fact Checks */}
        {factChecks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              Fact Checks
            </h2>
            {factChecks.map((fc: any, i: number) => (
              <div key={fc.id ?? i} className="bg-card border border-border p-4 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={`px-2 py-0.5 text-xs font-black uppercase ${
                      VERDICT_BADGE[fc.verdict] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {(fc.verdict ?? "—").replace(/_/g, " ")}
                  </span>
                  {fc.completedAt && (
                    <span className="text-xs text-muted-foreground">{fmtDate(fc.completedAt)}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{fc.evidenceSummary ?? "—"}</p>
                {Array.isArray(fc.sourcesUsed) && fc.sourcesUsed.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {fc.sourcesUsed.length} source(s) cited
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Corrections */}
        {corrections.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              Published Corrections
            </h2>
            {corrections.map((cor: any, i: number) => (
              <div key={cor.id ?? i} className="bg-card border border-green-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-green-700 uppercase">Published</span>
                  {cor.publishedAt && (
                    <span className="text-xs text-muted-foreground">{fmtDate(cor.publishedAt)}</span>
                  )}
                </div>
                <p className="text-sm">{cor.correctionBodyEn ?? "—"}</p>
                {Array.isArray(cor.distributionChannels) && cor.distributionChannels.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {cor.distributionChannels.map((ch: string) => (
                      <span
                        key={ch}
                        className="px-2 py-0.5 text-xs font-bold bg-muted text-muted-foreground uppercase"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Enter the User ID to assign this claim to.</p>
            <Input
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              placeholder="User UUID..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => assignClaim(assignTo)}
              disabled={assigning || !assignTo.trim()}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fact Check Sheet */}
      <Sheet open={factCheckSheetOpen} onOpenChange={setFactCheckSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Submit Fact Check</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Verdict *
              </label>
              <select
                value={factCheckForm.verdict}
                onChange={(e) => setFactCheckForm((f) => ({ ...f, verdict: e.target.value }))}
                className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none"
              >
                <option value="true">True</option>
                <option value="false">False</option>
                <option value="partially_true">Partially True</option>
                <option value="misleading">Misleading</option>
                <option value="unverifiable">Unverifiable</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Evidence Summary *
              </label>
              <Textarea
                value={factCheckForm.evidenceSummary}
                onChange={(e) => setFactCheckForm((f) => ({ ...f, evidenceSummary: e.target.value }))}
                rows={5}
                placeholder="Explain the evidence..."
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Sources Used (comma-separated)
              </label>
              <Input
                value={factCheckForm.sourcesUsed}
                onChange={(e) => setFactCheckForm((f) => ({ ...f, sourcesUsed: e.target.value }))}
                placeholder="https://source1.com, https://source2.com"
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setFactCheckSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitFactCheck(factCheckForm)}
              disabled={factChecking || !factCheckForm.evidenceSummary.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Submit Fact Check
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Legal Review Sheet */}
      <Sheet open={legalSheetOpen} onOpenChange={setLegalSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Legal Review</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={legalForm.legalClearance}
                onChange={(e) => setLegalForm((f) => ({ ...f, legalClearance: e.target.checked }))}
                className="h-4 w-4 accent-[#1D9BF0]"
              />
              <span className="text-sm font-bold">Legal clearance granted</span>
            </label>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Legal Notes
              </label>
              <Textarea
                value={legalForm.legalNotes}
                onChange={(e) => setLegalForm((f) => ({ ...f, legalNotes: e.target.value }))}
                rows={5}
                placeholder="Legal notes and observations..."
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setLegalSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitLegalReview(legalForm)}
              disabled={legalReviewing}
              className="bg-orange-500 hover:bg-orange-600"
            >
              Submit Review
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Publish Correction Sheet */}
      <Sheet open={correctionSheetOpen} onOpenChange={setCorrectionSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Publish Correction</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Correction (English) *
              </label>
              <Textarea
                value={correctionForm.correctionBodyEn}
                onChange={(e) => setCorrectionForm((f) => ({ ...f, correctionBodyEn: e.target.value }))}
                rows={6}
                placeholder="Correction statement in English..."
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Correction (Swahili)
              </label>
              <Textarea
                value={correctionForm.correctionBodySw}
                onChange={(e) => setCorrectionForm((f) => ({ ...f, correctionBodySw: e.target.value }))}
                rows={4}
                placeholder="Taarifa ya marekebisho kwa Kiswahili..."
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                Distribution Channels
              </label>
              <div className="flex gap-4">
                {["website", "sms", "social"].map((ch) => (
                  <label key={ch} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={correctionForm.distributionChannels.includes(ch)}
                      onChange={() => toggleChannel(ch)}
                      className="h-4 w-4 accent-[#1D9BF0]"
                    />
                    <span className="capitalize">{ch}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setCorrectionSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => publishCorrection(correctionForm)}
              disabled={publishingCorrection || !correctionForm.correctionBodyEn.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Publish Correction
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
