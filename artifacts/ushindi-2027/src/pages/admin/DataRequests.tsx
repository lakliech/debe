import { useState } from "react";
import { Shield, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { format, isPast, parseISO } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListDataRequests,
  resolveDataRequest,
  updateDataRequest,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REQUEST_TYPE_COLORS: Record<string, string> = {
  access: "bg-blue-100 text-blue-800",
  rectification: "bg-yellow-100 text-yellow-800",
  deletion: "bg-red-100 text-red-800",
  portability: "bg-purple-100 text-purple-800",
  objection: "bg-orange-100 text-orange-800",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-gray-100 text-gray-700",
};

const TABS = ["all", "pending", "in_progress", "resolved"] as const;

function StatTile({ title, value, color, icon: Icon }: { title: string; value?: number | null; color: string; icon: React.ComponentType<any> }) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm flex items-center gap-4">
      <Icon className={cn("h-8 w-8", color)} />
      <div>
        {value == null ? <Skeleton className="h-7 w-12" /> : (
          <p className="text-2xl font-black font-mono">{value}</p>
        )}
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      </div>
    </div>
  );
}

export default function DataRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [page, setPage] = useState(1);

  const { data: listData, isLoading } = useListDataRequests(
    activeTab === "all" ? { page } : { status: activeTab, page }
  );

  const requests: any[] = (listData as any)?.data ?? [];
  const total: number = (listData as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  // Count by status
  const { data: allData } = useListDataRequests({ page: 1 });
  const allRequests: any[] = (allData as any)?.data ?? [];
  const totalAll = (allData as any)?.total ?? 0;
  const pendingCount = allRequests.filter((r) => r.status === "pending").length;
  const overdueCount = allRequests.filter((r) => r.dueDate && isPast(parseISO(r.dueDate)) && r.status !== "resolved").length;

  const { mutate: resolve, isPending: resolving } = useMutation({
    mutationFn: (id: string) => resolveDataRequest(id, { resolutionNotes: notes, action: "resolved" }),
    onSuccess: () => {
      toast({ title: "Request Resolved", description: "The data subject request has been closed." });
      qc.invalidateQueries({ queryKey: ["/api/data-requests"] });
      setSelectedId(null);
      setNotes("");
    },
    onError: () => toast({ title: "Error", description: "Could not resolve request.", variant: "destructive" }),
  });

  const selectedRequest = requests.find((r) => r.id === (selectedId ?? viewId));

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase flex items-center gap-3">
              <Shield className="h-6 w-6 text-primary" />
              Data Subject Requests
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage requests under the Kenya Data Protection Act, 2019. All requests must be resolved within 30 days.
            </p>
          </div>
        </div>

        {/* GDPR note */}
        <div className="border border-primary/30 bg-primary/5 p-4 text-sm text-foreground flex items-start gap-3">
          <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p><strong className="font-black">Compliance Notice:</strong> All data subject requests must be acknowledged within 72 hours and fully resolved within 30 days as required by Section 26–30 of the Kenya Data Protection Act, 2019.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile title="Total Requests" value={totalAll} color="text-foreground" icon={Shield} />
          <StatTile title="Pending" value={pendingCount} color="text-yellow-600" icon={Clock} />
          <StatTile title="Overdue" value={overdueCount} color="text-red-600" icon={AlertTriangle} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setPage(1); }}
              className={cn(
                "px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-colors capitalize",
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    {["Request Type", "Requestor", "Received", "Due Date", "Status", "Actions"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No {activeTab === "all" ? "" : activeTab} requests found.
                      </td>
                    </tr>
                  ) : (
                    requests.map((req) => {
                      const isOverdue = req.dueDate && isPast(parseISO(req.dueDate)) && req.status !== "resolved";
                      return (
                        <tr key={req.id} className={cn("border-b border-border hover:bg-muted/20 transition-colors", isOverdue && "bg-red-50/50")}>
                          <td className="px-4 py-3">
                            <span className={cn("px-2 py-0.5 text-xs font-bold uppercase tracking-wider", REQUEST_TYPE_COLORS[req.requestType] ?? "bg-gray-100 text-gray-700")}>
                              {req.requestType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-bold text-sm">{req.fullName ?? req.subjectName ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{req.subjectEmail ?? "—"}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {req.createdAt ? format(parseISO(req.createdAt), "d MMM yyyy") : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {req.dueDate ? (
                              <span className={cn("font-bold", isOverdue ? "text-red-600" : "text-foreground")}>
                                {isOverdue && "⚠ "}
                                {format(parseISO(req.dueDate), "d MMM yyyy")}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("px-2 py-0.5 text-xs font-bold uppercase tracking-wider", STATUS_COLORS[req.status] ?? "bg-gray-100 text-gray-700")}>
                              {req.status?.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setViewId(req.id)}
                                className="text-xs font-bold text-primary hover:underline"
                              >
                                View
                              </button>
                              {req.status !== "resolved" && req.status !== "closed" && (
                                <button
                                  onClick={() => setSelectedId(req.id)}
                                  className="text-xs font-bold text-green-700 hover:underline"
                                >
                                  Resolve
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground font-medium">
                    Page {page} of {totalPages} · {total.toLocaleString()} total
                  </span>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs font-bold border border-border disabled:opacity-50 hover:bg-muted">← Prev</button>
                    <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs font-bold border border-border disabled:opacity-50 hover:bg-muted">Next →</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* View Sheet */}
      <Sheet open={!!viewId} onOpenChange={(open) => !open && setViewId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-black uppercase tracking-tight">Request Details</SheetTitle>
          </SheetHeader>
          {selectedRequest && (
            <div className="mt-6 space-y-4 text-sm">
              {[
                { label: "Type", value: selectedRequest.requestType },
                { label: "Status", value: selectedRequest.status },
                { label: "Full Name", value: selectedRequest.fullName ?? selectedRequest.subjectName },
                { label: "Email", value: selectedRequest.subjectEmail },
                { label: "Phone", value: selectedRequest.phoneNumber },
                { label: "Received", value: selectedRequest.createdAt ? format(parseISO(selectedRequest.createdAt), "d MMMM yyyy, h:mm a") : "—" },
                { label: "Due Date", value: selectedRequest.dueDate ? format(parseISO(selectedRequest.dueDate), "d MMMM yyyy") : "—" },
                { label: "Description", value: selectedRequest.description },
                { label: "Resolution Notes", value: selectedRequest.resolutionNotes },
                { label: "Resolved At", value: selectedRequest.resolvedAt ? format(parseISO(selectedRequest.resolvedAt), "d MMMM yyyy") : "—" },
              ].filter((row) => row.value).map((row) => (
                <div key={row.label} className="border-b border-border pb-3">
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-1">{row.label}</p>
                  <p className="font-medium text-foreground capitalize">{row.value}</p>
                </div>
              ))}
              {selectedRequest.status !== "resolved" && selectedRequest.status !== "closed" && (
                <button
                  onClick={() => { setViewId(null); setSelectedId(selectedRequest.id); }}
                  className="w-full bg-green-600 text-white hover:bg-green-700 py-2.5 font-bold text-sm"
                >
                  Resolve This Request
                </button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Resolve Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-black uppercase tracking-tight">Resolve Request</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label className="font-bold text-xs uppercase tracking-wider">Resolution Notes *</Label>
              <Textarea
                className="mt-1"
                rows={5}
                placeholder="Describe what action was taken to address this request..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <button
              disabled={!notes.trim() || resolving}
              onClick={() => selectedId && resolve(selectedId)}
              className="w-full bg-green-600 text-white hover:bg-green-700 py-3 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {resolving ? "Resolving..." : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Mark as Resolved
                </>
              )}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
