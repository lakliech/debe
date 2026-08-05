import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  MapPin, Search, CheckCircle2, XCircle, Clock, AlertCircle,
  Users, BarChart3, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function CoverageBadge({ hasAgent }: { hasAgent: boolean }) {
  if (hasAgent) {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-300 text-xs gap-1 font-medium">
        <CheckCircle2 className="h-3 w-3" /> Assigned
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
      <XCircle className="h-3 w-3" /> Unassigned
    </Badge>
  );
}

function StatusBadge({ value, label }: { value: string | null | undefined; trueVal: string; label: string }) {
  // unused — kept for future use
  return null;
}

function MiniStatusDots({ accreditation, training, reporting }: {
  accreditation: string | null | undefined;
  training: string | null | undefined;
  reporting: string | null | undefined;
}) {
  const dots = [
    { ok: accreditation === "accredited", title: "Accreditation" },
    { ok: training === "completed", title: "Training" },
    { ok: reporting === "reporting", title: "Reporting" },
  ];
  return (
    <div className="flex gap-1.5 items-center">
      {dots.map(({ ok, title }) => (
        <span
          key={title}
          title={title}
          className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-gray-200"}`}
        />
      ))}
    </div>
  );
}

export default function PollingStations() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [countyId, setCountyId] = useState("all");
  const [constituencyId, setConstituencyId] = useState("all");
  const [wardId, setWardId] = useState("all");
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(1);

  // Build query params for the main list
  const listParams = new URLSearchParams();
  if (search) listParams.set("search", search);
  if (countyId !== "all") listParams.set("countyId", countyId);
  if (constituencyId !== "all") listParams.set("constituencyId", constituencyId);
  if (wardId !== "all") listParams.set("wardId", wardId);
  if (unassigned) listParams.set("unassigned", "true");
  listParams.set("page", String(page));
  listParams.set("limit", "25");

  const { data, isLoading } = useQuery({
    queryKey: ["polling-stations", search, countyId, constituencyId, wardId, unassigned, page],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations?${listParams}`, { credentials: "include" })
        .then(r => r.json()),
  });

  // Constituencies cascade (only when a county is selected)
  const { data: constData } = useQuery({
    queryKey: ["geo-constituencies", countyId],
    queryFn: () =>
      fetch(`${BASE}/api/geography/constituencies?countyId=${countyId}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: countyId !== "all",
  });

  // Wards cascade (only when a constituency is selected)
  const { data: wardData } = useQuery({
    queryKey: ["geo-wards", constituencyId],
    queryFn: () =>
      fetch(`${BASE}/api/geography/wards?constituencyId=${constituencyId}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: constituencyId !== "all",
  });

  const stations: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totalAll: number = data?.totalAll ?? 0;
  const assignedCount: number = data?.assignedCount ?? 0;
  const unassignedCount: number = totalAll - assignedCount;
  const coveragePct: number = totalAll > 0 ? Math.round((assignedCount / totalAll) * 100) : 0;
  const counties: any[] = data?.counties ?? [];
  const constituencies: any[] = constData?.data ?? [];
  const wards: any[] = wardData?.data ?? [];
  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize);

  const isFiltered = countyId !== "all" || constituencyId !== "all" || wardId !== "all" || !!search || unassigned;

  function resetFilters() {
    setSearch("");
    setCountyId("all");
    setConstituencyId("all");
    setWardId("all");
    setUnassigned(false);
    setPage(1);
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight uppercase">POLLING STATIONS</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and manage all {totalAll > 0 ? totalAll.toLocaleString() : "…"} polling stations in your campaign's scope.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Stations</p>
              <MapPin className="h-5 w-5 text-[#1D9BF0]" />
            </div>
            {totalAll ? (
              <p className="text-2xl font-black font-mono text-[#1D9BF0]">{totalAll.toLocaleString()}</p>
            ) : (
              <Skeleton className="h-7 w-20" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assigned</p>
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-2xl font-black font-mono text-green-600">{assignedCount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">with primary agent</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Coverage</p>
              <BarChart3 className="h-5 w-5 text-purple-600" />
            </div>
            <p className="text-2xl font-black font-mono text-purple-600">{coveragePct}%</p>
            <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${coveragePct}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all ${unassigned ? "ring-2 ring-orange-400" : ""}`}
          onClick={() => { setUnassigned(!unassigned); setPage(1); }}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Unassigned</p>
              <AlertCircle className={`h-5 w-5 ${unassigned ? "text-orange-500" : "text-orange-400"}`} />
            </div>
            <p className={`text-2xl font-black font-mono ${unassigned ? "text-orange-500" : "text-orange-400"}`}>
              {unassignedCount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {unassigned ? "showing unassigned ×" : "click to filter"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search code or station name…"
            className="pl-9"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* County */}
        <Select
          value={countyId}
          onValueChange={v => {
            setCountyId(v);
            setConstituencyId("all");
            setWardId("all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Counties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {counties.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Constituency — only when county selected */}
        {countyId !== "all" && (
          <Select
            value={constituencyId}
            onValueChange={v => {
              setConstituencyId(v);
              setWardId("all");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All Constituencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Constituencies</SelectItem>
              {constituencies.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Ward — only when constituency selected */}
        {constituencyId !== "all" && (
          <Select
            value={wardId}
            onValueChange={v => { setWardId(v); setPage(1); }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Wards" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Wards</SelectItem>
              {wards.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isFiltered && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetFilters}>
            <Filter className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#1D9BF0]" />
            {isFiltered ? `${total.toLocaleString()} matching stations` : `All ${total.toLocaleString()} stations`}
            {unassigned && (
              <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs ml-1">
                Unassigned only
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : stations.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground">
              <MapPin className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No stations match these filters</p>
              {isFiltered && (
                <Button variant="ghost" size="sm" className="mt-3" onClick={resetFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Code</TableHead>
                    <TableHead>Station Name</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Constituency</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead className="text-right">Voters</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stations.map((s: any) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/polling-stations/${s.id}`)}
                    >
                      <TableCell className="font-mono text-xs font-bold text-muted-foreground">
                        {s.code}
                      </TableCell>
                      <TableCell className="font-medium max-w-[220px] truncate">
                        {s.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.wardName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.constituencyName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.countyName ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {s.registeredVoters > 0 ? s.registeredVoters.toLocaleString() : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <CoverageBadge hasAgent={s.hasAgent} />
                      </TableCell>
                      <TableCell className="text-center">
                        <MiniStatusDots
                          accreditation={s.accreditationStatus}
                          training={s.trainingStatus}
                          reporting={s.reportingStatus}
                        />
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
          <span>
            Page {page} of {totalPages.toLocaleString()}
            {" · "}
            {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
