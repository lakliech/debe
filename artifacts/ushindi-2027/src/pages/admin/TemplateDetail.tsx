import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-800",
};

const CHANNEL_BADGE: Record<string, string> = {
  sms: "bg-green-100 text-green-800",
  email: "bg-blue-100 text-blue-800",
  whatsapp: "bg-emerald-100 text-emerald-800",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function TemplateDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({ segmentId: "", scheduledAt: "", languageCode: "en" });

  const { data: template, isLoading } = useQuery({
    queryKey: ["template", id],
    queryFn: () =>
      fetch(`${BASE}/api/communications/templates/${id}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!id,
  });

  const { data: segments } = useQuery({
    queryKey: ["segments"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/segments`, { credentials: "include" }).then((r) => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["template", id] });

  const { mutate: submitTemplate, isPending: submitting } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/communications/templates/${id}/submit`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveTemplate, isPending: approving } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/communications/templates/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Template approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: suspendTemplate, isPending: suspending } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/communications/templates/${id}/suspend`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Suspended by admin" }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Template suspended" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: scheduleMessage, isPending: scheduling } = useMutation({
    mutationFn: (body: typeof schedForm) =>
      fetch(`${BASE}/api/communications/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: id, ...body }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Message scheduled" });
      setScheduleOpen(false);
      setSchedForm({ segmentId: "", scheduledAt: "", languageCode: "en" });
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

  const tmpl = template ?? {};
  const segmentList: any[] = Array.isArray(segments) ? segments : [];

  return (
    <>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/communications/templates")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Templates
        </button>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold uppercase tracking-tight">{tmpl.name ?? "Template"}</h1>
          <span className={`px-3 py-1 text-xs font-black uppercase ${STATUS_BADGE[tmpl.status] ?? "bg-gray-100 text-gray-700"}`}>
            {tmpl.status ?? "—"}
          </span>
        </div>

        {/* Detail Card */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Channel</p>
              <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-bold uppercase ${CHANNEL_BADGE[tmpl.channel] ?? "bg-gray-100 text-gray-700"}`}>
                {tmpl.channel ?? "—"}
              </span>
            </div>
            <Field label="Category" value={(tmpl.category ?? "—").replace(/_/g, " ")} />
            {tmpl.channel === "email" && <div className="col-span-2"><Field label="Subject (EN)" value={tmpl.subjectEn} /></div>}
          </div>

          <Tabs defaultValue="en">
            <TabsList className="border-b border-border bg-transparent h-auto p-0 gap-0">
              {[{ value: "en", label: "English" }, { value: "sw", label: "Swahili" }].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent data-[state=active]:border-[#1D9BF0] data-[state=active]:text-[#1D9BF0] rounded-none bg-transparent"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="en" className="pt-4">
              <div className="bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono">
                {tmpl.bodyEn ?? "—"}
              </div>
            </TabsContent>
            <TabsContent value="sw" className="pt-4">
              <div className="bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono">
                {tmpl.bodySw ?? "—"}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          {tmpl.status === "draft" && (
            <button
              onClick={() => submitTemplate()}
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold border border-yellow-300 text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
            >
              Submit for Approval
            </button>
          )}
          {tmpl.status === "pending_approval" && (
            <button
              onClick={() => approveTemplate()}
              disabled={approving}
              className="px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve Template
            </button>
          )}
          {tmpl.status === "approved" && (
            <>
              <button
                onClick={() => setScheduleOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-[#1D9BF0] text-white hover:bg-[#1A8CD8]"
              >
                <Send className="h-4 w-4" />
                Schedule Message
              </button>
              <button
                onClick={() => suspendTemplate()}
                disabled={suspending}
                className="px-4 py-2 text-sm font-bold border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Suspend
              </button>
            </>
          )}
        </div>
      </div>

      {/* Schedule Message Sheet */}
      <Sheet open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Schedule Message</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Segment</label>
              <select
                value={schedForm.segmentId}
                onChange={(e) => setSchedForm((f) => ({ ...f, segmentId: e.target.value }))}
                className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
              >
                <option value="">Select segment...</option>
                {segmentList.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name ?? s.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Scheduled At *</label>
              <input
                type="datetime-local"
                value={schedForm.scheduledAt}
                onChange={(e) => setSchedForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Language</label>
              <select
                value={schedForm.languageCode}
                onChange={(e) => setSchedForm((f) => ({ ...f, languageCode: e.target.value }))}
                className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
              >
                <option value="en">English</option>
                <option value="sw">Swahili</option>
              </select>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              onClick={() => scheduleMessage(schedForm)}
              disabled={scheduling || !schedForm.scheduledAt}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Schedule
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
