import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Users, Search, Download, ChevronLeft, ChevronRight, Eye, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { useListVolunteers, useGetVolunteerStats, approveVolunteer } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { KENYA_COUNTIES } from "@/pages/public/CountyPriorities";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  active: "bg-green-100 text-green-800 border border-green-200",
  rejected: "bg-red-100 text-red-800 border border-red-200",
  suspended: "bg-gray-100 text-gray-700 border border-gray-200",
  verified: "bg-blue-100 text-blue-800 border border-blue-200",
};

function StatusBadge({ status }: { status?: string | null }) {
  return (
    <span className={cn("px-2 py-0.5 text-xs font-bold uppercase tracking-wider", STATUS_STYLES[status?.toLowerCase() ?? ""] ?? "bg-gray-100 text-gray-700")}>
      {status ?? "Unknown"}
    </span>
  );
}

function StatTile({ title, value, color }: { title: string; value?: number | null; color: string }) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {value == null ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className={cn("text-3xl font-black font-mono", color)}>{value.toLocaleString()}</p>
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Volunteers() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [countyId, setCountyId] = useState("");
  const [page, setPage] = useState(1);

  const { data: stats } = useGetVolunteerStats();
  const { data: listData, isLoading } = useListVolunteers({
      search: search || undefined,
      status: status || undefined,
      countyId: countyId || undefined,
      page,
      limit: PAGE_SIZE,
    });

  const { mutate: approve } = useMutation({
    mutationFn: ({ id }: { id: string }) => approveVolunteer(id, {}),
    onSuccess: () => {
      toast({ title: "Approved", description: "Volunteer has been approved." });
      qc.invalidateQueries({ queryKey: ["/api/volunteers"] });
    },
    onError: () => toast({ title: "Error", description: "Could not approve volunteer.", variant: "destructive" }),
  });

  const volunteers = listData?.data ?? (Array.isArray(listData) ? listData : []);
  const total = listData?.total ?? volunteers.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase flex items-center gap-3">
              Volunteer Management
              {total > 0 && (
                <span className="bg-primary/10 text-primary text-sm font-black px-2 py-0.5">{total.toLocaleString()}</span>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Recruit, verify, and manage campaign volunteers.</p>
          </div>
          <button disabled className="flex items-center gap-2 bg-black text-white hover:bg-black/80 px-4 py-2 font-bold text-sm disabled:opacity-50">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile title="Total" value={stats?.total} color="text-foreground" />
          <StatTile title="Active" value={(stats?.byStatus as Record<string,number>)?.active} color="text-green-600" />
          <StatTile title="Pending" value={(stats?.byStatus as Record<string,number>)?.pending} color="text-yellow-600" />
          <StatTile title="Suspended" value={(stats?.byStatus as Record<string,number>)?.suspended} color="text-gray-500" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search volunteers..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
          <select value={countyId} onChange={(e) => { setCountyId(e.target.value); setPage(1); }} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Counties</option>
            {KENYA_COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Name", "Phone", "Location", "Status", "Role", "Joined", "Actions"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : volunteers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      No volunteers found.
                    </td>
                  </tr>
                ) : (
                  volunteers.map((v: any) => (
                    <tr
                      key={v.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/volunteers/${v.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">{v.fullName ?? v.name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {[v.ward, v.constituency, v.countyName].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{v.preferredRole ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {v.createdAt ? format(new Date(v.createdAt), "d MMM yy") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/volunteers/${v.id}`} className="p-1.5 hover:bg-muted rounded-sm transition-colors text-muted-foreground">
                            <Eye className="h-4 w-4" />
                          </Link>
                          {v.status === "pending" && (
                            <button
                              onClick={() => approve({ id: v.id })}
                              className="p-1.5 hover:bg-green-50 rounded-sm transition-colors text-green-600"
                              title="Approve"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="px-4 py-3 flex items-center justify-between border-t border-border bg-muted/20 text-sm text-muted-foreground">
              <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-foreground disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>Page {page} / {totalPages || 1}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
