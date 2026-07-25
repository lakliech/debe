import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtKES = (x: unknown) => (Number(x) / 1).toLocaleString("en-KE") + " KES";
const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const STATUS_BADGE: Record<string, string> = {
  pending_first: "bg-yellow-100 text-yellow-800",
  pending_final: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  paid: "bg-emerald-100 text-emerald-800",
};

const STATUS_TABS = ["all", "pending_first", "pending_final", "approved", "rejected"];
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  pending_first: "Pending First",
  pending_final: "Pending Final",
  approved: "Approved",
  rejected: "Rejected",
};

const PAGE_SIZE = 20;

type Category = { id: string; name: string };

export default function Expenditure() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState("all");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rejectDialogId, setRejectDialogId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    categoryId: "",
    requestedAmountKes: "",
    payeeName: "",
    payeeBank: "",
    payeeAccountNumber: "",
    payeePhone: "",
  });

  const params = new URLSearchParams();
  if (statusTab !== "all") params.set("status", statusTab);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  const { data, isLoading } = useQuery({
    queryKey: ["expenditure-requests", statusTab, page],
    queryFn: () =>
      fetch(`${BASE}/api/finance/expenditure-requests?${params.toString()}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["budget-categories"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/budget-categories`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["expenditure-requests"] });

  const { mutate: createRequest, isPending: creating } = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/finance/expenditure-requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestedAmountKes: Number(body.requestedAmountKes) }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Request created" });
      invalidate();
      setSheetOpen(false);
      setForm({ title: "", description: "", categoryId: "", requestedAmountKes: "", payeeName: "", payeeBank: "", payeeAccountNumber: "", payeePhone: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: firstApprove } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/finance/expenditure-requests/${id}/first-approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedAmount: null }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "First approval done" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: finalApprove } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/finance/expenditure-requests/${id}/final-approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "bank_transfer" }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Final approval done" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: rejectRequest, isPending: rejecting } = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fetch(`${BASE}/api/finance/expenditure-requests/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Request rejected" });
      invalidate();
      setRejectDialogId(null);
      setRejectReason("");
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const requests = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const catList: Category[] = Array.isArray(categories) ? categories : [];

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">EXPENDITURE REQUESTS</h1>
            <p className="text-muted-foreground text-sm mt-1">Review and approve campaign expenditure requests.</p>
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Request
          </button>
        </div>

        {/* Status Tabs */}
        <div className="flex gap-0 border-b border-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setStatusTab(tab); setPage(1); }}
              className={`px-4 py-2.5 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors ${
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
                  {["Ref #", "Title", "Amount", "Payee", "Status", "Date", "Actions"].map((col) => (
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
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No expenditure requests found.</td>
                  </tr>
                ) : (
                  requests.map((req: any) => (
                    <tr key={req.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{req.referenceNumber ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">{req.title ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-[#1D9BF0] font-bold">{fmtKES(req.requestedAmountKes)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{req.payeeName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${STATUS_BADGE[req.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {(req.status ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{req.createdAt ? fmtDate(req.createdAt) : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {req.status === "pending_first" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="px-2 py-1 text-xs font-bold text-blue-700 border border-blue-300 hover:bg-blue-50">
                                  First Approve
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>First Approval</AlertDialogTitle>
                                  <AlertDialogDescription>Approve "{req.title}" for {fmtKES(req.requestedAmountKes)}?</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => firstApprove(req.id)}>Approve</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          {req.status === "pending_final" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="px-2 py-1 text-xs font-bold text-green-700 border border-green-300 hover:bg-green-50">
                                  Final Approve
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Final Approval</AlertDialogTitle>
                                  <AlertDialogDescription>Authorize payment for "{req.title}"?</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => finalApprove(req.id)} className="bg-green-600 hover:bg-green-700">Authorize</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                          {(req.status === "pending_first" || req.status === "pending_final") && (
                            <button
                              onClick={() => setRejectDialogId(req.id)}
                              className="px-2 py-1 text-xs font-bold text-red-700 border border-red-300 hover:bg-red-50"
                            >
                              Reject
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
              <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
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

      {/* New Request Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Expenditure Request</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Title *</label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Nairobi Rally Transport" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Category</label>
              <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
                <option value="">Select category...</option>
                {catList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Requested Amount (KES) *</label>
              <Input type="number" value={form.requestedAmountKes} onChange={(e) => setForm((f) => ({ ...f, requestedAmountKes: e.target.value }))} placeholder="50000" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Payee Name *</label>
              <Input value={form.payeeName} onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))} placeholder="John Doe / Acme Ltd" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Payee Bank</label>
              <Input value={form.payeeBank} onChange={(e) => setForm((f) => ({ ...f, payeeBank: e.target.value }))} placeholder="Equity Bank" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Account Number</label>
              <Input value={form.payeeAccountNumber} onChange={(e) => setForm((f) => ({ ...f, payeeAccountNumber: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Payee Phone</label>
              <Input value={form.payeePhone} onChange={(e) => setForm((f) => ({ ...f, payeePhone: e.target.value }))} placeholder="+254..." />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createRequest(form)}
              disabled={creating || !form.title.trim() || !form.requestedAmountKes || !form.payeeName.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Submit Request
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(open) => !open && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Please provide a rejection reason.</p>
            <Textarea
              placeholder="Rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejecting || !rejectReason.trim()}
              onClick={() => rejectDialogId && rejectRequest({ id: rejectDialogId, reason: rejectReason })}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
