/**
 * Public Election Results Transparency Portal
 *
 * Shows all verified Form 34A submissions for this campaign's election.
 * Visitors can:
 *  - Browse verified polling-station tallies
 *  - View candidate vote breakdowns
 *  - Open scanned Form 34A photos in a lightbox to cross-check official forms
 *
 * Only "verified" submissions are shown — unaudited results are never exposed.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Loader2,
  ImageOff,
  Download,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Derive tenant slug for ?tenant= query param on image requests (browser img src
// cannot set custom headers, so we fall back to the query param).
const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? "ushindi.app";
const RESERVED = new Set(["www", "api", "app", "mail", "localhost"]);
function deriveTenantSlug(): string | null {
  const env = import.meta.env.VITE_TENANT_SLUG as string | undefined;
  if (env) return env;
  const parts = window.location.hostname.split(".");
  return parts.length >= 3 && !RESERVED.has(parts[0]) ? parts[0] : null;
}

// Append ?tenant=<slug> to public API URLs so the server can identify the tenant
// even when the browser doesn't match a known subdomain (e.g. in development).
function publicUrl(path: string): string {
  const slug = deriveTenantSlug();
  const sep = path.includes("?") ? "&" : "?";
  return slug ? `${BASE}${path}${sep}tenant=${slug}` : `${BASE}${path}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Submission {
  id: string;
  pollingStationId: string;
  electionId: string;
  totalValidVotes: number | null;
  totalVotesCast: number | null;
  registeredVoters: number | null;
  rejectedBallots: number | null;
  spoiltBallots: number | null;
  submittedAt: string | null;
  stationName: string | null;
  stationCode: string | null;
  hasImages: boolean;
}

interface CandidateVote {
  id: string;
  candidateName: string;
  partyAbbreviation: string | null;
  voteCount: number;
}

interface FormImage {
  id: string;
  imageType: string;
  mimeType: string | null;
  pageNumber: number | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

// ── Image lightbox ────────────────────────────────────────────────────────────

function imageLabel(img: FormImage, index: number): string {
  const type = img.imageType
    .replace(/_/g, " ")
    .replace(/form page (\d+)/i, "Form 34A — Page $1")
    .replace(/station notice/i, "Station Notice")
    .replace(/incident evidence/i, "Incident Evidence")
    .replace(/video/i, "Video Evidence")
    .replace(/other/i, "Supporting Document");
  return `${type} (${index + 1})`;
}

function Form34ALightbox({
  submission,
  onClose,
}: {
  submission: Submission;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  const { data: images, isLoading } = useQuery<FormImage[]>({
    queryKey: ["transparency-images", submission.id],
    queryFn: () =>
      fetch(publicUrl(`/api/public/transparency/submissions/${submission.id}/images`)).then(
        (r) => r.json(),
      ),
  });

  const { data: votes } = useQuery<CandidateVote[]>({
    queryKey: ["transparency-votes", submission.id],
    queryFn: () =>
      fetch(publicUrl(`/api/public/transparency/submissions/${submission.id}/votes`)).then(
        (r) => r.json(),
      ),
  });

  const current = images?.[currentIndex];
  const total = images?.length ?? 0;

  function imageUrl(imageId: string) {
    return publicUrl(
      `/api/public/transparency/submissions/${submission.id}/images/${imageId}`,
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            Form 34A — {submission.stationName ?? submission.stationCode ?? submission.id.slice(0, 8)}
            {submission.stationCode && (
              <span className="font-mono text-xs text-muted-foreground font-normal">
                ({submission.stationCode})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row h-[80vh] md:h-[75vh]">
          {/* ── Left: vote summary ── */}
          <aside className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border p-4 overflow-y-auto space-y-4">
            <div>
              <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase mb-2">
                Verified Tally
              </p>
              {votes ? (
                <div className="space-y-1.5">
                  {votes.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{v.candidateName}</p>
                        {v.partyAbbreviation && (
                          <p className="text-xs text-muted-foreground">{v.partyAbbreviation}</p>
                        )}
                      </div>
                      <span className="font-mono font-bold tabular-nums text-right">
                        {v.voteCount.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
            </div>

            {submission.totalValidVotes != null && (
              <div className="pt-2 border-t border-border text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Valid votes</span>
                  <span className="font-mono font-semibold text-foreground">
                    {submission.totalValidVotes.toLocaleString()}
                  </span>
                </div>
                {submission.rejectedBallots != null && (
                  <div className="flex justify-between">
                    <span>Rejected</span>
                    <span className="font-mono">{submission.rejectedBallots.toLocaleString()}</span>
                  </div>
                )}
                {submission.spoiltBallots != null && (
                  <div className="flex justify-between">
                    <span>Spoilt</span>
                    <span className="font-mono">{submission.spoiltBallots.toLocaleString()}</span>
                  </div>
                )}
                {submission.registeredVoters != null && (
                  <div className="flex justify-between">
                    <span>Registered voters</span>
                    <span className="font-mono">{submission.registeredVoters.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* ── Right: image viewer ── */}
          <div className="flex-1 flex flex-col min-h-0 bg-muted/20">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading images…
              </div>
            ) : !images?.length ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <ImageOff className="h-10 w-10 opacity-30" />
                <p className="text-sm">No images uploaded for this submission.</p>
              </div>
            ) : (
              <>
                {/* Image area */}
                <div
                  className="flex-1 overflow-auto flex items-center justify-center p-2 cursor-zoom-in"
                  onClick={() => setZoomed((z) => !z)}
                >
                  <img
                    key={current?.id}
                    src={current ? imageUrl(current.id) : ""}
                    alt={current ? imageLabel(current, currentIndex) : ""}
                    className={cn(
                      "rounded border border-border shadow-sm transition-transform duration-200",
                      zoomed ? "max-w-none max-h-none w-auto h-auto" : "max-h-full max-w-full object-contain",
                    )}
                    draggable={false}
                  />
                </div>

                {/* Controls */}
                <div className="shrink-0 border-t border-border px-4 py-2 flex items-center gap-3 bg-background">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentIndex === 0}
                    onClick={() => { setCurrentIndex((i) => i - 1); setZoomed(false); }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">
                      {current ? imageLabel(current, currentIndex) : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {currentIndex + 1} / {total}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentIndex === total - 1}
                    onClick={() => { setCurrentIndex((i) => i + 1); setZoomed(false); }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    title="Toggle zoom"
                    onClick={() => setZoomed((z) => !z)}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>

                  {current && (
                    <a
                      href={imageUrl(current.id)}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Download">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                  )}
                </div>

                {/* Thumbnail strip */}
                {total > 1 && (
                  <div className="shrink-0 border-t border-border flex gap-1 p-2 overflow-x-auto bg-muted/30">
                    {images.map((img, i) => (
                      <button
                        key={img.id}
                        onClick={() => { setCurrentIndex(i); setZoomed(false); }}
                        className={cn(
                          "shrink-0 w-14 h-14 rounded border-2 overflow-hidden transition-all",
                          i === currentIndex
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border hover:border-muted-foreground",
                        )}
                      >
                        <img
                          src={imageUrl(img.id)}
                          alt={imageLabel(img, i)}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TransparencyPortalPage() {
  const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);

  const { data, isLoading, isError } = useQuery<{ data: Submission[]; page: number; limit: number }>({
    queryKey: ["public-transparency-submissions"],
    queryFn: () =>
      fetch(publicUrl("/api/public/transparency/submissions")).then((r) => r.json()),
  });

  const submissions = data?.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-extrabold tracking-tight">Results Transparency Portal</h1>
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            This portal publishes the verified tallies and scanned Form 34A documents from every
            polling station. Only submissions that have passed the campaign's verification process
            are shown. Compare any entry against the official IEBC records.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1.5 w-fit">
            <ShieldCheck className="h-3.5 w-3.5" />
            Showing verified submissions only
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading results…
          </div>
        ) : isError ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="font-semibold">Failed to load results</p>
            <p className="text-sm mt-1">Please try again later.</p>
          </div>
        ) : !submissions.length ? (
          <div className="border border-dashed border-border rounded-sm p-16 text-center text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No verified results yet</p>
            <p className="text-sm mt-1">
              Verified polling-station tallies will appear here as they are audited and approved.
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase">
                    Polling Station
                  </th>
                  <th className="px-4 py-3 text-right font-black text-xs tracking-widest text-muted-foreground uppercase hidden sm:table-cell">
                    Valid Votes
                  </th>
                  <th className="px-4 py-3 text-right font-black text-xs tracking-widest text-muted-foreground uppercase hidden md:table-cell">
                    Registered Voters
                  </th>
                  <th className="px-4 py-3 text-right font-black text-xs tracking-widest text-muted-foreground uppercase hidden lg:table-cell">
                    Submitted
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, i) => (
                  <tr
                    key={s.id}
                    className={cn(
                      "transition-colors",
                      i < submissions.length - 1 && "border-b border-border",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{s.stationName ?? "—"}</div>
                      {s.stationCode && (
                        <div className="text-xs font-mono text-muted-foreground">{s.stationCode}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums hidden sm:table-cell">
                      {s.totalValidVotes?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground tabular-nums hidden md:table-cell">
                      {s.registeredVoters?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                      {s.submittedAt
                        ? new Date(s.submittedAt).toLocaleDateString("en-KE", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.hasImages ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-8"
                          onClick={() => setActiveSubmission(s)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          View Form 34A
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No scan</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
              {submissions.length} verified station{submissions.length !== 1 ? "s" : ""} · All
              results have passed the campaign's verification process.
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center border-t border-border pt-6">
          Data published by the campaign in the interest of election transparency. 
          Cross-reference with official IEBC tallying results for independent verification.
        </p>
      </div>

      {/* Lightbox */}
      {activeSubmission && (
        <Form34ALightbox
          submission={activeSubmission}
          onClose={() => setActiveSubmission(null)}
        />
      )}
    </div>
  );
}
