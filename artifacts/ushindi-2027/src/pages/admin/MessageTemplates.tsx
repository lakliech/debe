import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CHANNEL_BADGE: Record<string, string> = {
  sms: "bg-green-100 text-green-800",
  email: "bg-blue-100 text-blue-800",
  whatsapp: "bg-emerald-100 text-emerald-800",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-800",
};

const CATEGORIES = ["fundraising", "mobilisation", "event_invite", "training", "general", "emergency"];

export default function MessageTemplates() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    channel: "sms",
    category: "general",
    bodyEn: "",
    bodySw: "",
    subjectEn: "",
  });

  const params = new URLSearchParams();
  if (channelFilter) params.set("channel", channelFilter);
  if (statusFilter) params.set("status", statusFilter);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates", channelFilter, statusFilter],
    queryFn: () =>
      fetch(`${BASE}/api/communications/templates?${params.toString()}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["templates"] });

  const { mutate: createTemplate, isPending: creating } = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/communications/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Template created" });
      invalidate();
      setSheetOpen(false);
      setForm({ name: "", channel: "sms", category: "general", bodyEn: "", bodySw: "", subjectEn: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: submitTemplate } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/communications/templates/${id}/submit`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveTemplate } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/communications/templates/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Template approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: suspendTemplate } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fetch(`${BASE}/api/communications/templates/${id}/suspend`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Template suspended" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const templateList: any[] = Array.isArray(templates) ? templates : [];

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">MESSAGE TEMPLATES</h1>
            <p className="text-muted-foreground text-sm mt-1">Create and manage communication templates.</p>
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Template
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Channels</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {/* Template Cards Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : templateList.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center text-muted-foreground">
            <p className="font-medium">No templates found.</p>
            <p className="text-sm mt-1">Create your first template to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templateList.map((tmpl: any) => (
              <div key={tmpl.id} className="bg-card border border-border p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => setLocation(`/communications/templates/${tmpl.id}`)}
                    className="font-bold text-sm hover:text-[#1D9BF0] transition-colors text-left"
                  >
                    {tmpl.name ?? "Unnamed"}
                  </button>
                  <span className={`px-2 py-0.5 text-xs font-black uppercase tracking-wider shrink-0 ${STATUS_BADGE[tmpl.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {tmpl.status ?? "—"}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 text-xs font-bold uppercase ${CHANNEL_BADGE[tmpl.channel] ?? "bg-gray-100 text-gray-700"}`}>
                    {tmpl.channel ?? "—"}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-bold bg-muted text-muted-foreground uppercase">
                    {(tmpl.category ?? "—").replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {(tmpl.bodyEn ?? "").substring(0, 80)}{tmpl.bodyEn?.length > 80 ? "…" : ""}
                </p>
                <div className="flex gap-2 mt-auto pt-2 border-t border-border">
                  {tmpl.status === "draft" && (
                    <button
                      onClick={() => submitTemplate(tmpl.id)}
                      className="flex-1 py-1.5 text-xs font-bold border border-yellow-300 text-yellow-700 hover:bg-yellow-50 transition-colors"
                    >
                      Submit
                    </button>
                  )}
                  {tmpl.status === "pending_approval" && (
                    <button
                      onClick={() => approveTemplate(tmpl.id)}
                      className="flex-1 py-1.5 text-xs font-bold border border-green-300 text-green-700 hover:bg-green-50 transition-colors"
                    >
                      Approve
                    </button>
                  )}
                  {tmpl.status === "approved" && (
                    <button
                      onClick={() => suspendTemplate({ id: tmpl.id, reason: "Suspended by admin" })}
                      className="flex-1 py-1.5 text-xs font-bold border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                    >
                      Suspend
                    </button>
                  )}
                  <button
                    onClick={() => setLocation(`/communications/templates/${tmpl.id}`)}
                    className="flex-1 py-1.5 text-xs font-bold border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Template Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Message Template</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Name *</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Template name..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Channel *</label>
              <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Category *</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            {form.channel === "email" && (
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Subject (EN)</label>
                <Input value={form.subjectEn} onChange={(e) => setForm((f) => ({ ...f, subjectEn: e.target.value }))} placeholder="Email subject..." />
              </div>
            )}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (English) *</label>
              <Textarea value={form.bodyEn} onChange={(e) => setForm((f) => ({ ...f, bodyEn: e.target.value }))} rows={5} placeholder="Message body in English..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (Swahili)</label>
              <Textarea value={form.bodySw} onChange={(e) => setForm((f) => ({ ...f, bodySw: e.target.value }))} rows={5} placeholder="Ujumbe kwa Kiswahili..." />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createTemplate(form)}
              disabled={creating || !form.name.trim() || !form.bodyEn.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Create Template
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
