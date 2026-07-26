import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ClipboardList, Search, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

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
  polling_centre_review: "bg-yellow-100 text-yellow-800",
  polling_centre_queried: "bg-orange-100 text-orange-800",
  constituency_verification: "bg-purple-100 text-purple-800",
  constituency_queried: "bg-pink-100 text-pink-800",
  county_verification: "bg-cyan-100 text-cyan-800",
  county_queried: "bg-teal-100 text-teal-800",
  national_verification: "bg-emerald-100 text-emerald-800",
  legal_review: "bg-amber-100 text-amber-800",
  verified: "bg-green-100 text-green-800",
};

const QUEUE_STATUSES = [
  "submitted", "auto_validated", "exception", "polling_centre_review",
  "constituency_verification", "county_verification", "national_verification", "legal_review"
];

export default function ResultSubmissions() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countyId, setCountyId] = useState("all");
  const [constituencyId, setConstituencyId] = useState("all");
  const [electionId, setElectionId] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (tab === "queue") {
    // Backend supports multi-value via repeated status params; send first queue status
    // and also set statuses= for backends that support it
    QUEUE_STATUSES.forEach(s => params.append("status", s));
  } else if (statusFilter !== "all") {
    params.set("status", statusFilter);
  }
  if (countyId !== "all") params.set("countyId", countyId);
  if (constituencyId !== "all") params.set("constituencyId", constituencyId);
  if (electionId !== "all") params.set("electionId", electionId);
  if (search) params.set("search", search);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading } = useQuery({
    queryKey: ["election-results", tab, statusFilter, countyId, constituencyId, electionId, search, page],
    queryFn: () =>
      fetch(`${BASE}/api/election-results/submissions?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: elections } = useQuery({
    queryKey: ["elections-list"],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections`, { credentials: "include" }).then((r) => r.json()),
  });

  const submissions: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">RESULT SUBMISSIONS</h1>
          <p className="text-sm text-muted-foreground mt-1">Election result submissions from polling agents.</p>
        </div>
      </div>

      {/* View Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all">All Submissions</TabsTrigger>
          <TabsTrigger value="queue" className="data-[state=active]:bg-[#1D9BF0] data-[state=active]:text-white">
            Verification Queue
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by station code..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {tab === "all" && (
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={countyId} onValueChange={(v) => { setCountyId(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Counties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {(data?.counties ?? []).map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={constituencyId} onValueChange={(v) => { setConstituencyId(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Constituencies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Constituencies</SelectItem>
            {(data?.constituencies ?? []).map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={electionId} onValueChange={(v) => { setElectionId(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Elections" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Elections</SelectItem>
            {(Array.isArray(elections) ? elections : []).map((e: any) => (
              <SelectItem key={e.id} value={e.id}>{e.electionType} {e.year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#1D9BF0]" />
            {tab === "queue" ? "Verification Queue" : "All Submissions"} ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ClipboardList className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No submissions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Station Code</TableHead>
                    <TableHead>Station Name</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Submitted At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((sub: any) => (
                    <TableRow
                      key={sub.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/election-results/${sub.id}`)}
                    >
                      <TableCell className="font-mono text-xs font-bold">{sub.stationCode ?? "—"}</TableCell>
                      <TableCell className="font-medium">{sub.stationName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{sub.agentName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString("en-KE") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${STATUS_COLORS[sub.status] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {sub.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(sub.validationFlags ?? []).length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {(sub.validationFlags as string[]).slice(0, 2).map((flag) => (
                              <Badge key={flag} className="text-xs bg-red-100 text-red-700" variant="outline">
                                {flag.replace(/_/g, " ")}
                              </Badge>
                            ))}
                            {(sub.validationFlags as string[]).length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{(sub.validationFlags as string[]).length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-green-600">✓ Clean</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
