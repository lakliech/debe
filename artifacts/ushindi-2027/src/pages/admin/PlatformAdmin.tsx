/**
 * Platform Admin — cross-tenant operator page.
 *
 * Only users with the platform_admin role (level 0) can access this page.
 * The API enforces the gate; the frontend just renders the 403 gracefully.
 *
 * Features:
 *  - Tenant list: name, slug, plan, created date, user count, status
 *  - New Campaign form: name, slug, admin email → POST /api/platform/tenants
 *  - Tenant detail sheet: branding snapshot, user count, election level, suspend toggle, resend invite
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Shield, Users, Calendar, ChevronRight, AlertCircle, CheckCircle2, XCircle, RefreshCw, Mail, Loader2, Globe, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface TenantRow {
  id: string;
  clerkOrgId: string;
  name: string;
  slug: string;
  plan: string;
  isSuspended: boolean;
  customDomain: string | null;
  createdAt: string;
  userCount: number;
}

interface TenantDetail extends TenantRow {
  branding: {
    campaignName: string;
    candidateName: string;
    electionLevel: string;
    electionYear: number;
    primaryColor: string;
  } | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}/api/platform${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body;
}

// ── New Campaign form ─────────────────────────────────────────────────────────
function NewCampaignForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", slug: "", adminEmail: "" });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/tenants", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      toast({
        title: "Campaign created",
        description: data.message ?? "New campaign is ready.",
      });
      setForm({ name: "", slug: "", adminEmail: "" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create campaign", description: err.message, variant: "destructive" });
    },
  });

  const slugify = (val: string) =>
    val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  return (
    <div className="space-y-4 p-6 border border-border rounded-sm bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-lg">New Campaign</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="font-semibold">Campaign name</Label>
          <Input
            value={form.name}
            placeholder="e.g. Amina for Nairobi"
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, slug: slugify(name) }));
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="font-semibold">Slug</Label>
          <Input
            value={form.slug}
            placeholder="e.g. amina-nairobi"
            onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Lowercase, hyphens only. Used in URLs and the API.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="font-semibold">Admin email <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          type="email"
          value={form.adminEmail}
          placeholder="admin@campaign.ke"
          onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          They'll receive a Clerk org invitation to become the campaign's admin. You can skip this and invite later.
        </p>
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={!form.name || !form.slug || mutation.isPending}
        className="gap-2"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {mutation.isPending ? "Creating…" : "Create campaign"}
      </Button>
    </div>
  );
}

// ── Tenant detail sheet ───────────────────────────────────────────────────────
const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? "ushindi.app";

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-center gap-2 bg-muted/40 rounded border border-border px-3 py-2">
      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 font-mono text-xs text-primary underline underline-offset-2 truncate"
      >
        {url}
      </a>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy link"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function TenantDetail({ tenant, onClose }: { tenant: TenantRow; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: detail, isLoading } = useQuery<TenantDetail>({
    queryKey: ["platform-tenant-detail", tenant.id],
    queryFn: () => apiFetch(`/tenants/${tenant.id}`),
  });

  const suspendMutation = useMutation({
    mutationFn: (isSuspended: boolean) =>
      apiFetch(`/tenants/${tenant.id}/suspend`, {
        method: "PATCH",
        body: JSON.stringify({ isSuspended }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      qc.invalidateQueries({ queryKey: ["platform-tenant-detail", tenant.id] });
      toast({ title: "Tenant status updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/tenants/${tenant.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ adminEmail: inviteEmail }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Invitation sent", description: data.message });
      setInviteEmail("");
    },
    onError: (err: any) => toast({ title: "Invite failed", description: err.message, variant: "destructive" }),
  });

  const d = detail ?? tenant as unknown as TenantDetail;
  const branding = d.branding;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <aside className="w-full max-w-xl bg-background border-l border-border overflow-y-auto p-6 space-y-6 flex flex-col">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{tenant.name}</h2>
            <p className="text-sm text-muted-foreground font-mono">{tenant.slug}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>

        {/* Status strip */}
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{d.userCount ?? "—"}</span>
            <span className="text-muted-foreground">users</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Created {new Date(d.createdAt).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          <Badge variant="outline" className="font-mono text-xs">{d.plan}</Badge>
          {d.isSuspended ? (
            <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Suspended</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-green-500 text-green-600"><CheckCircle2 className="h-3 w-3" /> Active</Badge>
          )}
        </div>

        {/* Branding snapshot */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading branding…
          </div>
        ) : branding ? (
          <div className="rounded-sm border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase mb-3">Branding Snapshot</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Candidate</p>
                <p className="font-semibold">{branding.candidateName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Campaign name</p>
                <p className="font-semibold">{branding.campaignName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Election level</p>
                <p className="font-semibold">{branding.electionLevel ?? "Presidential"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Election year</p>
                <p className="font-semibold">{branding.electionYear}</p>
              </div>
            </div>
            {branding.primaryColor && (
              <div className="flex items-center gap-2 mt-2">
                <div
                  className="h-5 w-5 rounded border border-border"
                  style={{ backgroundColor: branding.primaryColor.startsWith("#") ? branding.primaryColor : `hsl(${branding.primaryColor})` }}
                />
                <span className="text-xs font-mono text-muted-foreground">{branding.primaryColor}</span>
                <span className="text-xs text-muted-foreground">primary</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">No branding configured yet.</div>
        )}

        {/* Suspend toggle */}
        <div className="rounded-sm border border-border p-4 space-y-2">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase mb-2">Account Status</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">{d.isSuspended ? "Campaign suspended" : "Campaign active"}</p>
              <p className="text-xs text-muted-foreground">
                {d.isSuspended
                  ? "All API access is blocked. Data is preserved."
                  : "Toggle to block all API access for this campaign without deleting data."}
              </p>
            </div>
            <Switch
              checked={d.isSuspended}
              onCheckedChange={(checked) => suspendMutation.mutate(checked)}
              disabled={suspendMutation.isPending}
              className="data-[state=checked]:bg-destructive"
            />
          </div>
        </div>

        {/* Invite / resend */}
        <div className="rounded-sm border border-border p-4 space-y-3">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Invite Admin</p>
          <p className="text-xs text-muted-foreground">
            Send a Clerk org invitation. The recipient joins the campaign's organisation and can be assigned campaign roles from the Users page.
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="admin@campaign.ke"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              disabled={!inviteEmail || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </div>

        {/* Public portal URL */}
        <div className="rounded-sm border border-border p-4 space-y-2">
          <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Public Portal URL</p>
          <p className="text-xs text-muted-foreground">
            Share this link with the campaign team. It routes visitors to this campaign automatically via subdomain.
          </p>
          <CopyableUrl url={`https://${tenant.slug}.${PORTAL_DOMAIN}`} />
          {d.customDomain && (
            <div className="pt-1 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom Domain</p>
              <CopyableUrl url={`https://${d.customDomain}`} />
            </div>
          )}
        </div>

        {/* Clerk org ID — useful for debugging */}
        <div className="text-xs text-muted-foreground font-mono border-t border-border pt-4">
          Clerk org: <span className="select-all">{d.clerkOrgId}</span>
        </div>
      </aside>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PlatformAdmin() {
  const { toast } = useToast();
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);

  const { data: tenants, isLoading, isError, error, refetch } = useQuery<TenantRow[]>({
    queryKey: ["platform-tenants"],
    queryFn: () => apiFetch("/tenants"),
    retry: false,
  });

  // 403 = not a platform admin
  if (isError) {
    const msg = (error as any)?.message ?? "";
    const isForbidden = msg.includes("Forbidden") || msg.includes("403");
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
        <Shield className="h-16 w-16 text-muted-foreground/30" />
        <h1 className="text-2xl font-extrabold">
          {isForbidden ? "Access Restricted" : "Error loading tenants"}
        </h1>
        <p className="text-muted-foreground max-w-md">
          {isForbidden
            ? "The Platform Admin area is only accessible to platform operators with the platform_admin role."
            : msg}
        </p>
        {!isForbidden && (
          <Button variant="outline" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Platform Admin</h1>
          <p className="text-muted-foreground mt-1">
            Manage campaign tenants — create new campaigns, view tenant details, and suspend access.
          </p>
        </div>
        <Button onClick={() => setShowNewForm((v) => !v)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          {showNewForm ? "Cancel" : "New Campaign"}
        </Button>
      </div>

      {/* New campaign form */}
      {showNewForm && (
        <NewCampaignForm onSuccess={() => setShowNewForm(false)} />
      )}

      {/* Tenant table */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading tenants…
        </div>
      ) : !tenants?.length ? (
        <div className="border border-dashed border-border rounded-sm p-12 text-center text-muted-foreground">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No campaigns yet</p>
          <p className="text-sm mt-1">Create the first campaign to get started.</p>
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase">Campaign</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden sm:table-cell">Slug</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden md:table-cell">Plan</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden lg:table-cell">Created</th>
                <th className="px-4 py-3 text-right font-black text-xs tracking-widest text-muted-foreground uppercase">Users</th>
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t, i) => (
                <tr
                  key={t.id}
                  className={cn(
                    "transition-colors cursor-pointer hover:bg-muted/30",
                    i < tenants.length - 1 && "border-b border-border"
                  )}
                  onClick={() => setSelectedTenant(t)}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{t.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden sm:table-cell">{t.slug}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Badge variant="outline" className="font-mono text-xs capitalize">{t.plan}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {new Date(t.createdAt).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{t.userCount}</td>
                  <td className="px-4 py-3">
                    {t.isSuspended ? (
                      <Badge variant="destructive" className="gap-1 text-xs">
                        <AlertCircle className="h-3 w-3" /> Suspended
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-xs border-green-500 text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground inline-block" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tenant detail sheet */}
      {selectedTenant && (
        <TenantDetail tenant={selectedTenant} onClose={() => setSelectedTenant(null)} />
      )}
    </div>
  );
}
