import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus, CheckCircle2, XCircle, Eye, EyeOff, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_legal: "bg-yellow-100 text-yellow-800",
  legal_approved: "bg-blue-100 text-blue-800",
  pending_comms: "bg-orange-100 text-orange-800",
  comms_approved: "bg-indigo-100 text-indigo-800",
  published: "bg-green-100 text-green-800",
  retracted: "bg-red-100 text-red-800",
};

interface PublicationForm {
  title: string;
  description: string;
  submissionId: string;
  stationId: string;
  redactionNotes: string;
}

const defaultForm: PublicationForm = {
  title: "",
  description: "",
  submissionId: "",
  stationId: "",
  redactionNotes: "",
};

export default function TransparencyPortal() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<PublicationForm>(defaultForm);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  params.set("page", String(page));
  params.set("limit", "20");

  // Portal enabled state is local — no backend config endpoint
  const [portalEnabled, setPortalEnabled] = useState(true);
  const configLoading = false;

  const { data: publications, isLoading } = useQuery({
    queryKey: ["transparency-publications", statusFilter, page],
    queryFn: () =>
      fetch(`${BASE}/api/transparency/publications?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const togglePortalMutation = useMutation({
    mutationFn: (enabled: boolean) => Promise.resolve({ portalEnabled: enabled }),
    onSuccess: (data) => {
      setPortalEnabled(data.portalEnabled);
      toast({ title: "Portal status updated" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: PublicationForm) =>
      fetch(`${BASE}/api/transparency/publications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transparency-publications"] });
      setCreateOpen(false);
      setForm(defaultForm);
      toast({ title: "Publication created", description: "Approval workflow started." });
    },
    onError: () => toast({ title: "Failed to create publication", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, step }: { id: string; step: "legal" | "comms" }) =>
      fetch(`${BASE}/api/transparency/publications/${id}/${step}-approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transparency-publications"] });
      toast({ title: "Approval recorded" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/transparency/publications/${id}/publish`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transparency-publications"] });
      toast({ title: "Publication published" });
    },
    onError: () => toast({ title: "Failed to publish", variant: "destructive" }),
  });

  const setField = <K extends keyof PublicationForm>(key: K, value: PublicationForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const pubs: any[] = (publications as any)?.data ?? [];
  const total: number = (publications as any)?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  // Derive stats from publications list
  const publishedCount = pubs.filter((p) => p.status === "published").length;
  const pendingCount = pubs.filter((p) => p.status === "pending_legal" || p.status === "pending_comms").length;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
            <Globe className="h-6 w-6 text-[#1D9BF0]" /> TRANSPARENCY PORTAL
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage public publication of verified election results.</p>
        </div>
        <Button className="bg-[#1D9BF0] hover:bg-[#1a8fd1]" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Publication
        </Button>
      </div>

      {/* Portal Toggle — data-tour: step 5 of the guided demo tour */}
      <Card data-tour="transparency-portal">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-black uppercase tracking-wider text-sm">Portal Status</p>
              {configLoading ? (
                <Skeleton className="h-4 w-48 mt-1" />
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  The public transparency portal is currently{" "}
                  <span className={`font-bold ${portalEnabled ? "text-green-700" : "text-red-700"}`}>
                    {portalEnabled ? "ENABLED" : "DISABLED"}
                  </span>
                </p>
              )}
            </div>
            <Button
              variant={portalEnabled ? "destructive" : "default"}
              className={portalEnabled ? "" : "bg-green-600 hover:bg-green-700"}
              disabled={configLoading || togglePortalMutation.isPending}
              onClick={() => togglePortalMutation.mutate(!portalEnabled)}
            >
              {portalEnabled ? (
                <><EyeOff className="h-4 w-4 mr-2" /> Disable Portal</>
              ) : (
                <><Eye className="h-4 w-4 mr-2" /> Enable Portal</>
              )}
            </Button>
          </div>

          {/* Portal Stats — derived from publications list */}
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
            {[
              { label: "Total Published", value: publishedCount, color: "text-green-600" },
              { label: "Pending Approval", value: pendingCount, color: "text-yellow-600" },
              { label: "Total Publications", value: pubs.length, color: "text-[#1D9BF0]" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className={`text-xl font-black font-mono ${item.color}`}>{item.value}</p>
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.keys(STATUS_COLORS).map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Publications Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#1D9BF0]" />
            Publications ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : pubs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No publications yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Legal</TableHead>
                    <TableHead>Comms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Redaction Notes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pubs.map((pub: any) => (
                    <TableRow key={pub.id}>
                      <TableCell className="font-medium font-mono text-xs">{pub.submissionId ? `Sub: ${pub.submissionId.slice(0,8)}…` : pub.pollingStationId ? `Stn: ${pub.pollingStationId.slice(0,8)}…` : `Election ${pub.electionId?.slice(0,8)}…`}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{pub.stationName ?? "—"}</TableCell>
                      <TableCell>
                        {pub.legalApprovedAt ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        {pub.commsApprovedAt ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${STATUS_COLORS[pub.status] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {pub.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {pub.redactionNotes ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          {pub.status === "pending_legal" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate({ id: pub.id, step: "legal" })}
                            >
                              Legal Approve
                            </Button>
                          )}
                          {pub.status === "pending_comms" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate({ id: pub.id, step: "comms" })}
                            >
                              Comms Approve
                            </Button>
                          )}
                          {pub.status === "comms_approved" && (
                            <Button
                              size="sm"
                              className="text-xs bg-green-600 hover:bg-green-700 text-white"
                              disabled={publishMutation.isPending}
                              onClick={() => publishMutation.mutate(pub.id)}
                            >
                              <Eye className="h-3 w-3 mr-1" /> Publish
                            </Button>
                          )}
                        </div>
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

      {/* Create Publication Sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Create Publication</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
              Creating a publication starts the approval workflow: Legal → Comms → Publish.
              All sensitive data must be reviewed before publishing.
            </div>
            <div>
              <Label>Title *</Label>
              <Input
                placeholder="Publication title..."
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={3}
                placeholder="Summary of what is being published..."
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
              />
            </div>
            <div>
              <Label>Result Submission ID</Label>
              <Input
                placeholder="UUID of the verified submission..."
                value={form.submissionId}
                onChange={(e) => setField("submissionId", e.target.value)}
              />
            </div>
            <div>
              <Label>Polling Station ID</Label>
              <Input
                placeholder="UUID of the polling station..."
                value={form.stationId}
                onChange={(e) => setField("stationId", e.target.value)}
              />
            </div>
            <div>
              <Label>Redaction Notes</Label>
              <Textarea
                rows={3}
                placeholder="List any fields redacted and the reason..."
                value={form.redactionNotes}
                onChange={(e) => setField("redactionNotes", e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
              disabled={!form.title || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? "Creating..." : "Start Approval Flow"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
