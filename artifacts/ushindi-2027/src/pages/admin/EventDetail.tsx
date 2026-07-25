import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CheckCircle2, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  active: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};

const TYPE_BADGE: Record<string, string> = {
  rally: "bg-blue-100 text-blue-800",
  baraza: "bg-green-100 text-green-800",
  fundraiser: "bg-yellow-100 text-yellow-800",
  press_conference: "bg-purple-100 text-purple-800",
  training: "bg-indigo-100 text-indigo-800",
  other: "bg-gray-100 text-gray-700",
};

const SEVERITY_BADGE: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function EventDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [checkInCode, setCheckInCode] = useState("");
  const [incidentSheetOpen, setIncidentSheetOpen] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ incidentType: "", severity: "low", description: "", location: "" });

  const { data: event, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: () =>
      fetch(`${BASE}/api/events-mgmt/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: registrations, isLoading: regLoading } = useQuery({
    queryKey: ["event-registrations", id],
    queryFn: () =>
      fetch(`${BASE}/api/events-mgmt/${id}/registrations?page=1&limit=50`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: !!id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["event", id] });

  const { mutate: submitApproval, isPending: submitting } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/events-mgmt/${id}/submit-approval`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveEvent, isPending: approving } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/events-mgmt/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Event approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const [checkInResult, setCheckInResult] = useState<string | null>(null);
  const { mutate: checkIn, isPending: checkingIn } = useMutation({
    mutationFn: (code: string) =>
      fetch(`${BASE}/api/events-mgmt/${id}/check-in`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCode: code }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setCheckInResult(data?.message ?? "Check-in successful");
      toast({ title: "Check-in successful", description: data?.fullName ?? "" });
      setCheckInCode("");
      qc.invalidateQueries({ queryKey: ["event-registrations", id] });
    },
    onError: () => {
      setCheckInResult("Check-in failed. Invalid code or already checked in.");
      toast({ title: "Check-in failed", variant: "destructive" });
    },
  });

  const { mutate: reportIncident, isPending: reporting } = useMutation({
    mutationFn: (body: typeof incidentForm) =>
      fetch(`${BASE}/api/events-mgmt/${id}/incidents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Incident reported" });
      invalidate();
      setIncidentSheetOpen(false);
      setIncidentForm({ incidentType: "", severity: "low", description: "", location: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  if (isLoading) {
    return (
        <div className="space-y-4 animate-pulse">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48 w-full" />
        </div>
    );
  }

  const evt = event ?? {};
  const speakers: any[] = Array.isArray(evt.speakers) ? evt.speakers : [];
  const incidents: any[] = Array.isArray(evt.incidents) ? evt.incidents : [];
  const regList: any[] = Array.isArray(registrations?.data) ? registrations.data : Array.isArray(registrations) ? registrations : [];

  return (
    <>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/events-management")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Events
        </button>

        {/* Header */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl font-extrabold uppercase tracking-tight">{evt.title ?? "Event"}</h1>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-0.5 text-xs font-bold uppercase ${TYPE_BADGE[evt.eventType] ?? "bg-gray-100 text-gray-700"}`}>
                {(evt.eventType ?? "—").replace(/_/g, " ")}
              </span>
              <span className={`px-3 py-1 text-xs font-black uppercase ${STATUS_BADGE[evt.status] ?? "bg-gray-100 text-gray-700"}`}>
                {(evt.status ?? "—").replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Venue" value={evt.venue} />
            <Field label="Date" value={evt.eventDate ? fmtDate(evt.eventDate) : null} />
            <Field label="Expected Attendance" value={evt.expectedAttendance?.toLocaleString()} />
            <Field label="Registrations" value={String(evt.registrationCount ?? 0)} />
          </div>
        </div>

        {/* Status Actions */}
        <div className="flex gap-3">
          {evt.status === "draft" && (
            <button
              onClick={() => submitApproval()}
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50"
            >
              Submit for Approval
            </button>
          )}
          {evt.status === "pending_approval" && (
            <button
              onClick={() => approveEvent()}
              disabled={approving}
              className="px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve Event
            </button>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="border-b border-border bg-transparent h-auto p-0 gap-0">
            {["OVERVIEW", "REGISTRATIONS", "CHECK-IN", "INCIDENTS"].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab.toLowerCase().replace("-", "_")}
                className="px-4 py-3 text-sm font-bold border-b-2 border-transparent data-[state=active]:border-[#1D9BF0] data-[state=active]:text-[#1D9BF0] rounded-none bg-transparent"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="pt-6 space-y-4">
            {evt.description && (
              <div className="bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">{evt.description}</p>
              </div>
            )}
            {speakers.length > 0 && (
              <div className="border border-border overflow-hidden">
                <div className="p-3 bg-muted/50 border-b border-border">
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Speakers</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Order", "Name", "Title", "Topic", "Minutes"].map((col) => (
                        <th key={col} className="px-4 py-2 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {speakers.map((spk: any, i: number) => (
                      <tr key={spk.id ?? i} className="border-t border-border">
                        <td className="px-4 py-2 font-mono">{spk.talkOrder ?? i + 1}</td>
                        <td className="px-4 py-2 font-medium">{spk.fullName ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">{spk.title ?? "—"}</td>
                        <td className="px-4 py-2">{spk.topicEn ?? "—"}</td>
                        <td className="px-4 py-2">{spk.allocatedMinutes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* Registrations */}
          <TabsContent value="registrations" className="pt-6">
            <div className="border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {["Name", "Phone", "Type", "Checked In"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 4 }).map((__, j) => (
                          <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : regList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No registrations yet.</td>
                    </tr>
                  ) : (
                    regList.map((reg: any) => (
                      <tr key={reg.id} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{reg.fullName ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{reg.phone ?? "—"}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="bg-muted px-2 py-0.5 font-bold uppercase">{reg.registrationType ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {reg.checkedIn ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="text-xs font-bold">{reg.checkedInAt ? fmtDate(reg.checkedInAt) : "Yes"}</span>
                            </div>
                          ) : (
                            <Minus className="h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Check-In */}
          <TabsContent value="check_in" className="pt-6">
            <div className="max-w-md space-y-4">
              <p className="text-sm text-muted-foreground">Enter a QR code or Registration ID to check in an attendee.</p>
              <div className="flex gap-3">
                <Input
                  value={checkInCode}
                  onChange={(e) => setCheckInCode(e.target.value)}
                  placeholder="QR code or Registration ID..."
                  onKeyDown={(e) => e.key === "Enter" && checkInCode && checkIn(checkInCode)}
                />
                <button
                  onClick={() => checkIn(checkInCode)}
                  disabled={checkingIn || !checkInCode.trim()}
                  className="px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] disabled:opacity-50 whitespace-nowrap"
                >
                  Check In
                </button>
              </div>
              {checkInResult && (
                <div className={`p-3 border text-sm font-medium ${checkInResult.includes("failed") || checkInResult.includes("Invalid") ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"}`}>
                  {checkInResult}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Incidents */}
          <TabsContent value="incidents" className="pt-6 space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setIncidentSheetOpen(true)}
                className="px-4 py-2 text-sm font-bold bg-red-600 text-white hover:bg-red-700"
              >
                Report Incident
              </button>
            </div>
            {incidents.length === 0 ? (
              <p className="text-muted-foreground text-sm">No incidents reported.</p>
            ) : (
              <div className="space-y-3">
                {incidents.map((inc: any, i: number) => (
                  <div key={inc.id ?? i} className="border border-border p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-2 py-0.5 text-xs font-black uppercase ${SEVERITY_BADGE[inc.severity] ?? "bg-gray-100 text-gray-700"}`}>
                        {inc.severity ?? "—"}
                      </span>
                      <span className="text-xs font-bold text-muted-foreground uppercase">{inc.incidentType ?? "—"}</span>
                    </div>
                    <p className="text-sm">{inc.description ?? "—"}</p>
                    {inc.location && <p className="text-xs text-muted-foreground mt-1">📍 {inc.location}</p>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Report Incident Sheet */}
      <Sheet open={incidentSheetOpen} onOpenChange={setIncidentSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Report Incident</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Incident Type *</label>
              <Input value={incidentForm.incidentType} onChange={(e) => setIncidentForm((f) => ({ ...f, incidentType: e.target.value }))} placeholder="e.g. security, medical, crowd..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Severity</label>
              <select value={incidentForm.severity} onChange={(e) => setIncidentForm((f) => ({ ...f, severity: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Description *</label>
              <Textarea value={incidentForm.description} onChange={(e) => setIncidentForm((f) => ({ ...f, description: e.target.value }))} rows={4} placeholder="Describe the incident..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Location</label>
              <Input value={incidentForm.location} onChange={(e) => setIncidentForm((f) => ({ ...f, location: e.target.value }))} placeholder="Where did it occur?" />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setIncidentSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => reportIncident(incidentForm)}
              disabled={reporting || !incidentForm.incidentType.trim() || !incidentForm.description.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              Report Incident
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
