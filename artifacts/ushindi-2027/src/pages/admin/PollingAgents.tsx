import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Users, Plus, Search, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GeoCascadeSelect } from "@/components/GeoCascadeSelect";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ACCREDITATION_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accredited: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  suspended: "bg-orange-100 text-orange-800",
};

const ALLOWANCE_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

interface AgentForm {
  fullName: string;
  nationalId: string;
  phoneNumber: string;
  photoUrl: string;
  pollingStationId: string;
  isBackup: boolean;
  userId: string;
}

const defaultForm: AgentForm = {
  fullName: "",
  nationalId: "",
  phoneNumber: "",
  photoUrl: "",
  pollingStationId: "",
  isBackup: false,
  userId: "",
};

export default function PollingAgents() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accreditationFilter, setAccreditationFilter] = useState("all");
  const [trainingFilter, setTrainingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<AgentForm>(defaultForm);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (accreditationFilter !== "all") params.set("accreditationStatus", accreditationFilter);
  if (trainingFilter !== "all") params.set("trainingStatus", trainingFilter);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading } = useQuery({
    queryKey: ["polling-agents", search, statusFilter, accreditationFilter, trainingFilter, page],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: AgentForm) =>
      fetch(`${BASE}/api/polling-agents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-agents"] });
      setSheetOpen(false);
      setForm(defaultForm);
      toast({ title: "Agent registered", description: "Polling agent has been registered." });
    },
    onError: () => toast({ title: "Failed to register agent", variant: "destructive" }),
  });

  const agents: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  const setField = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">POLLING AGENTS</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage election day agents and their accreditation.</p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button className="bg-[#1D9BF0] hover:bg-[#1a8fd1]">
              <Plus className="h-4 w-4 mr-2" /> Register Agent
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Register Polling Agent</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div>
                <Label>Full Name *</Label>
                <Input
                  placeholder="Jane Wanjiku Mwangi"
                  value={form.fullName}
                  onChange={(e) => setField("fullName", e.target.value)}
                />
              </div>
              <div>
                <Label>National ID *</Label>
                <Input
                  placeholder="12345678"
                  value={form.nationalId}
                  onChange={(e) => setField("nationalId", e.target.value)}
                />
              </div>
              <div>
                <Label>Phone Number *</Label>
                <Input
                  placeholder="+254712345678"
                  value={form.phoneNumber}
                  onChange={(e) => setField("phoneNumber", e.target.value)}
                />
              </div>
              <div>
                <Label>Photo URL</Label>
                <Input
                  placeholder="https://..."
                  value={form.photoUrl}
                  onChange={(e) => setField("photoUrl", e.target.value)}
                />
              </div>
              <div>
                <Label>Polling Station</Label>
                <GeoCascadeSelect
                  level="station"
                  value={form.pollingStationId}
                  onChange={(id) => setField("pollingStationId", id)}
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={form.isBackup ? "backup" : "primary"}
                  onValueChange={(v) => setField("isBackup", v === "backup")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary Agent</SelectItem>
                    <SelectItem value="backup">Backup Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>User ID (optional)</Label>
                <Input
                  placeholder="Link to user account..."
                  value={form.userId}
                  onChange={(e) => setField("userId", e.target.value)}
                />
              </div>
            </div>
            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button
                className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
                disabled={!form.fullName || !form.nationalId || !form.phoneNumber || !form.pollingStationId || createMutation.isPending}
                onClick={() => createMutation.mutate(form)}
              >
                {createMutation.isPending ? "Registering..." : "Register Agent"}
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
            placeholder="Search by name, ID or phone..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={accreditationFilter} onValueChange={(v) => { setAccreditationFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Accreditation" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accreditation</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="accredited">Accredited</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={trainingFilter} onValueChange={(v) => { setTrainingFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Training" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Training</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
            <SelectItem value="not_started">Not Started</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4 text-[#1D9BF0]" />
            Agents ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No agents found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Training %</TableHead>
                    <TableHead>Accreditation</TableHead>
                    <TableHead>Code of Conduct</TableHead>
                    <TableHead>Allowance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent: any) => (
                    <TableRow
                      key={agent.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/polling-agents/${agent.id}`)}
                    >
                      <TableCell className="font-medium">{agent.fullName}</TableCell>
                      <TableCell className="font-mono text-xs">{agent.nationalId}</TableCell>
                      <TableCell className="text-sm">{agent.phoneNumber}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{agent.stationName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {agent.isBackup ? "Backup" : "Primary"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {agent.trainingProgress != null ? `${agent.trainingProgress}%` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${ACCREDITATION_COLORS[agent.accreditationStatus] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {agent.accreditationStatus ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {agent.codeOfConductSigned ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${ALLOWANCE_COLORS[agent.allowanceStatus] ?? "bg-gray-100 text-gray-700"}`}
                          variant="outline"
                        >
                          {agent.allowanceStatus ?? "pending"}
                        </Badge>
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
