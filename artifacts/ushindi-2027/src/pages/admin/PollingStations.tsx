import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MapPin, Plus, Search, Upload, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function StatusBadge({ value, label }: { value: boolean | null | undefined; label: string }) {
  if (value === true) return <Badge className="bg-green-100 text-green-800 text-xs border-green-300">{label}</Badge>;
  if (value === false) return <Badge className="bg-red-100 text-red-800 text-xs border-red-300">Not {label}</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Pending</Badge>;
}

export default function PollingStations() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [countyId, setCountyId] = useState("all");
  const [constituencyId, setConstituencyId] = useState("all");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [csvJson, setCsvJson] = useState("");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (countyId !== "all") params.set("countyId", countyId);
  if (constituencyId !== "all") params.set("constituencyId", constituencyId);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading } = useQuery({
    queryKey: ["polling-stations", search, countyId, constituencyId, page],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  // Summary is derived from the list data — no separate endpoint needed
  const { data: summary } = useQuery({
    queryKey: ["polling-stations-summary"],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations?limit=1`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => ({ total: d.total })),
  });

  const importMutation = useMutation({
    mutationFn: (rows: unknown[]) =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-stations"] });
      setImportOpen(false);
      setCsvJson("");
      toast({ title: "Import successful", description: "Polling stations imported." });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const handleImport = () => {
    try {
      const rows = JSON.parse(csvJson);
      if (!Array.isArray(rows)) throw new Error("Must be a JSON array");
      importMutation.mutate(rows);
    } catch {
      toast({ title: "Invalid JSON", description: "Paste a valid JSON array.", variant: "destructive" });
    }
  };

  const stations: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  const summaryData = summary ?? {};

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">POLLING STATIONS</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage all polling stations and agent assignments.</p>
        </div>
        <Sheet open={importOpen} onOpenChange={setImportOpen}>
          <SheetTrigger asChild>
            <Button className="bg-[#1D9BF0] hover:bg-[#1a8fd1]">
              <Upload className="h-4 w-4 mr-2" /> Import CSV
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Import Polling Stations</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div className="bg-blue-50 border border-blue-200 p-4 rounded text-sm text-blue-800">
                <p className="font-bold mb-2">Instructions:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Export station data from IEBC portal as CSV</li>
                  <li>Convert to JSON array format</li>
                  <li>Each row should include: <code className="bg-blue-100 px-1">code, name, pollingCentreId, registeredVoters</code></li>
                  <li>Paste the JSON array below and click Import</li>
                </ol>
                <p className="mt-2 font-mono text-xs bg-blue-100 p-2 rounded">
                  {`[{"code":"001/01","name":"Station A","pollingCentreId":"c1","registeredVoters":500}]`}
                </p>
              </div>
              <div>
                <Label>JSON Array *</Label>
                <Textarea
                  rows={10}
                  placeholder='[{"code":"001/01","name":"Station A","pollingCentreId":"...","registeredVoters":500}]'
                  value={csvJson}
                  onChange={(e) => setCsvJson(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <Button
                className="w-full bg-[#1D9BF0] hover:bg-[#1a8fd1]"
                disabled={!csvJson.trim() || importMutation.isPending}
                onClick={handleImport}
              >
                {importMutation.isPending ? "Importing..." : "Import Stations"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Stations", value: (summaryData as any).total ?? total ?? "—", icon: MapPin, color: "text-[#1D9BF0]" },
          { label: "Stations Listed", value: total || "—", icon: CheckCircle2, color: "text-green-600" },
          { label: "This Page", value: stations.length || 0, icon: CheckCircle2, color: "text-purple-600" },
          { label: "Pages", value: totalPages || 1, icon: Clock, color: "text-orange-600" },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{card.label}</p>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
              <p className={`text-2xl font-black font-mono ${card.color}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
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
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#1D9BF0]" />
            Stations ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : stations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MapPin className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No polling stations found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Polling Centre</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Constituency</TableHead>
                    <TableHead>Reg. Voters</TableHead>
                    <TableHead>Primary Agent</TableHead>
                    <TableHead>Backup Agent</TableHead>
                    <TableHead>Accreditation</TableHead>
                    <TableHead>Training</TableHead>
                    <TableHead>Reporting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stations.map((s: any) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/polling-stations/${s.id}`)}
                    >
                      <TableCell className="font-mono text-xs font-bold">{s.code}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.pollingCentreName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.wardName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.constituencyName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{s.registeredVoters?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {s.primaryAgentName ? (
                          <span className="font-medium">{s.primaryAgentName}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.backupAgentName ? (
                          <span className="font-medium">{s.backupAgentName}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge value={s.accreditationStatus === "accredited"} label="Accredited" /></TableCell>
                      <TableCell><StatusBadge value={s.trainingStatus === "completed"} label="Trained" /></TableCell>
                      <TableCell><StatusBadge value={s.reportingStatus === "reporting"} label="Reporting" /></TableCell>
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
