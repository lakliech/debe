import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtKES = (x: unknown) => (Number(x) / 1).toLocaleString("en-KE") + " KES";
const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const CHANNEL_BADGE: Record<string, string> = {
  mpesa: "bg-green-100 text-green-800",
  card: "bg-blue-100 text-blue-800",
  bank_transfer: "bg-indigo-100 text-indigo-800",
  cash: "bg-orange-100 text-orange-800",
  in_kind: "bg-purple-100 text-purple-800",
};

const VERIFY_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const COMPLIANCE_BADGE: Record<string, string> = {
  none: "bg-gray-100 text-gray-600",
  suspect: "bg-red-100 text-red-800",
  duplicate: "bg-orange-100 text-orange-800",
  limit_exceeded: "bg-red-100 text-red-900",
};

const PAGE_SIZE = 20;

export default function Contributions() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [complianceFlag, setComplianceFlag] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (channel) params.set("channel", channel);
  if (verificationStatus) params.set("verificationStatus", verificationStatus);
  if (complianceFlag) params.set("complianceFlag", complianceFlag);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading } = useQuery({
    queryKey: ["contributions", search, channel, verificationStatus, complianceFlag, page],
    queryFn: () =>
      fetch(`${BASE}/api/finance/contributions?${params.toString()}`, { credentials: "include" }).then(
        (r) => r.json()
      ),
  });

  const { mutate: verify } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/finance/contributions/${id}/verify`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "verified" }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Verified", description: "Contribution has been verified." });
      qc.invalidateQueries({ queryKey: ["contributions"] });
    },
    onError: () =>
      toast({ title: "Error", description: "Could not verify contribution.", variant: "destructive" }),
  });

  const contributions = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">CONTRIBUTIONS</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage and verify campaign contributions.</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search donor, reference..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <select
            value={channel}
            onChange={(e) => { setChannel(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Channels</option>
            <option value="mpesa">M-Pesa</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="in_kind">In-Kind</option>
          </select>
          <select
            value={verificationStatus}
            onChange={(e) => { setVerificationStatus(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={complianceFlag}
            onChange={(e) => { setComplianceFlag(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Flags</option>
            <option value="none">None</option>
            <option value="suspect">Suspect</option>
            <option value="duplicate">Duplicate</option>
            <option value="limit_exceeded">Limit Exceeded</option>
          </select>
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Reference #", "Donor", "Amount", "Channel", "Verification", "Compliance", "Date", "Actions"].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider text-muted-foreground"
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : contributions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      No contributions found.
                    </td>
                  </tr>
                ) : (
                  contributions.map((c: any) => (
                    <tr
                      key={c.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/finance/contributions/${c.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{c.referenceNumber ?? "—"}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.donorFullName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{c.donorPhone ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#1D9BF0]">{fmtKES(c.amount)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                            CHANNEL_BADGE[c.channel] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {(c.channel ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                            VERIFY_BADGE[c.verificationStatus] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {c.verificationStatus ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.complianceFlag && c.complianceFlag !== "none" ? (
                          <span
                            className={`px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                              COMPLIANCE_BADGE[c.complianceFlag] ?? "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {c.complianceFlag.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.createdAt ? fmtDate(c.createdAt) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div onClick={(e) => e.stopPropagation()}>
                          {c.verificationStatus === "pending" && (
                            <button
                              onClick={() => verify(c.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-green-700 border border-green-300 hover:bg-green-50 transition-colors"
                              title="Quick Verify"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Verify
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
              <span>
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of{" "}
                {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1 hover:text-foreground disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>
                  Page {page} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1 hover:text-foreground disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
