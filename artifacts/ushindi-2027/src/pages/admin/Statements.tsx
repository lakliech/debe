import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-emerald-100 text-emerald-800",
  retracted: "bg-red-100 text-red-900",
};

const CATEGORIES = [
  "policy", "economy", "security", "environment", "health", "education",
  "corruption", "elections", "general",
];

const STATUS_TABS = ["all", "draft", "review", "approved", "published", "retracted"];

export default function Statements() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [retractDialogId, setRetractDialogId] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState("");
  const [form, setForm] = useState({
    title: "",
    category: "general",
    spokespersonId: "",
    bodyEn: "",
    bodySw: "",
  });

  const params = new URLSearchParams();
  if (statusTab !== "all") params.set("status", statusTab);
  if (categoryFilter) params.set("category", categoryFilter);

  const { data: statements, isLoading } = useQuery({
    queryKey: ["statements", statusTab, categoryFilter],
    queryFn: () =>
      fetch(`${BASE}/api/communications/statements?${params.toString()}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const { data: spokespeople } = useQuery({
    queryKey: ["spokespeople"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/spokespeople`, { credentials: "include" }).then((r) => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["statements"] });

  const { mutate: createStatement, isPending: creating } = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/communications/statements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Statement created" });
      invalidate();
      setSheetOpen(false);
      setForm({ title: "", category: "general", spokespersonId: "", bodyEn: "", bodySw: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: publishStatement } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/communications/statements/${id}/publish`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Statement published" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: retractStatement, isPending: retracting } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fetch(`${BASE}/api/communications/statements/${id}/retract`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Statement retracted" });
      invalidate();
      setRetractDialogId(null);
      setRetractReason("");
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const statementList: any[] = Array.isArray(statements) ? statements : [];
  const spokespeopleList: any[] = Array.isArray(spokespeople) ? spokespeople : [];

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">PRESS STATEMENTS & SPEECHES</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage official campaign communications.</p>
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Statement
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0 border-b border-border">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusTab(tab)}
                className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                  statusTab === tab
                    ? "border-[#1D9BF0] text-[#1D9BF0]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["Title", "Category", "Status", "Spokesperson", "Date", "Actions"].map((col) => (
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
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : statementList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No statements found.</td>
                  </tr>
                ) : (
                  statementList.map((stmt: any) => (
                    <tr key={stmt.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setLocation(`/communications/statements/${stmt.id}`)}
                          className="font-medium hover:text-[#1D9BF0] transition-colors text-left"
                        >
                          {stmt.title ?? "—"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 text-xs font-bold bg-muted text-muted-foreground uppercase">
                          {stmt.category ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[stmt.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {stmt.status ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-sm">{stmt.spokespersonName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{stmt.createdAt ? fmtDate(stmt.createdAt) : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {(stmt.status === "approved" || stmt.status === "draft") && stmt.status !== "published" && (
                            <button
                              onClick={() => publishStatement(stmt.id)}
                              className="px-2 py-1 text-xs font-bold text-green-700 border border-green-300 hover:bg-green-50"
                            >
                              Publish
                            </button>
                          )}
                          {stmt.status !== "retracted" && (
                            <button
                              onClick={() => setRetractDialogId(stmt.id)}
                              className="px-2 py-1 text-xs font-bold text-red-700 border border-red-300 hover:bg-red-50"
                            >
                              Retract
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
        </div>
      </div>

      {/* New Statement Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Press Statement</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Title *</label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Statement title..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Category *</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Spokesperson</label>
              <select value={form.spokespersonId} onChange={(e) => setForm((f) => ({ ...f, spokespersonId: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                <option value="">Select spokesperson...</option>
                {spokespeopleList.map((s: any) => <option key={s.id} value={s.id}>{s.fullName ?? s.name ?? s.id}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (English) *</label>
              <Textarea value={form.bodyEn} onChange={(e) => setForm((f) => ({ ...f, bodyEn: e.target.value }))} rows={7} placeholder="Statement body in English..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (Swahili)</label>
              <Textarea value={form.bodySw} onChange={(e) => setForm((f) => ({ ...f, bodySw: e.target.value }))} rows={7} placeholder="Taarifa kwa Kiswahili..." />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createStatement(form)}
              disabled={creating || !form.title.trim() || !form.bodyEn.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Create Statement
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Retract Dialog */}
      <Dialog open={!!retractDialogId} onOpenChange={(open) => !open && setRetractDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retract Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Please provide a reason for retraction.</p>
            <Textarea
              placeholder="Retraction reason..."
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetractDialogId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={retracting || !retractReason.trim()}
              onClick={() => retractDialogId && retractStatement({ id: retractDialogId, reason: retractReason })}
            >
              Retract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
