import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, User, ChevronLeft, ExternalLink, CheckCircle2, XCircle, AlertCircle, Edit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
  auto_validated: "bg-indigo-100 text-indigo-800",
  verified: "bg-green-100 text-green-800",
  exception: "bg-red-100 text-red-800",
};

function StatusIndicator({ value, label }: { value: boolean | null | undefined; label: string }) {
  if (value === true) return (
    <div className="flex items-center gap-2 text-green-700">
      <CheckCircle2 className="h-4 w-4" />
      <span className="text-sm font-medium">{label} ✓</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <XCircle className="h-4 w-4" />
      <span className="text-sm">{label} — Not set</span>
    </div>
  );
}

// Map DB text fields to booleans for display
function stationBool(val: string | null | undefined, trueVal: string) {
  return val === trueVal;
}

export default function PollingStationDetail() {
  const params = useParams();
  const id = params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assignSheet, setAssignSheet] = useState<"primary" | "backup" | null>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const { data: station, isLoading } = useQuery({
    queryKey: ["polling-station", id],
    queryFn: () =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: submissions } = useQuery({
    queryKey: ["polling-station-submissions", id],
    queryFn: () =>
      fetch(`${BASE}/api/election-results/submissions?pollingStationId=${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: incidents } = useQuery({
    queryKey: ["polling-station-incidents", id],
    queryFn: () =>
      fetch(`${BASE}/api/election-incidents?pollingStationId=${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: agentResults } = useQuery({
    queryKey: ["agents-search", agentSearch],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents?search=${encodeURIComponent(agentSearch)}&limit=20`, { credentials: "include" }).then((r) => r.json()),
    enabled: agentSearch.length > 1,
  });

  const assignMutation = useMutation({
    mutationFn: ({ agentId, isBackup }: { agentId: string; isBackup: boolean }) =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isBackup ? { backupAgentId: agentId } : { primaryAgentId: agentId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-station", id] });
      setAssignSheet(null);
      toast({ title: "Agent assigned successfully" });
    },
    onError: () => toast({ title: "Failed to assign agent", variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (updates: Record<string, string>) =>
      fetch(`${BASE}/api/polling-stations-mgmt/stations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-station", id] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pb-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (!station || station.error) {
    return (
      <div className="space-y-6 pb-8">
        <Button variant="ghost" onClick={() => navigate("/polling-stations")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Polling Stations
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-3" />
          <p>Polling station not found.</p>
        </div>
      </div>
    );
  }

  const agentList: any[] = agentResults?.data ?? [];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/polling-stations")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">{station.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{station.code}</p>
        </div>
      </div>

      {/* Location Hierarchy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#1D9BF0]" /> Location Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: "County", value: station.countyName },
              { label: "Constituency", value: station.constituencyName },
              { label: "Ward", value: station.wardName },
              { label: "Polling Centre", value: station.pollingCentreName },
              { label: "Station Code", value: station.code },
              { label: "Registered Voters", value: station.registeredVoters?.toLocaleString() },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium mt-0.5">{item.value ?? "—"}</p>
              </div>
            ))}
          </div>
          {station.latitude && station.longitude && (
            <div className="mt-4">
              <a
                href={`https://maps.google.com/?q=${station.latitude},${station.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-[#1D9BF0] hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View on Google Maps
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Primary Agent */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2"><User className="h-4 w-4 text-[#1D9BF0]" /> Primary Agent</span>
              <Button size="sm" variant="outline" onClick={() => setAssignSheet("primary")}>
                <Edit className="h-3 w-3 mr-1" /> {station.primaryAgent ? "Reassign" : "Assign"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {station.primaryAgent ? (
              <div className="space-y-2">
                <p className="font-bold">{station.primaryAgent.fullName}</p>
                <p className="text-sm text-muted-foreground">{station.primaryAgent.nationalId}</p>
                <p className="text-sm text-muted-foreground">{station.primaryAgent.phoneNumber}</p>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-sm">No primary agent assigned</p>
            )}
          </CardContent>
        </Card>

        {/* Backup Agent */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-2"><User className="h-4 w-4 text-purple-600" /> Backup Agent</span>
              <Button size="sm" variant="outline" onClick={() => setAssignSheet("backup")}>
                <Edit className="h-3 w-3 mr-1" /> {station.backupAgent ? "Reassign" : "Assign"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {station.backupAgent ? (
              <div className="space-y-2">
                <p className="font-bold">{station.backupAgent.fullName}</p>
                <p className="text-sm text-muted-foreground">{station.backupAgent.nationalId}</p>
                <p className="text-sm text-muted-foreground">{station.backupAgent.phoneNumber}</p>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-sm">No backup agent assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Station Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <StatusIndicator value={station.accreditationStatus === "accredited"} label="Accreditation" />
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => updateStatusMutation.mutate({
                  accreditationStatus: station.accreditationStatus === "accredited" ? "pending" : "accredited",
                })}
              >
                Toggle Accreditation
              </Button>
            </div>
            <div className="space-y-2">
              <StatusIndicator value={station.trainingStatus === "completed"} label="Training" />
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => updateStatusMutation.mutate({
                  trainingStatus: station.trainingStatus === "completed" ? "pending" : "completed",
                })}
              >
                Toggle Training
              </Button>
            </div>
            <div className="space-y-2">
              <StatusIndicator value={station.contactStatus === "active"} label="Contact" />
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => updateStatusMutation.mutate({
                  contactStatus: station.contactStatus === "active" ? "pending" : "active",
                })}
              >
                Toggle Contact
              </Button>
            </div>
            <div className="space-y-2">
              <StatusIndicator value={station.reportingStatus === "reporting"} label="Reporting" />
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => updateStatusMutation.mutate({
                  reportingStatus: station.reportingStatus === "reporting" ? "not_reported" : "reporting",
                })}
              >
                Toggle Reporting
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Result Submissions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Result Submissions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(submissions?.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(submissions?.data ?? []).map((s: any) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/election-results/${s.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{s.id?.slice(0, 8)}…</TableCell>
                    <TableCell className="text-sm">{s.agentName ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleString("en-KE") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                        {s.status?.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Incidents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Incidents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(incidents?.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No incidents reported at this station.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(incidents?.data ?? []).map((inc: any) => (
                  <TableRow key={inc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/election-incidents`)}>
                    <TableCell className="text-xs">{inc.incidentType?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-sm font-medium">{inc.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{inc.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{inc.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Assign Agent Sheet */}
      <Sheet open={assignSheet !== null} onOpenChange={(open) => !open && setAssignSheet(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Assign {assignSheet === "backup" ? "Backup" : "Primary"} Agent</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>Search Agent</Label>
              <Input
                placeholder="Search by name or ID..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
            </div>
            {agentList.length > 0 && (
              <div className="border border-border rounded overflow-hidden">
                {agentList.map((agent: any) => (
                  <button
                    key={agent.id}
                    className={`w-full text-left px-4 py-3 text-sm border-b border-border last:border-0 hover:bg-muted/50 transition-colors ${selectedAgentId === agent.id ? "bg-blue-50 border-l-2 border-l-[#1D9BF0]" : ""}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <p className="font-medium">{agent.fullName}</p>
                    <p className="text-xs text-muted-foreground">{agent.nationalId} · {agent.phoneNumber}</p>
                  </button>
                ))}
              </div>
            )}
            <Button
              className="w-full bg-[#1D9BF0] hover:bg-[#1a8fd1]"
              disabled={!selectedAgentId || assignMutation.isPending}
              onClick={() => assignMutation.mutate({ agentId: selectedAgentId, isBackup: assignSheet === "backup" })}
            >
              {assignMutation.isPending ? "Assigning..." : "Confirm Assignment"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
