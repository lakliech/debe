import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale, Plus, Search, Zap, MessageSquare, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GeoCascadeSelect } from "@/components/GeoCascadeSelect";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DISPUTE_TYPES = [
  "result_discrepancy",
  "agent_rejection",
  "form_tampering",
  "missing_form",
  "count_dispute",
  "transmission_error",
  "ballot_irregularity",
  "other",
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-gray-100 text-gray-700 border-gray-300",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  under_review: "bg-yellow-100 text-yellow-800",
  pending_evidence: "bg-orange-100 text-orange-800",
  resolved: "bg-green-100 text-green-800",
  escalated_legal: "bg-purple-100 text-purple-800",
  closed: "bg-gray-100 text-gray-700",
};

interface DisputeForm {
  disputeType: string;
  title: string;
  description: string;
  priority: string;
  pollingStationId: string;
  deadline: string;
}

const defaultForm: DisputeForm = {
  disputeType: "result_discrepancy",
  title: "",
  description: "",
  priority: "medium",
  pollingStationId: "",
  deadline: "",
};

export default function ElectionDisputes() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Fetch active election so auto-detect can pass electionId
  const { data: elections } = useQuery<any[]>({
    queryKey: ["elections-for-disputes"],
    queryFn: () =>
      fetch(`${BASE}/api/election-admin/elections`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : []).catch(() => []),
  });
  const activeElectionId: string | undefined =
    (elections?.find((e: any) => e.isActive) ?? elections?.[0])?.id;

  const [search, setSearch] = useState("");
  const [disputeTypeFilter, setDisputeTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [openSheet, setOpenSheet] = useState(false);
  const [form, setForm] = useState<DisputeForm>(defaultForm);
  const [detailDispute, setDetailDispute] = useState<any | null>(null);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (disputeTypeFilter !== "all") params.set("disputeType", disputeTypeFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (priorityFilter !== "all") params.set("priority", priorityFilter);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading } = useQuery({
    queryKey: ["election-disputes", search, disputeTypeFilter, statusFilter, priorityFilter, page],
    queryFn: () =>
      fetch(`${BASE}/api/election-disputes?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: DisputeForm) =>
      fetch(`${BASE}/api/election-disputes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // electionId is required by the schema; inject activeElectionId from the fetched active election
        body: JSON.stringify({ ...body, electionId: activeElectionId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election-disputes"] });
      setOpenSheet(false);
      setForm(defaultForm);
      toast({ title: "Dispute opened" });
    },
    onError: () => toast({ title: "Failed to open dispute", variant: "destructive" }),
  });

  const autoDetectMutation = useMutation({
    mutationFn: (electionId?: string) =>
      fetch(`${BASE}/api/election-disputes/auto-detect`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId: electionId ?? activeElectionId }),
      }).then((r) => r.json()),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["election-disputes"] });
      toast({
        title: "Auto-detection complete",
        description: `Found ${result.detected ?? 0} potential disputes.`,
      });
    },
    onError: () => toast({ title: "Auto-detect failed", variant: "destructive" }),
  });

  const setField = <K extends keyof DisputeForm>(key: K, value: DisputeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const disputes: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <Scale className="h-6 w-6 text-purple-600" /> ELECTION DISPUTES
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Dispute reconciliation and resolution centre.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => autoDetectMutation.mutate(activeElectionId)}
            disabled={autoDetectMutation.isPending}
          >
            <Zap className="h-4 w-4 mr-2" />
            {autoDetectMutation.isPending ? "Detecting..." : "Auto-Detect"}
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => setOpenSheet(true)}
          >
            <Plus className="h-4 w-4 mr-2" /> Open Dispute
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search disputes..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={disputeTypeFilter} onValueChange={(v) => { setDisputeTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {DISPUTE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="pending_evidence">Pending Evidence</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="escalated_legal">Escalated Legal</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <Scale className="h-4 w-4 text-purple-600" />
            Disputes ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : disputes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Scale className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No disputes found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Deadline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disputes.map((d: any) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailDispute(d)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{d.disputeType?.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-xs truncate">{d.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.stationName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs border ${PRIORITY_COLORS[d.priority] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {d.priority?.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${STATUS_COLORS[d.status] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {d.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{d.assignedToName ?? "Unassigned"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(d.deadlineAt ?? d.deadline) ? new Date(d.deadlineAt ?? d.deadline).toLocaleDateString("en-KE") : "—"}
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

      {/* Open Dispute Sheet */}
      <Sheet open={openSheet} onOpenChange={setOpenSheet}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Open New Dispute</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Dispute Type *</Label>
              <Select value={form.disputeType} onValueChange={(v) => setField("disputeType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISPUTE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title *</Label>
              <Input
                placeholder="Brief description..."
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
              />
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea
                rows={4}
                placeholder="Detailed description of the dispute..."
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
              />
            </div>
            <div>
              <Label>Priority *</Label>
              <Select value={form.priority} onValueChange={(v) => setField("priority", v)}>
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
              <Label>Resolution Deadline</Label>
              <Input
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setField("deadline", e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setOpenSheet(false)}>Cancel</Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
              disabled={!form.title || !form.description || createMutation.isPending}
              onClick={() => createMutation.mutate({
                ...form,
                // Optional geography: never post "" — must be a UUID or omitted.
                // (undefined keys are dropped from the JSON body.)
                pollingStationId: form.pollingStationId || undefined,
              } as typeof form)}
            >
              {createMutation.isPending ? "Opening..." : "Open Dispute"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail Sheet */}
      <Sheet open={detailDispute !== null} onOpenChange={(open) => !open && setDetailDispute(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Dispute Detail</SheetTitle>
          </SheetHeader>
          {detailDispute && (
            <div className="space-y-6 mt-6">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{detailDispute.disputeType?.replace(/_/g, " ")}</Badge>
                <Badge className={`text-xs border ${PRIORITY_COLORS[detailDispute.priority] ?? ""}`} variant="outline">
                  {detailDispute.priority?.toUpperCase()}
                </Badge>
                <Badge className={`text-xs ${STATUS_COLORS[detailDispute.status] ?? ""}`} variant="outline">
                  {detailDispute.status?.replace(/_/g, " ")}
                </Badge>
              </div>
              <div>
                <p className="font-black text-lg">{detailDispute.title}</p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{detailDispute.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Station", value: detailDispute.stationName },
                  { label: "Assigned To", value: detailDispute.assignedToName },
                  { label: "Deadline", value: (detailDispute.deadlineAt ?? detailDispute.deadline) ? new Date(detailDispute.deadlineAt ?? detailDispute.deadline).toLocaleDateString("en-KE") : "—" },
                  { label: "Opened", value: detailDispute.createdAt ? new Date(detailDispute.createdAt).toLocaleString("en-KE") : "—" },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="text-sm mt-0.5">{item.value ?? "—"}</p>
                  </div>
                ))}
              </div>

              {/* Evidence */}
              {(detailDispute.evidence ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Evidence ({(detailDispute.evidence as any[]).length})
                  </p>
                  <div className="space-y-2">
                    {(detailDispute.evidence as any[]).map((ev: any, idx: number) => (
                      <div key={idx} className="p-3 border border-border rounded text-sm flex items-start gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">{ev.title ?? ev.fileName ?? "Document"}</p>
                          <p className="text-xs text-muted-foreground">{ev.fileType} · {ev.uploadedByName}</p>
                        </div>
                        {ev.fileUrl && (
                          <a href={ev.fileUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[#1D9BF0] text-xs hover:underline">View</a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Communications Log */}
              {(detailDispute.communications ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> Communications Log
                  </p>
                  <div className="space-y-3">
                    {(detailDispute.communications as any[]).map((msg: any, idx: number) => (
                      <div key={idx} className="p-3 bg-muted rounded text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs">{msg.authorName}</span>
                          <span className="text-xs text-muted-foreground">{msg.createdAt ? new Date(msg.createdAt).toLocaleString("en-KE") : "—"}</span>
                        </div>
                        <p>{msg.content}</p>
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
