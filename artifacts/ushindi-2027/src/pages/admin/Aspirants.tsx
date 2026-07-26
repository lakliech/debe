import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Vote, Search, ChevronLeft, ChevronRight, Eye, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const POSITIONS = [
  { value: "parliamentary", label: "MP" },
  { value: "gubernatorial", label: "Governor" },
  { value: "senatorial",    label: "Senator" },
  { value: "women_rep",     label: "Women Rep" },
  { value: "mca",           label: "MCA" },
];

const STATUS_STYLES: Record<string, string> = {
  pending:  "bg-yellow-100 text-yellow-800 border border-yellow-200",
  approved: "bg-green-100 text-green-800 border border-green-200",
  rejected: "bg-red-100 text-red-800 border border-red-200",
};

function StatusBadge({ status }: { status?: string | null }) {
  return (
    <span className={cn("px-2 py-0.5 text-xs font-bold uppercase tracking-wider", STATUS_STYLES[status ?? ""] ?? "bg-gray-100 text-gray-700")}>
      {status ?? "Unknown"}
    </span>
  );
}

function StatTile({ title, value, color }: { title: string; value?: number | null; color: string }) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {value == null ? <Skeleton className="h-8 w-20" /> : (
        <p className={cn("text-3xl font-black font-mono", color)}>{value.toLocaleString()}</p>
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
  return res.json();
}

export default function Aspirants() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [position, setPosition] = useState("");
  const [page, setPage]         = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const statsQ = useQuery({
    queryKey: ["/api/aspirants/stats"],
    queryFn:  () => apiFetch("/api/aspirants/stats"),
  });

  const listQ = useQuery({
    queryKey: ["/api/aspirants", search, status, position, page],
    queryFn:  () =>
      apiFetch(`/api/aspirants?page=${page}&limit=${PAGE_SIZE}` +
        (search   ? `&search=${encodeURIComponent(search)}` : "") +
        (status   ? `&status=${status}`                     : "") +
        (position ? `&position=${position}`                 : "")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      apiFetch(`/api/aspirants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      toast({ title: "Updated", description: `Aspirant marked as ${updated.status}.` });
      qc.invalidateQueries({ queryKey: ["/api/aspirants"] });
      setSelected(updated);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const doReview = (newStatus: string) =>
    updateMutation.mutate({ id: selected.id, payload: { status: newStatus, reviewNotes: reviewNotes || undefined } });

  const aspirants  = listQ.data?.data ?? [];
  const total      = listQ.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const stats      = statsQ.data;

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase flex items-center gap-3">
            <Vote className="h-6 w-6 text-primary" />
            Aspirant Declarations
            {total > 0 && <span className="bg-primary/10 text-primary text-sm font-black px-2 py-0.5">{total.toLocaleString()}</span>}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Review and manage candidates who have declared interest in elective positions.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile title="Total"    value={stats?.total}                  color="text-foreground" />
          <StatTile title="Pending"  value={stats?.byStatus?.pending}      color="text-yellow-600" />
          <StatTile title="Approved" value={stats?.byStatus?.approved}     color="text-green-600"  />
          <StatTile title="Rejected" value={stats?.byStatus?.rejected}     color="text-red-500"    />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={position} onChange={(e) => { setPosition(e.target.value); setPage(1); }} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Positions</option>
            {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Name", "Phone", "Position", "County", "Party / Indep.", "Status", "Submitted", ""].map((col) => (
                    <th key={col} className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  : aspirants.length === 0
                  ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        <Vote className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        No aspirant declarations found.
                      </td>
                    </tr>
                  )
                  : aspirants.map((a: any) => (
                    <tr key={a.id} className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => { setSelected(a); setReviewNotes(a.reviewNotes ?? ""); }}>
                      <td className="px-4 py-3 font-medium">{a.fullName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.phoneNumber}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {POSITIONS.find((p) => p.value === a.position)?.label ?? a.position}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{a.countyName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{a.isIndependent ? "Independent" : (a.partyAffiliation || "—")}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{a.createdAt ? format(new Date(a.createdAt), "d MMM yy") : "—"}</td>
                      <td className="px-4 py-3">
                        <button onClick={(e) => { e.stopPropagation(); setSelected(a); setReviewNotes(a.reviewNotes ?? ""); }}
                          className="p-1.5 hover:bg-muted rounded-sm transition-colors text-muted-foreground">
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <div className="px-4 py-3 flex items-center justify-between border-t border-border bg-muted/20 text-sm text-muted-foreground">
              <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-foreground disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span>Page {page} / {totalPages || 1}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Aspirant Declaration</span>
                  <span className="text-xl font-black uppercase tracking-tight">{selected.fullName}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={selected.status} />
                    <Badge variant="outline" className="font-mono text-xs">
                      {POSITIONS.find((p) => p.value === selected.position)?.label ?? selected.position}
                    </Badge>
                  </div>
                </SheetTitle>
              </SheetHeader>

              <dl className="space-y-3 text-sm mb-6">
                {([
                  ["Phone",        selected.phoneNumber],
                  ["Email",        selected.email || "—"],
                  ["National ID",  selected.nationalId],
                  ["County",       selected.countyName || "—"],
                  ["Constituency", selected.constituency || "—"],
                  ["Ward",         selected.ward || "—"],
                  ["Party",        selected.isIndependent ? "Independent" : (selected.partyAffiliation || "—")],
                  ["Submitted",    selected.createdAt ? format(new Date(selected.createdAt), "d MMM yyyy, HH:mm") : "—"],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="font-bold text-muted-foreground w-32 shrink-0">{label}</dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              {selected.statementOfIntent && (
                <div className="mb-6">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Statement of Intent</p>
                  <p className="text-sm leading-relaxed bg-muted/50 border border-border p-4 whitespace-pre-wrap">{selected.statementOfIntent}</p>
                </div>
              )}

              {selected.status === "pending" && (
                <div className="space-y-3 border-t border-border pt-5">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Review Decision</p>
                  <div>
                    <label className="text-xs font-bold text-muted-foreground block mb-1">Review Notes (optional)</label>
                    <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3}
                      placeholder="Internal notes for this decision..."
                      className="w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background resize-none" />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => doReview("approved")} disabled={updateMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white hover:bg-green-700 py-2.5 font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60">
                      {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve
                    </button>
                    <button onClick={() => doReview("rejected")} disabled={updateMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white hover:bg-red-700 py-2.5 font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60">
                      {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {selected.status !== "pending" && selected.reviewNotes && (
                <div className="border-t border-border pt-5">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Review Notes</p>
                  <p className="text-sm text-muted-foreground bg-muted/50 border border-border p-3">{selected.reviewNotes}</p>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
