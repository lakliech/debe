import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function StatementDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [versionSheetOpen, setVersionSheetOpen] = useState(false);
  const [retractDialogOpen, setRetractDialogOpen] = useState(false);
  const [retractReason, setRetractReason] = useState("");
  const [versionForm, setVersionForm] = useState({ bodyEn: "", bodySw: "", changeNote: "" });

  const { data: statement, isLoading } = useQuery({
    queryKey: ["statement", id],
    queryFn: () =>
      fetch(`${BASE}/api/communications/statements/${id}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["statement", id] });

  const { mutate: publishStatement, isPending: publishing } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/communications/statements/${id}/publish`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Statement published" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: retractStatement, isPending: retracting } = useMutation({
    mutationFn: (reason: string) =>
      fetch(`${BASE}/api/communications/statements/${id}/retract`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Statement retracted" });
      invalidate();
      setRetractDialogOpen(false);
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: addVersion, isPending: addingVersion } = useMutation({
    mutationFn: (body: typeof versionForm) =>
      fetch(`${BASE}/api/communications/statements/${id}/versions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Version added" });
      invalidate();
      setVersionSheetOpen(false);
      setVersionForm({ bodyEn: "", bodySw: "", changeNote: "" });
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

  const stmt = statement ?? {};
  const versions: any[] = Array.isArray(stmt.versions) ? stmt.versions : [];
  const latestVersion = versions.length > 0 ? versions[versions.length - 1] : null;

  return (
    <>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/communications/statements")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Statements
        </button>

        {/* Header Card */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl font-extrabold uppercase tracking-tight">{stmt.title ?? "Statement"}</h1>
            <span className={`px-3 py-1 text-xs font-black uppercase shrink-0 ${STATUS_BADGE[stmt.status] ?? "bg-gray-100 text-gray-700"}`}>
              {stmt.status ?? "—"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Category" value={stmt.category} />
            <Field label="Spokesperson" value={stmt.spokespersonName ?? stmt.spokespersonId} />
            <Field label="Published At" value={stmt.publishedAt ? fmtDate(stmt.publishedAt) : null} />
            <Field label="Created At" value={stmt.createdAt ? fmtDate(stmt.createdAt) : null} />
          </div>
        </div>

        {/* Body */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">Latest Body</h2>
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
              <div className="bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {(latestVersion ?? stmt).bodyEn ?? stmt.bodyEn ?? "—"}
              </div>
            </TabsContent>
            <TabsContent value="sw" className="pt-4">
              <div className="bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {(latestVersion ?? stmt).bodySw ?? stmt.bodySw ?? "—"}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          {stmt.status !== "published" && stmt.status !== "retracted" && (
            <button
              onClick={() => publishStatement()}
              disabled={publishing}
              className="px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Publish
            </button>
          )}
          {stmt.status !== "retracted" && (
            <button
              onClick={() => setRetractDialogOpen(true)}
              className="px-4 py-2 text-sm font-bold border border-red-300 text-red-700 hover:bg-red-50"
            >
              Retract
            </button>
          )}
          <button
            onClick={() => setVersionSheetOpen(true)}
            className="px-4 py-2 text-sm font-bold border border-border hover:bg-muted"
          >
            Add Version
          </button>
        </div>

        {/* Version History */}
        {versions.length > 0 && (
          <div className="bg-card border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Version History</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Version", "Change Note", "Date"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((v: any, i: number) => (
                  <tr key={v.id ?? i} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono font-bold">v{v.version ?? i + 1}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.changeNote ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.createdAt ? fmtDate(v.createdAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Version Sheet */}
      <Sheet open={versionSheetOpen} onOpenChange={setVersionSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add New Version</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Change Note</label>
              <Input value={versionForm.changeNote} onChange={(e) => setVersionForm((f) => ({ ...f, changeNote: e.target.value }))} placeholder="Briefly describe changes..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (English) *</label>
              <Textarea value={versionForm.bodyEn} onChange={(e) => setVersionForm((f) => ({ ...f, bodyEn: e.target.value }))} rows={8} placeholder="Updated statement body..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Body (Swahili)</label>
              <Textarea value={versionForm.bodySw} onChange={(e) => setVersionForm((f) => ({ ...f, bodySw: e.target.value }))} rows={6} placeholder="Taarifa iliyosasishwa..." />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setVersionSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addVersion(versionForm)}
              disabled={addingVersion || !versionForm.bodyEn.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Add Version
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Retract Dialog */}
      <Dialog open={retractDialogOpen} onOpenChange={setRetractDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retract Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="Retraction reason..."
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetractDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={retracting || !retractReason.trim()}
              onClick={() => retractStatement(retractReason)}
            >
              Retract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
