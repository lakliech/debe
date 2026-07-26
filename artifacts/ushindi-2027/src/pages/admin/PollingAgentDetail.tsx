import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, User, AlertCircle, CheckCircle2, XCircle, ExternalLink, Shield, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default function PollingAgentDetail() {
  const params = useParams();
  const id = params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: agent, isLoading } = useQuery({
    queryKey: ["polling-agent", id],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: courses } = useQuery({
    queryKey: ["agent-training", id],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents/${id}/training`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: replacements } = useQuery({
    queryKey: ["agent-replacements", id],
    queryFn: () =>
      fetch(`${BASE}/api/polling-agents/replacements?agentId=${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const signCodeMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/polling-agents/${id}/code-of-conduct`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-agent", id] });
      toast({ title: "Code of conduct accepted" });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const allowanceMutation = useMutation({
    mutationFn: (_action: "approve") =>
      fetch(`${BASE}/api/polling-agents/${id}/allowance/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polling-agent", id] });
      toast({ title: "Allowance updated" });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pb-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!agent || agent.error) {
    return (
      <div className="space-y-6 pb-8">
        <Button variant="ghost" onClick={() => navigate("/polling-agents")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Agents
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-3" />
          <p>Agent not found.</p>
        </div>
      </div>
    );
  }

  const courseList: any[] = Array.isArray(courses) ? courses : [];
  const replacementList: any[] = Array.isArray(replacements) ? replacements : [];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/polling-agents")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">{agent.fullName}</h1>
          <p className="text-sm text-muted-foreground font-mono">{agent.nationalId}</p>
        </div>
        <Badge className={`ml-auto text-sm ${ACCREDITATION_COLORS[agent.accreditationStatus] ?? ""}`} variant="outline">
          {agent.accreditationStatus ?? "pending"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <User className="h-4 w-4 text-[#1D9BF0]" /> Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agent.photoUrl && (
              <img
                src={agent.photoUrl}
                alt={agent.fullName}
                className="w-20 h-20 rounded object-cover border border-border"
              />
            )}
            {!agent.photoUrl && (
              <div className="w-20 h-20 rounded bg-muted flex items-center justify-center">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "National ID", value: agent.nationalId },
                { label: "Phone Number", value: agent.phoneNumber },
                { label: "Role", value: agent.isBackup ? "Backup Agent" : "Primary Agent" },
                { label: "Status", value: agent.status },
                { label: "Registered", value: agent.createdAt ? new Date(agent.createdAt).toLocaleDateString("en-KE") : "—" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium mt-0.5">{item.value ?? "—"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Assignment */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider">Station Assignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agent.pollingStation ? (
              <div className="space-y-2">
                <p className="font-bold">{agent.pollingStation.name}</p>
                <p className="text-sm text-muted-foreground font-mono">{agent.pollingStation.code}</p>
                <p className="text-sm text-muted-foreground">{agent.pollingStation.constituencyName} · {agent.pollingStation.wardName}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/polling-stations/${agent.pollingStation.id}`)}
                >
                  <ExternalLink className="h-3 w-3 mr-1" /> View Station
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-sm">Not assigned to a station</p>
            )}

            {/* Election Day Attendance */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Election Day Attendance</p>
              <div className="flex items-center gap-2">
                {agent.attendedElectionDay === true ? (
                  <><CheckCircle2 className="h-4 w-4 text-green-600" /><span className="text-sm text-green-700 font-medium">Present on election day</span></>
                ) : agent.attendedElectionDay === false ? (
                  <><XCircle className="h-4 w-4 text-red-600" /><span className="text-sm text-red-700 font-medium">Absent on election day</span></>
                ) : (
                  <span className="text-sm text-muted-foreground">Not recorded</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Code of Conduct & Allowance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#1D9BF0]" /> Code of Conduct
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              {agent.codeOfConductAccepted ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /><span className="font-medium text-green-700">Accepted</span></>
              ) : (
                <><XCircle className="h-5 w-5 text-muted-foreground" /><span className="text-muted-foreground">Not yet accepted</span></>
              )}
            </div>
            {agent.codeOfConductDate && (
              <p className="text-xs text-muted-foreground">
                Accepted on {new Date(agent.codeOfConductDate).toLocaleString("en-KE")}
              </p>
            )}
            {!agent.codeOfConductAccepted && (
              <Button
                size="sm"
                className="bg-[#1D9BF0] hover:bg-[#1a8fd1]"
                disabled={signCodeMutation.isPending}
                onClick={() => signCodeMutation.mutate()}
              >
                Mark as Accepted
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[#1D9BF0]" /> Allowance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // allowances[] is included in the agent detail response
              const latestAllowance = (agent.allowances ?? [])[0];
              const allowanceStatus = latestAllowance?.status ?? (agent.allowancePaid ? "paid" : "pending");
              const allowanceAmountKes = latestAllowance?.amountKes;
              return (
                <>
                  <div className="flex items-center gap-3">
                    <Badge className={`${ALLOWANCE_COLORS[allowanceStatus] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                      {allowanceStatus}
                    </Badge>
                    {allowanceAmountKes && (
                      <span className="font-mono font-bold">KES {Number(allowanceAmountKes).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {allowanceStatus === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={allowanceMutation.isPending}
                        onClick={() => allowanceMutation.mutate("approve")}
                      >
                        Approve
                      </Button>
                    )}
                    {/* "Mark as Paid" is handled by finance — only approve is available here */}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Training Courses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider">Training Courses</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {courseList.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No training courses enrolled.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Quiz Score</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courseList.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.courseName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{c.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.progress != null ? `${c.progress}%` : "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{c.quizScore != null ? `${c.quizScore}%` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.completedAt ? new Date(c.completedAt).toLocaleDateString("en-KE") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Replacement History */}
      {replacementList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider">Replacement History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Replaced By</TableHead>
                  <TableHead>Approved By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replacementList.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-KE") : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.replacedByName ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.approvedByName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
