import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, Plus, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GeoCascadeSelect } from "@/components/GeoCascadeSelect";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const INCIDENT_TYPES = [
  "voter_intimidation",
  "ballot_stuffing",
  "agent_ejection",
  "result_form_tampering",
  "bribery",
  "violence",
  "equipment_failure",
  "missing_materials",
  "late_opening",
  "early_closure",
  "unauthorized_persons",
  "multiple_voting",
  "impersonation",
  "counting_irregularity",
  "transmission_failure",
  "other",
] as const;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-gray-100 text-gray-700 border-gray-300",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  investigating: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
  escalated: "bg-purple-100 text-purple-800",
  closed: "bg-gray-100 text-gray-700",
};

interface IncidentForm {
  incidentType: string;
  title: string;
  description: string;
  severity: string;
  pollingStationId: string;
  countyId: string;
}

const defaultForm: IncidentForm = {
  incidentType: "other",
  title: "",
  description: "",
  severity: "medium",
  pollingStationId: "",
  countyId: "",
};

export default function ElectionIncidents() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [incidentTypeFilter, setIncidentTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [countyFilter, setCountyFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<IncidentForm>(defaultForm);
  const [detailIncident, setDetailIncident] = useState<any | null>(null);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (incidentTypeFilter !== "all") params.set("incidentType", incidentTypeFilter);
  if (severityFilter !== "all") params.set("severity", severityFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (countyFilter !== "all") params.set("countyId", countyFilter);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading } = useQuery({
    queryKey: ["election-incidents", search, incidentTypeFilter, severityFilter, statusFilter, countyFilter, page],
    queryFn: () =>
      fetch(`${BASE}/api/election-incidents?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: IncidentForm) =>
      fetch(`${BASE}/api/election-incidents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election-incidents"] });
      setSheetOpen(false);
      setForm(defaultForm);
      toast({ title: "Incident reported" });
    },
    onError: () => toast({ title: "Failed to report incident", variant: "destructive" }),
  });

  const setField = <K extends keyof IncidentForm>(key: K, value: IncidentForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const incidents: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-red-600" /> ELECTION INCIDENTS
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track and manage election day incidents.</p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700 text-white">
              <Plus className="h-4 w-4 mr-2" /> Report Incident
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Report Election Incident</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div>
                <Label>Incident Type *</Label>
                <Select value={form.incidentType} onValueChange={(v) => setField("incidentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Title *</Label>
                <Input
                  placeholder="Brief description of the incident..."
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                />
              </div>
              <div>
                <Label>Full Description *</Label>
                <Textarea
                  rows={4}
                  placeholder="Detailed description of what happened..."
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                />
              </div>
              <div>
                <Label>Severity *</Label>
                <Select value={form.severity} onValueChange={(v) => setField("severity", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">🔴 Critical</SelectItem>
                    <SelectItem value="high">🟠 High</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="low">⚪ Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Polling Station (optional)</Label>
                <GeoCascadeSelect
                  level="station"
                  optional
                  value={form.pollingStationId}
                  onChange={(id) => setField("pollingStationId", id)}
                />
              </div>
              <div>
                <Label>County (optional)</Label>
                <GeoCascadeSelect
                  level="county"
                  optional
                  value={form.countyId}
                  onChange={(id) => setField("countyId", id)}
                />
              </div>
            </div>
            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={!form.title || !form.description || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  ...form,
                  // Optional geography: never post "" — the API validates UUIDs.
                  // (undefined keys are dropped from the JSON body.)
                  pollingStationId: form.pollingStationId || undefined,
                  countyId: form.countyId || undefined,
                } as typeof form)}
              >
                {createMutation.isPending ? "Reporting..." : "Report Incident"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search incidents..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={incidentTypeFilter} onValueChange={(v) => { setIncidentTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {INCIDENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-red-600" />
            Incidents ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : incidents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertOctagon className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No incidents found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Reported By</TableHead>
                    <TableHead>Assigned Officer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((inc: any) => (
                    <TableRow
                      key={inc.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailIncident(inc)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {inc.incidentType?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs border ${SEVERITY_COLORS[inc.severity] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {inc.severity?.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-xs truncate">{inc.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{inc.stationName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{inc.reportedByName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{inc.assignedOfficerName ?? "Unassigned"}</TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${STATUS_COLORS[inc.status] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {inc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inc.createdAt ? new Date(inc.createdAt).toLocaleDateString("en-KE") : "—"}
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

      {/* Detail Sheet */}
      <Sheet open={detailIncident !== null} onOpenChange={(open) => !open && setDetailIncident(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Incident Detail</SheetTitle>
          </SheetHeader>
          {detailIncident && (
            <div className="space-y-4 mt-6">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{detailIncident.incidentType?.replace(/_/g, " ")}</Badge>
                <Badge className={`text-xs border ${SEVERITY_COLORS[detailIncident.severity] ?? ""}`} variant="outline">
                  {detailIncident.severity?.toUpperCase()}
                </Badge>
                <Badge className={`text-xs ${STATUS_COLORS[detailIncident.status] ?? ""}`} variant="outline">
                  {detailIncident.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title</p>
                <p className="font-bold mt-1">{detailIncident.title}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{detailIncident.description}</p>
              </div>
              {[
                { label: "Station", value: detailIncident.stationName },
                { label: "Reported By", value: detailIncident.reportedByName },
                { label: "Assigned Officer", value: detailIncident.assignedOfficerName },
                { label: "Date", value: detailIncident.createdAt ? new Date(detailIncident.createdAt).toLocaleString("en-KE") : "—" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm mt-1">{item.value ?? "—"}</p>
                </div>
              ))}
              {(detailIncident.notes ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Notes / Updates</p>
                  <div className="space-y-2">
                    {(detailIncident.notes as any[]).map((n: any, idx: number) => (
                      <div key={idx} className="p-3 bg-muted rounded text-sm">
                        <p className="text-xs text-muted-foreground mb-1">{n.authorName} · {n.createdAt ? new Date(n.createdAt).toLocaleString("en-KE") : "—"}</p>
                        <p>{n.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
