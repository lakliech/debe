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
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { CampaignScopeFields, scopeComplete, type ScopeSelection } from "@/components/CampaignScopeFields";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Shield, Users, Calendar, ChevronRight, AlertCircle, CheckCircle2, XCircle, RefreshCw, Mail, Loader2, Globe, Copy, Check, LockKeyhole, Clock as ClockIcon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  /** Tier in force today — a lapsed grant or trial reads back as "free". */
  effectivePlan?: PlanTier;
  /** True while an unpaid override (a trial) is what grants the plan. */
  isTrial?: boolean;
  trialDaysLeft?: number | null;
  planOverrideUntil?: string | null;
  /** Stripe subscription state, or null for a campaign that never subscribed. */
  subscriptionStatus: string | null;
  isSuspended: boolean;
  customDomain: string | null;
  tlsStatus: "pending" | "active" | "error" | null;
  createdAt: string;
  userCount: number;
}

type PlanTier = "free" | "pro" | "enterprise";

/**
 * Stripe subscription state, at a glance.
 *
 * Colour carries the operational meaning: past_due and unpaid are the two that
 * need someone to chase a customer before access lapses, so they are the two
 * that must be visible without opening a row. A campaign with no subscription
 * at all is not a problem — it is simply on the free tier or a manual grant.
 */
function SubscriptionBadge({ status }: { status: string | null | undefined }) {
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone: Record<string, string> = {
    active: "border-green-500 text-green-600",
    trialing: "border-primary text-primary",
    past_due: "border-amber-500 text-amber-600",
    unpaid: "border-red-500 text-red-600",
    canceled: "border-muted-foreground/40 text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-xs capitalize", tone[status] ?? "text-muted-foreground")}
      data-testid={`badge-subscription-${status}`}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

const PLAN_TIERS: { value: PlanTier; label: string; blurb: string }[] = [
  { value: "free", label: "Free", blurb: "1 campaign, up to 50 agents, no custom domain or Excel export" },
  { value: "pro", label: "Pro", blurb: "Unlimited agents, custom domain, full reporting" },
  { value: "enterprise", label: "Enterprise", blurb: "White-label mobile build and a dedicated support SLA" },
];

interface TenantEmailLog {
  id: string;
  recipient: string;
  template: string;
  subject: string | null;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  sentAt: string;
}

interface TenantDetail extends TenantRow {
  effectivePlanLabel?: string;
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
const slugify = (val: string) =>
  val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

function NewCampaignForm({
  onSuccess,
  initial,
  enquiryId,
}: {
  onSuccess: () => void;
  /** Pre-filled fields when creating from a Request Access enquiry. */
  initial?: { name: string; adminEmail: string };
  /** Links the new campaign to its enquiry; the server marks it converted. */
  enquiryId?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    name: initial?.name ?? "",
    slug: slugify(initial?.name ?? ""),
    adminEmail: initial?.adminEmail ?? "",
  }));
  const [scope, setScope] = useState<ScopeSelection>({ seatType: "", countyId: "", constituencyId: "", wardId: "" });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/tenants", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          seatType: scope.seatType,
          scopeCountyId: scope.countyId || undefined,
          scopeConstituencyId: scope.constituencyId || undefined,
          scopeWardId: scope.wardId || undefined,
          ...(enquiryId ? { enquiryId } : {}),
        }),
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      if (data.enquiryConverted) qc.invalidateQueries({ queryKey: ["platform-enquiries"] });
      toast({
        title: "Campaign created",
        description:
          (data.message ?? "New campaign is ready.") +
          (data.enquiryConverted ? " The enquiry has been marked converted." : ""),
      });
      setForm({ name: "", slug: "", adminEmail: "" });
      setScope({ seatType: "", countyId: "", constituencyId: "", wardId: "" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create campaign", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 p-6 border border-border rounded-sm bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-lg">New Campaign</h3>
      </div>

      {enquiryId && (
        <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-sm px-3 py-2">
          Creating from an enquiry — it will be marked <span className="font-semibold">converted</span> automatically when the campaign is created.
        </p>
      )}

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

      <div className="border-t border-border pt-4">
        <CampaignScopeFields value={scope} onChange={setScope} />
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={!form.name || !form.slug || !scopeComplete(scope) || mutation.isPending}
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

/**
 * Manual plan control for platform operators.
 *
 * Paid tiers are granted for a fixed number of months rather than forever:
 * the API records the grant as an override that lapses, so a comped campaign
 * cannot quietly keep Enterprise features for the rest of time. Moving a
 * campaign back to Free clears the grant immediately.
 */
function PlanPanel({
  detail,
  onChange,
  pending,
  onExtendTrial,
  extending,
}: {
  detail: TenantDetail;
  onChange: (plan: PlanTier, months?: number) => void;
  pending: boolean;
  onExtendTrial: (days: number) => void;
  extending: boolean;
}) {
  const stored = (detail.plan ?? "free") as PlanTier;
  const [plan, setPlan] = useState<PlanTier>(stored);
  const [months, setMonths] = useState("12");
  const [trialDays, setTrialDays] = useState("7");

  const selected = PLAN_TIERS.find((p) => p.value === plan) ?? PLAN_TIERS[0];
  const dirty = plan !== stored;
  const effective = detail.effectivePlan ?? stored;
  const lapsed = effective !== stored;
  // A Stripe subscription — including one in its own Stripe trial — grants the
  // plan on its own, so the override this panel writes would be inert.
  const paying =
    detail.subscriptionStatus === "active" || detail.subscriptionStatus === "trialing";

  return (
    <div className="rounded-sm border border-border p-4 space-y-3">
      <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Billing Plan</p>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">In force today:</span>
        <Badge variant="outline" className="font-mono">{effective}</Badge>
        {detail.subscriptionStatus && (
          <span className="text-muted-foreground">
            Stripe: <span className="font-mono">{detail.subscriptionStatus}</span>
          </span>
        )}
        {detail.isTrial && <Badge variant="outline" className="border-primary text-primary">Trial</Badge>}
        {lapsed && (
          <span className="text-muted-foreground">
            (bought <span className="font-mono">{stored}</span> — grant has lapsed)
          </span>
        )}
        {detail.planOverrideUntil && !lapsed && (
          <span className="text-muted-foreground">
            until {new Date(detail.planOverrideUntil).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Plan</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as PlanTier)}>
            <SelectTrigger data-testid="select-tenant-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_TIERS.map((tier) => (
                <SelectItem key={tier.value} value={tier.value}>{tier.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {plan !== "free" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Duration (months)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              data-testid="input-tenant-plan-months"
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{selected.blurb}</p>

      <Button
        size="sm"
        disabled={!dirty || pending}
        onClick={() => onChange(plan, plan === "free" ? undefined : Number(months))}
        data-testid="button-save-tenant-plan"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {plan === "free" ? "Move to Free" : `Grant ${selected.label}`}
      </Button>

      {/*
        Extending a trial is a different act from granting a plan: it is days,
        not months, and it keeps the campaign in the trial funnel instead of
        recording them as comped. Granting Pro "for a month" to buy someone a
        few extra days is what this exists to stop.
      */}
      <div className="pt-3 border-t border-border space-y-2">
        <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Trial</p>
        {paying ? (
          <p className="text-xs text-muted-foreground">
            This campaign pays through Stripe ({detail.subscriptionStatus}), so its access is
            governed there — there is no trial to extend.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {detail.isTrial && detail.trialDaysLeft != null
                ? `On trial with ${detail.trialDaysLeft} day${detail.trialDaysLeft === 1 ? "" : "s"} left — extra days are added on top.`
                : "No trial running. Extending starts a fresh Pro trial from today."}
            </p>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Extra days</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="w-28"
                  data-testid="input-extend-trial-days"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={extending || !(Number(trialDays) >= 1 && Number(trialDays) <= 90)}
                onClick={() => onExtendTrial(Number(trialDays))}
                data-testid="button-extend-trial"
              >
                {extending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Extend trial
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Email log ─────────────────────────────────────────────────────────────────
// "We never got the email" is one of the most common support openers, and the
// answer is usually one of three very different things: it was never attempted,
// it was skipped because no provider is configured in this environment, or the
// provider rejected it. Show the status verbatim rather than collapsing them.
const EMAIL_STATUS_STYLES: Record<string, string> = {
  sent: "border-green-500 text-green-600",
  failed: "border-destructive text-destructive",
  skipped: "border-amber-500 text-amber-600",
};

/** Template keys are stable identifiers; give operators readable labels. */
function templateLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function EmailLogPanel({ tenantId }: { tenantId: string }) {
  const { data, isLoading, isError } = useQuery<{ emails: TenantEmailLog[] }>({
    queryKey: ["platform-tenant-emails", tenantId],
    queryFn: () => apiFetch(`/tenants/${tenantId}/emails?limit=20`),
  });

  const emails = data?.emails ?? [];

  return (
    <div className="rounded-sm border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Email Log</p>
        <span className="text-[10px] text-muted-foreground">Last 20</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading email log…
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load the email log.</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No transactional email has been sent to this campaign yet.
        </p>
      ) : (
        <ul className="divide-y divide-border -mx-1">
          {emails.map((e) => (
            <li key={e.id} className="px-1 py-2.5 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-tight">
                  {e.subject || templateLabel(e.template)}
                </p>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 text-[10px] capitalize", EMAIL_STATUS_STYLES[e.status])}
                >
                  {e.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span className="font-mono">{e.recipient}</span>
                <span>·</span>
                <span>{templateLabel(e.template)}</span>
                <span>·</span>
                <span>
                  {new Date(e.sentAt).toLocaleString("en-KE", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {e.error && (
                <p className="text-xs text-destructive font-mono break-all">{e.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
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

  const planMutation = useMutation({
    mutationFn: ({ plan, months }: { plan: PlanTier; months?: number }) =>
      apiFetch(`/tenants/${tenant.id}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan, months }),
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      qc.invalidateQueries({ queryKey: ["platform-tenant-detail", tenant.id] });
      toast({ title: "Plan updated", description: data?.message });
    },
    onError: (err: any) => toast({ title: "Plan change failed", description: err.message, variant: "destructive" }),
  });

  const trialMutation = useMutation({
    mutationFn: (days: number) =>
      apiFetch(`/tenants/${tenant.id}/trial`, {
        method: "PATCH",
        body: JSON.stringify({ days }),
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      qc.invalidateQueries({ queryKey: ["platform-tenant-detail", tenant.id] });
      toast({ title: "Trial extended", description: data?.message });
    },
    onError: (err: any) =>
      toast({ title: "Could not extend trial", description: err.message, variant: "destructive" }),
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
          <SubscriptionBadge status={d.subscriptionStatus} />
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

        {/* Plan */}
        <PlanPanel
          detail={d}
          onChange={(plan, months) => planMutation.mutate({ plan, months })}
          pending={planMutation.isPending}
          onExtendTrial={(days) => trialMutation.mutate(days)}
          extending={trialMutation.isPending}
        />

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
            Grants campaign administrator access and emails the recipient. They must already have an account — ask them to sign up first if they don't.
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

        {/* Email log */}
        <EmailLogPanel tenantId={tenant.id} />

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
              {/* TLS status badge */}
              {d.tlsStatus === "active" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                  <LockKeyhole className="h-3.5 w-3.5" /> TLS active
                </span>
              )}
              {d.tlsStatus === "pending" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                  <ClockIcon className="h-3.5 w-3.5 animate-pulse" /> TLS provisioning…
                </span>
              )}
              {d.tlsStatus === "error" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                  <Lock className="h-3.5 w-3.5" /> TLS error
                </span>
              )}
            </div>
          )}
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
  const [enquiryPrefill, setEnquiryPrefill] = useState<{ enquiryId: string; name: string; adminEmail: string } | null>(null);
  const search = useSearch();
  const [, navigate] = useLocation();

  // Deep link — /platform-admin?convert=<enquiryId>&name=…&email=… opens the
  // New Campaign form pre-filled from an enquiry (linked from the Enquiries
  // inbox). Params are consumed once so a refresh doesn't trap the operator.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const convertId = params.get("convert");
    if (!convertId) return;
    setEnquiryPrefill({
      enquiryId: convertId,
      name: params.get("name") ?? "",
      adminEmail: params.get("email") ?? "",
    });
    setShowNewForm(true);
    navigate("/platform-admin", { replace: true });
  }, [search, navigate]);

  const toggleNewForm = () =>
    setShowNewForm((v) => {
      if (v) setEnquiryPrefill(null); // closing the form drops any prefill
      return !v;
    });

  const { data: tenants, isLoading, isError, error, refetch } = useQuery<TenantRow[]>({
    queryKey: ["platform-tenants"],
    queryFn: () => apiFetch("/tenants"),
    retry: false,
  });

  // Deep link — /platform-admin?tenant=<id|slug> opens the detail sheet
  // directly. The billing dashboard's rows link here so "open this campaign"
  // is one click from the revenue table.
  useEffect(() => {
    if (!tenants) return;
    const target = new URLSearchParams(search).get("tenant");
    if (!target || selectedTenant?.id === target || selectedTenant?.slug === target) return;
    const match = tenants.find((t) => t.id === target || t.slug === target);
    if (match) setSelectedTenant(match);
  }, [tenants, search, selectedTenant]);

  const closeDetail = () => {
    setSelectedTenant(null);
    if (new URLSearchParams(search).get("tenant")) navigate("/platform-admin");
  };

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
        <Button onClick={toggleNewForm} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          {showNewForm ? "Cancel" : "New Campaign"}
        </Button>
      </div>

      {/* New campaign form */}
      {showNewForm && (
        <NewCampaignForm
          initial={enquiryPrefill ? { name: enquiryPrefill.name, adminEmail: enquiryPrefill.adminEmail } : undefined}
          enquiryId={enquiryPrefill?.enquiryId}
          onSuccess={() => { setShowNewForm(false); setEnquiryPrefill(null); }}
        />
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
                <th className="px-4 py-3 text-left font-black text-xs tracking-widest text-muted-foreground uppercase hidden md:table-cell">Subscription</th>
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="font-mono text-xs capitalize">{t.plan}</Badge>
                      {/*
                        Stored plan and paid plan look identical in this column,
                        so a fortnight-old signup reads as a customer. The badge
                        is the difference between a renewal and a sales call.
                      */}
                      {t.isTrial && (
                        <Badge
                          variant="outline"
                          className="border-primary text-primary text-[10px] font-black uppercase tracking-wider"
                          title={
                            t.trialDaysLeft != null
                              ? `Trial ends in ${t.trialDaysLeft} day${t.trialDaysLeft === 1 ? "" : "s"}`
                              : "On trial"
                          }
                          data-testid={`badge-trial-${t.slug}`}
                        >
                          Trial{t.trialDaysLeft != null ? ` · ${t.trialDaysLeft}d` : ""}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <SubscriptionBadge status={t.subscriptionStatus} />
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
        <TenantDetail tenant={selectedTenant} onClose={closeDetail} />
      )}
    </div>
  );
}
