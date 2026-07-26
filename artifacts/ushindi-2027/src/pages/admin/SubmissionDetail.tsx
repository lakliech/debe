import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, AlertCircle, CheckCircle2, XCircle, ZoomIn, ZoomOut, RotateCw,
  Image as ImageIcon, ClipboardList, User, MapPin
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUSES = [
  "draft", "submitted", "auto_validated", "exception", "polling_centre_review",
  "polling_centre_queried", "constituency_verification", "constituency_queried",
  "county_verification", "county_queried", "national_verification", "legal_review", "verified"
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
  auto_validated: "bg-indigo-100 text-indigo-800",
  exception: "bg-red-100 text-red-800",
  verified: "bg-green-100 text-green-800",
};

function ImageViewer({ images }: { images: any[] }) {
  const [selected, setSelected] = useState<any | null>(null);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {images.map((img: any, idx: number) => (
          <button
            key={img.id ?? idx}
            className={`relative group border-2 rounded overflow-hidden aspect-square ${selected?.id === img.id ? "border-[#1D9BF0]" : "border-border hover:border-muted-foreground"}`}
            onClick={() => { setSelected(img); setZoom(100); setRotation(0); }}
          >
            <img
              src={img.objectPath ?? img.imageUrl}
              alt={img.imageType ?? "Form image"}
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 py-0.5">
              {img.imageType?.replace(/_/g, " ")}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="border border-border rounded p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(200, z + 10))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRotation((r) => (r + 90) % 360)}>
              <RotateCw className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Brightness</span>
              <input
                type="range" min="50" max="200" value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Contrast</span>
              <input
                type="range" min="50" max="200" value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <Badge variant="outline" className="text-xs">{selected.imageType?.replace(/_/g, " ")}</Badge>
          </div>
          <div className="overflow-auto max-h-[500px] border border-border rounded bg-muted/20 flex items-center justify-center">
            <img
              src={selected.objectPath ?? selected.imageUrl}
              alt={selected.imageType}
              style={{
                transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                transition: "transform 0.2s, filter 0.2s",
              }}
              className="max-w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubmissionDetail() {
  const params = useParams();
  const id = params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actionNote, setActionNote] = useState("");
  const [toStatus, setToStatus] = useState("");

  const { data: submission, isLoading } = useQuery({
    queryKey: ["election-result", id],
    queryFn: () =>
      fetch(`${BASE}/api/election-results/submissions/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ action, note, toStatus: ts }: { action: string; note: string; toStatus: string }) =>
      fetch(`${BASE}/api/election-results/submissions/${id}/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: note, toStatus: ts }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election-result", id] });
      setActionNote("");
      setToStatus("");
      toast({ title: "Action recorded" });
    },
    onError: () => toast({ title: "Failed to record action", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pb-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!submission || submission.error) {
    return (
      <div className="space-y-6 pb-8">
        <Button variant="ghost" onClick={() => navigate("/election-results")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Results
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-3" />
          <p>Submission not found.</p>
        </div>
      </div>
    );
  }

  const formImages: any[] = submission.images ?? [];
  // API returns `candidateVotes` (from GET /submissions/:id response)
  const candidateResults: any[] = submission.candidateVotes ?? [];
  // API returns `corrections` for correction history
  const correctionHistory: any[] = submission.corrections ?? [];
  // Derive validation flags from verificationSteps where action === "queried"
  const verificationSteps: any[] = submission.verificationSteps ?? [];
  const validationFlags: string[] = verificationSteps
    .filter((s: any) => s.action === "queried")
    .flatMap((s: any) => s.notes ? [s.notes] : []);

  const ballotFields = [
    { label: "Registered Voters", key: "registeredVoters" },
    { label: "Ballots Received", key: "ballotsReceived" },
    { label: "Ballots Issued", key: "ballotsIssued" },
    { label: "Unused Ballots", key: "unusedBallots" },
    { label: "Spoilt Ballots", key: "spoiltBallots" },
    { label: "Rejected Ballots", key: "rejectedBallots" },
    { label: "Total Valid Votes", key: "totalValidVotes" },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* Disclaimer Banner */}
      <div className="bg-blue-50 border border-blue-300 rounded p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800 font-medium">
          <strong>DISCLAIMER:</strong> Campaign tally based on polling-station forms received and verified by the campaign.
          This is not an official declaration by the electoral commission.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/election-results")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">SUBMISSION REVIEW</h1>
          <p className="text-sm text-muted-foreground font-mono">{submission.id?.slice(0, 16)}…</p>
        </div>
        <Badge
          className={`ml-auto text-sm ${STATUS_COLORS[submission.status] ?? "bg-gray-100 text-gray-700"}`}
          variant="outline"
        >
          {submission.status?.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Station & Agent Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[#1D9BF0]" /> Station Info
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Station Code", value: submission.stationCode },
                { label: "Station Name", value: submission.stationName },
                { label: "Ward", value: submission.wardName },
                { label: "Constituency", value: submission.constituencyName },
                { label: "County", value: submission.countyName },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium mt-0.5">{item.value ?? "—"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <User className="h-4 w-4 text-[#1D9BF0]" /> Agent Info
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Agent Name", value: submission.agentName },
                { label: "National ID", value: submission.agentNationalId },
                { label: "Phone", value: submission.agentPhone },
                { label: "Submitted At", value: submission.submittedAt ? new Date(submission.submittedAt).toLocaleString("en-KE") : "—" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium mt-0.5">{item.value ?? "—"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ballot Accounting */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#1D9BF0]" /> Ballot Accounting
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Entered Value</TableHead>
                <TableHead>OCR Suggestion</TableHead>
                <TableHead>Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ballotFields.map((field) => {
                const entered = submission[field.key];
                const ocr = submission.ocrData?.[field.key];
                const match = entered != null && ocr != null ? entered === ocr : null;
                return (
                  <TableRow key={field.key}>
                    <TableCell className="font-medium">{field.label}</TableCell>
                    <TableCell className="font-mono font-bold">{entered ?? "—"}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{ocr ?? "—"}</TableCell>
                    <TableCell>
                      {match === true && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                      {match === false && <XCircle className="h-4 w-4 text-red-600" />}
                      {match === null && <span className="text-muted-foreground text-xs">N/A</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Candidate Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Candidate Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {candidateResults.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No candidate results recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Votes</TableHead>
                  <TableHead>OCR Suggestion</TableHead>
                  <TableHead>Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidateResults.map((c: any) => {
                  const match = c.votes != null && c.ocrVotes != null ? c.votes === c.ocrVotes : null;
                  return (
                    <TableRow key={c.candidateId} className={c.isOurCandidate ? "bg-blue-50" : ""}>
                      <TableCell className="font-medium">
                        {c.candidateName}
                        {c.isOurCandidate && <Badge className="ml-2 bg-[#1D9BF0] text-white text-xs">Ours</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.partyAbbreviation}</TableCell>
                      <TableCell className="font-mono font-bold">{(c.voteCount ?? c.votes)?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{c.ocrVotes ?? "—"}</TableCell>
                      <TableCell>
                        {match === true && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {match === false && <XCircle className="h-4 w-4 text-red-600" />}
                        {match === null && <span className="text-xs text-muted-foreground">N/A</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Validation Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Validation Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {validationFlags.length === 0 ? (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">All validation checks passed</span>
            </div>
          ) : (
            <div className="space-y-2">
              {validationFlags.map((flag) => (
                <div key={flag} className="flex items-center gap-2 text-red-700">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="text-sm">{flag.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Images */}
      {formImages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#1D9BF0]" /> Form Images
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ImageViewer images={formImages} />
          </CardContent>
        </Card>
      )}

      {/* Correction History */}
      {correctionHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider">Correction History (Immutable)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Old Value</TableHead>
                  <TableHead>New Value</TableHead>
                  <TableHead>Changed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {correctionHistory.map((h: any) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {h.createdAt ? new Date(h.createdAt).toLocaleString("en-KE") : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{h.fieldName}</TableCell>
                    <TableCell className="font-mono text-sm text-red-600">{String(h.originalValue ?? h.oldValue ?? "—")}</TableCell>
                    <TableCell className="font-mono text-sm text-green-600">{String(h.correctedValue ?? h.newValue ?? "—")}</TableCell>
                    <TableCell className="text-sm">{h.changedByName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Verification Action Panel */}
      <Card className="border-2 border-[#1D9BF0]">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-[#1D9BF0]">
            Verification Action
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Move to Status</Label>
            <Select value={toStatus} onValueChange={setToStatus}>
              <SelectTrigger><SelectValue placeholder="Select target status..." /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              placeholder="Add verification notes, query details, or rejection reason..."
              rows={3}
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={!toStatus || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate({ action: "approve", note: actionNote, toStatus })}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button
              variant="outline"
              className="border-orange-400 text-orange-700 hover:bg-orange-50"
              disabled={!toStatus || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate({ action: "query", note: actionNote, toStatus })}
            >
              Query
            </Button>
            <Button
              variant="outline"
              className="border-blue-400 text-blue-700 hover:bg-blue-50"
              disabled={!toStatus || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate({ action: "escalate", note: actionNote, toStatus })}
            >
              Escalate
            </Button>
            <Button
              variant="outline"
              className="border-red-400 text-red-700 hover:bg-red-50"
              disabled={!toStatus || verifyMutation.isPending}
              onClick={() => verifyMutation.mutate({ action: "reject", note: actionNote, toStatus })}
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
