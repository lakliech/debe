import { useState } from "react";
import { useLocation } from "wouter";
import { Flag, Search, Download, ChevronLeft, ChevronRight, Eye, Mail, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { useListSupporters, useGetSupporterStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { KENYA_COUNTIES } from "@/pages/public/CountyPriorities";
import { cn } from "@/lib/utils";

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

export default function Supporters() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [countyId, setCountyId] = useState("");
  const [optedOut, setOptedOut] = useState<boolean | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data: stats } = useGetSupporterStats();
  const { data: listData, isLoading } = useListSupporters({
      search: search || undefined,
      countyId: countyId || undefined,
      optedOut: optedOut,
      page,
    });

  const supporters = listData?.data ?? (Array.isArray(listData) ? listData : []);
  const total = listData?.total ?? supporters.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase flex items-center gap-3">
              Supporter CRM
              {total > 0 && (
                <span className="bg-primary/10 text-primary text-sm font-black px-2 py-0.5">{total.toLocaleString()}</span>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Manage campaign supporters and consent records.</p>
          </div>
          <button disabled className="flex items-center gap-2 bg-black text-white hover:bg-black/80 px-4 py-2 font-bold text-sm disabled:opacity-50">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile title="Total Supporters" value={stats?.total} color="text-foreground" />
          <StatTile title="Opted Out" value={stats?.optedOut} color="text-red-500" />
          <StatTile title="SMS Consent" value={stats?.consentSms} color="text-green-600" />
          <StatTile title="Email Consent" value={stats?.consentEmail} color="text-blue-600" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search supporters..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <select value={countyId} onChange={(e) => { setCountyId(e.target.value); setPage(1); }} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Counties</option>
            {KENYA_COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 border border-input px-3 py-2 text-sm cursor-pointer hover:border-primary transition-colors">
            <input
              type="checkbox"
              checked={optedOut === true}
              onChange={(e) => { setOptedOut(e.target.checked ? true : undefined); setPage(1); }}
              className="h-4 w-4 accent-primary"
            />
            Opted Out Only
          </label>
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Name", "Phone", "Email", "County", "Consents", "Status", "Joined", "Actions"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : supporters.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      <Flag className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      No supporters found.
                    </td>
                  </tr>
                ) : (
                  supporters.map((s: any) => (
                    <tr
                      key={s.id}
                      className={cn("border-b border-border hover:bg-muted/30 transition-colors cursor-pointer", s.optedOut && "opacity-60")}
                      onClick={() => setLocation(`/supporters/${s.id}`)}
                    >
                      <td className={cn("px-4 py-3 font-medium", s.optedOut && "line-through")}>{s.fullName ?? s.name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[160px]">{s.email ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.countyName ?? s.countyCode ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {s.consentSms && <span title="SMS Consent" className="text-green-600"><MessageSquare className="h-3.5 w-3.5" /></span>}
                          {s.consentMarketing && <span title="Email Consent" className="text-blue-600"><Mail className="h-3.5 w-3.5" /></span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {s.optedOut ? (
                          <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5">OPT-OUT</span>
                        ) : (
                          <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5">ACTIVE</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {s.createdAt ? format(new Date(s.createdAt), "d MMM yy") : "—"}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setLocation(`/supporters/${s.id}`)}
                          className="p-1.5 hover:bg-muted rounded-sm transition-colors text-muted-foreground"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
    </>
  );
}
