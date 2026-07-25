import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const TYPE_BADGE: Record<string, string> = {
  rally: "bg-blue-100 text-blue-800",
  baraza: "bg-green-100 text-green-800",
  fundraiser: "bg-yellow-100 text-yellow-800",
  press_conference: "bg-purple-100 text-purple-800",
  training: "bg-indigo-100 text-indigo-800",
  other: "bg-gray-100 text-gray-700",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  active: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-800",
};

const STATUS_TABS = ["all", "draft", "pending_approval", "approved", "active", "completed", "cancelled"];
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const EVENT_TYPES = ["rally", "baraza", "fundraiser", "press_conference", "training", "other"];
const PAGE_SIZE = 20;

export default function EventsManagement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState("all");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    eventType: "rally",
    venue: "",
    countyId: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    expectedAttendance: "",
    budgetKes: "",
  });

  const params = new URLSearchParams();
  if (statusTab !== "all") params.set("status", statusTab);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading } = useQuery({
    queryKey: ["events-mgmt", statusTab, page],
    queryFn: () =>
      fetch(`${BASE}/api/events-mgmt?${params.toString()}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["events-mgmt"] });

  const { mutate: createEvent, isPending: creating } = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/events-mgmt`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          expectedAttendance: Number(body.expectedAttendance) || undefined,
          budgetKes: Number(body.budgetKes) || undefined,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Event created" });
      invalidate();
      setSheetOpen(false);
      setForm({ title: "", description: "", eventType: "rally", venue: "", countyId: "", eventDate: "", startTime: "", endTime: "", expectedAttendance: "", budgetKes: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: submitApproval } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/events-mgmt/${id}/submit-approval`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveEvent } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/events-mgmt/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Event approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const events: any[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">EVENT MANAGEMENT</h1>
            <p className="text-muted-foreground text-sm mt-1">Plan, approve, and manage campaign events.</p>
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Event
          </button>
        </div>

        {/* Status Tabs */}
        <div className="flex flex-wrap gap-0 border-b border-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setStatusTab(tab); setPage(1); }}
              className={`px-3 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
                statusTab === tab
                  ? "border-[#1D9BF0] text-[#1D9BF0]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Title", "Type", "Date", "County", "Expected", "Status", "Registrations", "Actions"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left font-black text-xs uppercase tracking-wider text-muted-foreground">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      No events found.
                    </td>
                  </tr>
                ) : (
                  events.map((evt: any) => (
                    <tr
                      key={evt.id}
                      className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/events-management/${evt.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">{evt.title ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase ${TYPE_BADGE[evt.eventType] ?? "bg-gray-100 text-gray-700"}`}>
                          {(evt.eventType ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{evt.eventDate ? fmtDate(evt.eventDate) : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{evt.countyId ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-sm">{evt.expectedAttendance?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[evt.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {(evt.status ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm">{evt.registrationCount ?? 0}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {evt.status === "draft" && (
                            <button
                              onClick={() => submitApproval(evt.id)}
                              className="px-2 py-1 text-xs font-bold text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
                            >
                              Submit
                            </button>
                          )}
                          {evt.status === "pending_approval" && (
                            <button
                              onClick={() => approveEvent(evt.id)}
                              className="px-2 py-1 text-xs font-bold text-green-700 border border-green-300 hover:bg-green-50"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="px-4 py-3 flex items-center justify-between border-t border-border bg-muted/20 text-sm text-muted-foreground">
              <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-foreground disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>Page {page} / {totalPages || 1}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Event Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Campaign Event</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Title *</label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Event title..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Event Type *</label>
              <select value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Venue</label>
              <Input value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="Venue name and address..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">County ID</label>
              <Input value={form.countyId} onChange={(e) => setForm((f) => ({ ...f, countyId: e.target.value }))} placeholder="e.g. 047" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Event Date *</label>
                <Input type="date" value={form.eventDate} onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Expected Attendance</label>
                <Input type="number" value={form.expectedAttendance} onChange={(e) => setForm((f) => ({ ...f, expectedAttendance: e.target.value }))} placeholder="5000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Start Time</label>
                <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">End Time</label>
                <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Budget (KES)</label>
              <Input type="number" value={form.budgetKes} onChange={(e) => setForm((f) => ({ ...f, budgetKes: e.target.value }))} placeholder="500000" />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createEvent(form)}
              disabled={creating || !form.title.trim() || !form.eventDate}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Create Event
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
