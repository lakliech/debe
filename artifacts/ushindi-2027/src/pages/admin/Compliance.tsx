import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, AlertTriangle, Building2, FileSearch, Users, BookOpen,
  Clock, CheckCircle2, XCircle, Plus, ChevronRight, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fetchJson(url: string) {
  return fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

async function postJson(url: string, body: object) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return r.json();
}

async function patchJson(url: string, body: object) {
  const r = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return r.json();
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  open: "bg-red-100 text-red-800",
  contained: "bg-orange-100 text-orange-800",
  resolved: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-700",
  under_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  requires_remediation: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Dashboard Cards ────────────────────────────────────────────────────────
function DashboardSummary() {
  const { data } = useQuery({
    queryKey: ["compliance-dashboard"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/dashboard`),
  });

  const cards = [
    {
      label: "Data Subject Requests",
      value: data?.dataSubjectRequests?.total ?? "—",
      sub: `${data?.dataSubjectRequests?.pending ?? 0} pending`,
      icon: Users,
      color: "text-blue-600",
    },
    {
      label: "Open DPIAs",
      value: data?.dpias?.open ?? "—",
      sub: `${data?.dpias?.total ?? 0} total`,
      icon: FileSearch,
      color: "text-purple-600",
    },
    {
      label: "Active Vendors",
      value: data?.vendors?.active ?? "—",
      sub: "in vendor register",
      icon: Building2,
      color: "text-emerald-600",
    },
    {
      label: "Open Breaches",
      value: data?.breaches?.open ?? "—",
      sub: "require action",
      icon: AlertTriangle,
      color: data?.breaches?.open > 0 ? "text-red-600" : "text-gray-400",
    },
    {
      label: "Retention Policies",
      value: data?.retentionPolicies?.active ?? "—",
      sub: "active policies",
      icon: BookOpen,
      color: "text-amber-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
              </div>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Data Subject Requests tab ──────────────────────────────────────────────
function DataSubjectRequestsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    requestType: "access", subjectName: "", subjectEmail: "", subjectPhone: "", description: "",
  });

  const { data } = useQuery({
    queryKey: ["compliance-dsr"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/data-requests`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => postJson(`${BASE}/api/compliance/data-requests`, body),
    onSuccess: () => {
      toast({ title: "Request created" });
      qc.invalidateQueries({ queryKey: ["compliance-dsr"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [k: string]: any }) =>
      patchJson(`${BASE}/api/compliance/data-requests/${id}`, body),
    onSuccess: () => {
      toast({ title: "Request updated" });
      qc.invalidateQueries({ queryKey: ["compliance-dsr"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} requests total</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Request</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Data Subject Request</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Request Type</Label>
                <Select value={form.requestType}
                  onValueChange={(v) => setForm((p) => ({ ...p, requestType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["access", "correction", "deletion", "portability", "restriction"].map((t) => (
                      <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Full Name</Label>
                <Input value={form.subjectName} onChange={(e) => setForm((p) => ({ ...p, subjectName: e.target.value }))} /></div>
              <div><Label>Email</Label>
                <Input type="email" value={form.subjectEmail} onChange={(e) => setForm((p) => ({ ...p, subjectEmail: e.target.value }))} /></div>
              <div><Label>Phone (optional)</Label>
                <Input value={form.subjectPhone} onChange={(e) => setForm((p) => ({ ...p, subjectPhone: e.target.value }))} /></div>
              <div><Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No requests yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-md px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{row.subjectName}</span>
                <Badge variant="outline" className="text-xs capitalize">{row.requestType}</Badge>
                <StatusBadge status={row.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{row.subjectEmail}</p>
              {row.deadlineAt && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  Deadline: {new Date(row.deadlineAt).toLocaleDateString()}
                </p>
              )}
            </div>
            {row.status === "pending" && (
              <Button size="sm" variant="outline"
                onClick={() => updateMut.mutate({ id: row.id, status: "in_review" })}>
                Start Review
              </Button>
            )}
            {row.status === "in_review" && (
              <Button size="sm" onClick={() => updateMut.mutate({ id: row.id, status: "completed", completionNotes: "Completed." })}>
                Mark Complete
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DPIA Register tab ──────────────────────────────────────────────────────
function DpiaTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", riskLevel: "medium", riskDescription: "", mitigationMeasures: "" });

  const { data } = useQuery({
    queryKey: ["compliance-dpia"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/dpia`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => postJson(`${BASE}/api/compliance/dpia`, body),
    onSuccess: () => {
      toast({ title: "DPIA created" });
      qc.invalidateQueries({ queryKey: ["compliance-dpia"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [k: string]: any }) =>
      patchJson(`${BASE}/api/compliance/dpia/${id}`, body),
    onSuccess: () => {
      toast({ title: "DPIA updated" });
      qc.invalidateQueries({ queryKey: ["compliance-dpia"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} DPIAs total</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New DPIA</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Data Protection Impact Assessment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></div>
              <div><Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} /></div>
              <div>
                <Label>Risk Level</Label>
                <Select value={form.riskLevel} onValueChange={(v) => setForm((p) => ({ ...p, riskLevel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "critical"].map((r) => (
                      <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Risk Description</Label>
                <Textarea value={form.riskDescription} onChange={(e) => setForm((p) => ({ ...p, riskDescription: e.target.value }))} rows={2} /></div>
              <div><Label>Mitigation Measures</Label>
                <Textarea value={form.mitigationMeasures} onChange={(e) => setForm((p) => ({ ...p, mitigationMeasures: e.target.value }))} rows={2} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No DPIAs yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-md px-4 py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{row.title}</span>
                <StatusBadge status={row.status} />
                <Badge variant="outline" className="text-xs capitalize">{row.riskLevel} risk</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.description}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {row.status === "draft" && (
                <Button size="sm" variant="outline"
                  onClick={() => updateMut.mutate({ id: row.id, status: "under_review" })}>
                  Send for Review
                </Button>
              )}
              {row.status === "under_review" && (
                <Button size="sm"
                  onClick={() => updateMut.mutate({ id: row.id, status: "approved" })}>
                  Approve
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Breach Register tab ────────────────────────────────────────────────────
function BreachRegisterTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", severity: "medium", rootCause: "",
    estimatedRecordsAffected: "", discoveredAt: new Date().toISOString().split("T")[0],
  });

  const { data } = useQuery({
    queryKey: ["compliance-breaches"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/breaches`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => postJson(`${BASE}/api/compliance/breaches`, body),
    onSuccess: () => {
      toast({ title: "Breach recorded" });
      qc.invalidateQueries({ queryKey: ["compliance-breaches"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; [k: string]: any }) =>
      patchJson(`${BASE}/api/compliance/breaches/${id}`, body),
    onSuccess: () => {
      toast({ title: "Breach updated" });
      qc.invalidateQueries({ queryKey: ["compliance-breaches"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} breach records</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive"><Plus className="h-4 w-4 mr-1" /> Log Breach</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Log Data Breach</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></div>
              <div><Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} /></div>
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((p) => ({ ...p, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "critical"].map((s) => (
                      <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Date Discovered</Label>
                <Input type="date" value={form.discoveredAt}
                  onChange={(e) => setForm((p) => ({ ...p, discoveredAt: e.target.value }))} /></div>
              <div><Label>Records Affected (est.)</Label>
                <Input type="number" value={form.estimatedRecordsAffected}
                  onChange={(e) => setForm((p) => ({ ...p, estimatedRecordsAffected: e.target.value }))} /></div>
              <div><Label>Root Cause</Label>
                <Textarea value={form.rootCause} onChange={(e) => setForm((p) => ({ ...p, rootCause: e.target.value }))} rows={2} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={createMut.isPending} variant="destructive"
                onClick={() => createMut.mutate({
                  ...form,
                  estimatedRecordsAffected: form.estimatedRecordsAffected
                    ? parseInt(form.estimatedRecordsAffected) : undefined,
                })}>
                {createMut.isPending ? "Saving…" : "Log Breach"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No breach records. Good.</p>}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-md px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="font-medium text-sm">{row.title}</span>
                  <StatusBadge status={row.status} />
                  <Badge variant="outline" className="text-xs capitalize">{row.severity}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{row.description}</p>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  {row.estimatedRecordsAffected && (
                    <span>~{row.estimatedRecordsAffected.toLocaleString()} records</span>
                  )}
                  <span className={row.notifiedDpa ? "text-green-600" : "text-red-500"}>
                    DPA: {row.notifiedDpa ? "Notified" : "Not notified"}
                  </span>
                </div>
              </div>
              {row.status === "open" && (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline"
                    onClick={() => updateMut.mutate({ id: row.id, notifiedDpa: true })}>
                    Notify DPA
                  </Button>
                  <Button size="sm"
                    onClick={() => updateMut.mutate({ id: row.id, status: "contained", containedAt: new Date().toISOString() })}>
                    Mark Contained
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Vendor Register tab ────────────────────────────────────────────────────
function VendorRegisterTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    vendorName: "", vendorType: "saas", servicesProvided: "", countryOfOperation: "Kenya",
    riskRating: "low", adequacyDecision: true,
  });

  const { data } = useQuery({
    queryKey: ["compliance-vendors"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/vendors`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => postJson(`${BASE}/api/compliance/vendors`, body),
    onSuccess: () => {
      toast({ title: "Vendor added" });
      qc.invalidateQueries({ queryKey: ["compliance-vendors"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{data?.total ?? 0} vendors</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Vendor</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Vendor Name</Label>
                <Input value={form.vendorName} onChange={(e) => setForm((p) => ({ ...p, vendorName: e.target.value }))} /></div>
              <div>
                <Label>Type</Label>
                <Select value={form.vendorType} onValueChange={(v) => setForm((p) => ({ ...p, vendorType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["cloud", "saas", "payment", "analytics", "comms", "other"].map((t) => (
                      <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Services Provided</Label>
                <Textarea value={form.servicesProvided} onChange={(e) => setForm((p) => ({ ...p, servicesProvided: e.target.value }))} rows={2} /></div>
              <div><Label>Country of Operation</Label>
                <Input value={form.countryOfOperation} onChange={(e) => setForm((p) => ({ ...p, countryOfOperation: e.target.value }))} /></div>
              <div>
                <Label>Risk Rating</Label>
                <Select value={form.riskRating} onValueChange={(v) => setForm((p) => ({ ...p, riskRating: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high"].map((r) => (
                      <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={createMut.isPending} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? "Saving…" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No vendors registered yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-md px-4 py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{row.vendorName}</span>
                <Badge variant="outline" className="text-xs">{row.vendorType?.toUpperCase()}</Badge>
                <span className={`text-xs font-medium ${
                  row.riskRating === "high" ? "text-red-600" :
                  row.riskRating === "medium" ? "text-amber-600" : "text-green-600"
                }`}>{row.riskRating} risk</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{row.servicesProvided}</p>
              <p className="text-xs text-muted-foreground">{row.countryOfOperation}</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {row.dpaSignedAt ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              )}
              DPA
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Retention Policies tab ─────────────────────────────────────────────────
function RetentionPoliciesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    dataCategory: "volunteers", retentionDays: "1095", legalBasis: "consent",
    description: "", autoDelete: false,
  });

  const { data } = useQuery({
    queryKey: ["compliance-retention"],
    queryFn: () => fetchJson(`${BASE}/api/compliance/retention-policies`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => postJson(`${BASE}/api/compliance/retention-policies`, body),
    onSuccess: () => {
      toast({ title: "Policy created" });
      qc.invalidateQueries({ queryKey: ["compliance-retention"] });
      qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{rows.length} active policies</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Policy</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Retention Policy</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Data Category</Label>
                <Select value={form.dataCategory} onValueChange={(v) => setForm((p) => ({ ...p, dataCategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["volunteers", "supporters", "donors", "agents", "results", "audit_logs", "financial"].map((c) => (
                      <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Retention Period (days)</Label>
                <Input type="number" value={form.retentionDays}
                  onChange={(e) => setForm((p) => ({ ...p, retentionDays: e.target.value }))} /></div>
              <div>
                <Label>Legal Basis</Label>
                <Select value={form.legalBasis} onValueChange={(v) => setForm((p) => ({ ...p, legalBasis: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["consent", "legitimate_interest", "contract", "legal_obligation"].map((b) => (
                      <SelectItem key={b} value={b}>{b.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={createMut.isPending}
                onClick={() => createMut.mutate({ ...form, retentionDays: parseInt(form.retentionDays) })}>
                {createMut.isPending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No retention policies yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="border rounded-md px-4 py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm capitalize">{row.dataCategory?.replace(/_/g, " ")}</span>
                <Badge variant="outline" className="text-xs">{Math.round(row.retentionDays / 365)} yrs</Badge>
                <span className="text-xs text-muted-foreground capitalize">{row.legalBasis?.replace(/_/g, " ")}</span>
              </div>
              {row.description && <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.autoDelete ? (
                <span className="text-amber-600">Auto-delete enabled</span>
              ) : (
                <span>Manual review</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Data Protection & Compliance
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            GDPR-aligned compliance register — DSRs, DPIAs, vendor management, breach register & retention policies.
          </p>
        </div>
      </div>

      <DashboardSummary />

      <Tabs defaultValue="dsr">
        <TabsList>
          <TabsTrigger value="dsr">Data Subject Requests</TabsTrigger>
          <TabsTrigger value="dpia">DPIAs</TabsTrigger>
          <TabsTrigger value="breaches">Breach Register</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="retention">Retention Policies</TabsTrigger>
        </TabsList>
        <TabsContent value="dsr" className="mt-4"><DataSubjectRequestsTab /></TabsContent>
        <TabsContent value="dpia" className="mt-4"><DpiaTab /></TabsContent>
        <TabsContent value="breaches" className="mt-4"><BreachRegisterTab /></TabsContent>
        <TabsContent value="vendors" className="mt-4"><VendorRegisterTab /></TabsContent>
        <TabsContent value="retention" className="mt-4"><RetentionPoliciesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
