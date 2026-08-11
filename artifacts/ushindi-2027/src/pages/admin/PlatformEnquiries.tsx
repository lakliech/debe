/**
 * Platform Enquiries Inbox
 *
 * Lists all Request Access submissions from the landing page.
 * Platform admins can filter by status, click an enquiry to see the full
 * message, update its status, and add internal notes.
 *
 * Backed by:
 *   GET   /api/enquiries          — list (optional ?status= filter)
 *   GET   /api/enquiries/:id      — single enquiry
 *   PATCH /api/enquiries/:id      — update status / notes
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  RefreshCw,
  XCircle,
  Loader2,
  AlertCircle,
  CheckCircle2,
  PhoneCall,
  Ban,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
type EnquiryStatus = "new" | "contacted" | "converted" | "closed";

interface Enquiry {
  id: string;
  fullName: string;
  email: string;
  organisation: string;
  electionLevel: string;
  message: string | null;
  status: EnquiryStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUSES: { value: EnquiryStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api/enquiries${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: EnquiryStatus }) {
  const variants: Record<EnquiryStatus, { variant: "default" | "outline" | "secondary" | "destructive"; label: string; icon: React.ReactNode }> = {
    new: {
      variant: "default",
      label: "New",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    contacted: {
      variant: "secondary",
      label: "Contacted",
      icon: <PhoneCall className="h-3 w-3" />,
    },
    converted: {
      variant: "outline",
      label: "Converted",
      icon: <CheckCircle2 className="h-3 w-3 text-green-600" />,
    },
    closed: {
      variant: "outline",
      label: "Closed",
      icon: <Ban className="h-3 w-3 text-muted-foreground" />,
    },
  };

  const v = variants[status] ?? variants.new;
  return (
    <Badge
      variant={v.variant}
      className={cn(
        "gap-1 text-xs capitalize",
        status === "converted" && "border-green-500 text-green-600",
        status === "closed" && "text-muted-foreground",
      )}
    >
      {v.icon}
      {v.label}
    </Badge>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function EnquiryDetail({
  enquiry,
  onClose,
  onUpdated,
}: {
  enquiry: Enquiry;
  onClose: () => void;
  onUpdated: (updated: Enquiry) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<EnquiryStatus>(enquiry.status);
  const [notes, setNotes] = useState(enquiry.notes ?? "");
  const [dirty, setDirty] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/${enquiry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes: notes.trim() || null }),
      }),
    onSuccess: (data: Enquiry) => {
      toast({ title: "Enquiry updated" });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["platform-enquiries"] });
      onUpdated(data);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <aside className="w-full max-w-xl bg-background border-l border-border overflow-y-auto p-6 space-y-6 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">{enquiry.fullName}</h2>
            <p className="text-sm text-muted-foreground">{enquiry.organisation}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>

        {/* Meta strip */}
        <div className="flex flex-wrap gap-3 text-sm items-center">
          <StatusBadge status={enquiry.status} />
          <Badge variant="outline" className="text-xs font-mono">{enquiry.electionLevel}</Badge>
          <span className="text-muted-foreground text-xs">{formatDate(enquiry.createdAt)}</span>
        </div>

        {/* Contact info */}
        <div className="rounded-sm border border-border bg-muted/30 p-4 space-y-2 text-sm">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase mb-2">Contact</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-semibold">{enquiry.fullName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <a
                href={`mailto:${enquiry.email}`}
                className="font-semibold text-primary hover:underline break-all"
              >
                {enquiry.email}
              </a>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Organisation</p>
              <p className="font-semibold">{enquiry.organisation}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Election level</p>
              <p className="font-semibold">{enquiry.electionLevel}</p>
            </div>
          </div>
        </div>

        {/* Message */}
        <div className="rounded-sm border border-border p-4 space-y-2">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Message</p>
          {enquiry.message ? (
            <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{enquiry.message}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No message provided.</p>
          )}
        </div>

        {/* Status update */}
        <div className="rounded-sm border border-border p-4 space-y-3">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Update Status</p>
          <div className="flex flex-wrap gap-2">
            {(["new", "contacted", "converted", "closed"] as EnquiryStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => { setStatus(s); setDirty(true); }}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-sm border capitalize transition-colors",
                  status === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-sm border border-border p-4 space-y-3">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Internal Notes</p>
          <textarea
            rows={5}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
            placeholder="Add internal notes visible only to platform admins…"
            className="w-full resize-none text-sm border border-border rounded-sm px-3 py-2 bg-background focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Save */}
        <Button
          onClick={() => mutation.mutate()}
          disabled={!dirty || mutation.isPending}
          className="gap-2 self-start"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </aside>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PlatformEnquiries() {
  const [statusFilter, setStatusFilter] = useState<EnquiryStatus | "">("");
  const [selected, setSelected] = useState<Enquiry | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<Enquiry[]>({
    queryKey: ["platform-enquiries", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return apiFetch(`?${params}`);
    },
    retry: false,
  });

  const enquiries = data ?? [];

  if (isError) {
    const msg = (error as any)?.message ?? "";
    const isForbidden = msg.includes("Forbidden") || msg.includes("403");
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
        <Inbox className="h-16 w-16 text-muted-foreground/30" />
        <h1 className="text-2xl font-extrabold">
          {isForbidden ? "Access Restricted" : "Error loading enquiries"}
        </h1>
        <p className="text-muted-foreground max-w-md">
          {isForbidden
            ? "The Enquiries inbox is only accessible to platform operators."
            : msg}
        </p>
        {!isForbidden && (
          <Button variant="outline" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 border border-primary/20 rounded-sm">
            <Inbox className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Enquiries Inbox</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Request Access submissions from the landing page — newest first.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value as EnquiryStatus | "")}
            className={cn(
              "px-3 py-1.5 text-sm font-semibold rounded-sm border transition-colors",
              statusFilter === value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {label}
            {value === "" && data && (
              <span className="ml-1.5 text-xs opacity-70">{data.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-16">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading enquiries…
        </div>
      ) : enquiries.length === 0 ? (
        <div className="border border-dashed border-border rounded-sm p-14 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No enquiries</p>
          <p className="text-sm mt-1">
            {statusFilter ? `No ${statusFilter} enquiries yet.` : "No enquiries have been submitted yet."}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase">Name</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden sm:table-cell">Organisation</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden md:table-cell">Level</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden lg:table-cell">Submitted</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e, i) => (
                <tr
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/30",
                    i < enquiries.length - 1 && "border-b border-border",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{e.fullName}</div>
                    <div className="text-xs text-muted-foreground">{e.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{e.organisation}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Badge variant="outline" className="text-xs font-mono">{e.electionLevel}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleDateString("en-KE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground inline-block" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <EnquiryDetail
          enquiry={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => setSelected(updated)}
        />
      )}
    </div>
  );
}
