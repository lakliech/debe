import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DollarSign, TrendingUp, Users, AlertTriangle, Calendar, Mail,
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Loader2,
  Search, Filter, Crown, Zap, Download, ArrowUp, ArrowDown, ArrowUpDown,
  Link2, Copy,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface BillingSummary {
  billingEnabled: boolean;
  mrrKes: number;
  arrKes: number;
  totalCampaigns: number;
  payingCampaigns: number;
  trialCampaigns: number;
  trialPipelineKes: number;
  atRiskCampaigns: number;
  atRiskMrrKes: number;
  newCampaignsLast30Days: number;
  growthPct: number;
  averageRevenuePerPayingKes: number;
  byPlan: { free: number; pro: number; enterprise: number };
  planDistribution: Array<{ tier: string; label: string; count: number; mrrKes: number }>;
  atRisk: Array<{ id: string; name: string; slug: string; riskReason: string | null; trialEndsAt: string | null }>;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  campaignName: string | null;
  storedPlan: string;
  effectivePlan: string;
  planLabel: string;
  isTrial: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  billingEmail: string | null;
  mrrKes: number;
  lifecycleState: string;
  isSuspended: boolean;
  userCount: number;
  agentCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  atRisk: boolean;
  riskReason: string | null;
}

interface EmailLog {
  id: string;
  tenantId: string;
  tenantName: string;
  recipient: string;
  template: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  sentAt: string;
}

function MetricCard({ title, value, subtitle, icon: Icon, trend }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black">{value}</div>
        {subtitle && (
          <p className={cn(
            "text-xs mt-1 flex items-center gap-1",
            trend === "up" && "text-green-600",
            trend === "down" && "text-red-600",
            !trend && "text-muted-foreground"
          )}>
            {trend === "up" && <TrendingUp className="h-3 w-3" />}
            {trend === "down" && <TrendingUp className="h-3 w-3 rotate-180" />}
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Business numbers go stale quietly — poll so an open tab stays truthful. */
const REFRESH_MS = 5 * 60_000;
export default function PlatformBilling() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [filter, setFilter] = useState<"all" | "paying" | "trial" | "at-risk" | "free">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDesc, setSortDesc] = useState(true);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [grantPlan, setGrantPlan] = useState<"free" | "pro" | "enterprise">("pro");
  const [grantMonths, setGrantMonths] = useState("12");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkTier, setLinkTier] = useState<"pro" | "enterprise">("pro");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/platform/billing/summary"],
    queryFn: () => apiFetch("/api/platform/billing/summary"),
    refetchInterval: REFRESH_MS,
  });

  const { data: tenants, isLoading: tenantsLoading } = useQuery<{ tenants: Tenant[]; total: number }>({
    queryKey: ["/api/platform/billing/tenants", filter, sortKey, sortDesc],
    queryFn: () =>
      apiFetch(`/api/platform/billing/tenants?filter=${filter}&sort=${sortDesc ? "-" : ""}${sortKey}`),
    refetchInterval: REFRESH_MS,
  });

  const { data: emails, isLoading: emailsLoading } = useQuery<{
    emails: EmailLog[];
    last7Days: { sent: number; failed: number; skipped: number };
  }>({
    queryKey: ["/api/platform/billing/emails"],
    queryFn: () => apiFetch("/api/platform/billing/emails?limit=50"),
  });

  const grantPlanMutation = useMutation({
    mutationFn: ({ id, plan, months }: { id: string; plan: string; months?: number }) =>
      apiFetch(`/api/platform/tenants/${id}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, months }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/billing/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/billing/tenants"] });
      toast({ title: "Plan granted", description: data.message });
      setGrantDialogOpen(false);
      setSelectedTenant(null);
    },
    onError: (err: Error) => toast({ title: "Grant failed", description: err.message, variant: "destructive" }),
  });

  const checkoutLinkMutation = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: string }) =>
      apiFetch(`/api/platform/tenants/${id}/checkout-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      }),
    onSuccess: (data: { url: string; planLabel: string }) => {
      setGeneratedLink(data.url);
      setLinkCopied(false);
      toast({ title: `${data.planLabel} payment link ready`, description: "Send it to the campaign to complete payment." });
    },
    onError: (err: Error) => toast({ title: "Could not create link", description: err.message, variant: "destructive" }),
  });

  const handleGrantPlan = () => {
    if (!selectedTenant) return;
    grantPlanMutation.mutate({
      id: selectedTenant.id,
      plan: grantPlan,
      months: grantPlan !== "free" ? Number(grantMonths) : undefined,
    });
  };

  const filteredTenants = tenants?.tenants.filter((t) =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.campaignName?.toLowerCase().includes(searchTerm.toLowerCase())
  ) ?? [];

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(key !== "name"); // names read A→Z; numbers read high→low
    }
  };

  // Exports the table exactly as the operator sees it (filter + search applied).
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Campaign", "Slug", "Plan", "Trial days left", "Stripe status",
      "Lifecycle", "Agents", "Users", "Last activity", "MRR (KES)",
      "At risk", "Risk reason", "Created",
    ];
    const lines = filteredTenants.map((t) =>
      [
        t.name, t.slug, t.planLabel,
        t.isTrial && t.trialDaysLeft !== null ? t.trialDaysLeft : "",
        t.subscriptionStatus ?? "", t.lifecycleState,
        t.agentCount, t.userCount,
        t.lastActivityAt ? new Date(t.lastActivityAt).toISOString() : "never",
        t.mrrKes, t.atRisk ? "yes" : "no", t.riskReason ?? "",
        new Date(t.createdAt).toISOString().slice(0, 10),
      ].map(esc).join(","),
    );
    const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <th
      className={cn("px-4 py-3 cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k ? (
          sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-black tracking-tight">Platform Billing</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Revenue dashboard and tenant plan management
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {summaryLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : summary ? (
          <>
            {/* Top metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="Monthly Recurring Revenue"
                value={`KES ${summary.mrrKes.toLocaleString()}`}
                icon={DollarSign}
              />
              <MetricCard
                title="Annual Run Rate"
                value={`KES ${summary.arrKes.toLocaleString()}`}
                subtitle={`KES ${summary.averageRevenuePerPayingKes.toLocaleString()} avg/tenant`}
                icon={TrendingUp}
              />
              <MetricCard
                title="Total Campaigns"
                value={summary.totalCampaigns}
                subtitle={`${summary.payingCampaigns} paying · ${summary.trialCampaigns} trial · ${summary.byPlan.free} free — ${summary.newCampaignsLast30Days} new this month (${summary.growthPct >= 0 ? "+" : ""}${summary.growthPct}%)`}
                icon={Users}
                trend={summary.growthPct > 0 ? "up" : summary.growthPct < 0 ? "down" : "neutral"}
              />
              <MetricCard
                title="Trial Pipeline"
                value={`KES ${summary.trialPipelineKes.toLocaleString()}`}
                subtitle={`${summary.trialCampaigns} campaigns in trial`}
                icon={Zap}
                trend="neutral"
              />
            </div>

            {/* At-risk campaigns */}
            {summary.atRiskCampaigns > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="h-5 w-5" />
                    At-Risk Campaigns
                  </CardTitle>
                  <CardDescription>
                    {summary.atRiskCampaigns} campaign{summary.atRiskCampaigns !== 1 ? "s" : ""} at risk ·{" "}
                    KES {summary.atRiskMrrKes.toLocaleString()} MRR exposure
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {summary.atRisk.slice(0, 5).map((tenant) => (
                      <div key={tenant.id} className="flex items-center justify-between text-sm border border-amber-200 bg-white rounded p-2">
                        <div>
                          <p className="font-semibold">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">{tenant.riskReason}</p>
                        </div>
                        {tenant.trialEndsAt && (
                          <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">
                            <Clock className="h-3 w-3 mr-1" />
                            {formatDistanceToNow(new Date(tenant.trialEndsAt), { addSuffix: true })}
                          </Badge>
                        )}
                      </div>
                    ))}
                    {summary.atRisk.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        ...and {summary.atRisk.length - 5} more
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Plan distribution — count and MRR by tier */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plan Distribution</CardTitle>
                <CardDescription>
                  Campaigns per tier vs the MRR each tier contributes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.planDistribution} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis
                        yAxisId="count"
                        orientation="left"
                        allowDecimals={false}
                        tick={{ fontSize: 12 }}
                        width={32}
                      />
                      <YAxis
                        yAxisId="mrr"
                        orientation="right"
                        tick={{ fontSize: 12 }}
                        width={72}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) =>
                          name === "MRR (KES)" ? [`KES ${value.toLocaleString()}`, name] : [value, name]
                        }
                      />
                      <Legend />
                      <Bar yAxisId="count" dataKey="count" name="Campaigns" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="mrr" dataKey="mrrKes" name="MRR (KES)" fill="hsl(var(--primary) / 0.35)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* Lifecycle email deliverability */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Lifecycle Email Deliverability
                </CardTitle>
                <CardDescription>Last 7 days</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedEmails(!expandedEmails)}
              >
                {expandedEmails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {emailsLoading ? (
              <Skeleton className="h-20" />
            ) : emails ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-xl font-black">{emails.last7Days.sent}</p>
                      <p className="text-xs text-muted-foreground">Sent</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <div>
                      <p className="text-xl font-black">{emails.last7Days.failed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <div>
                      <p className="text-xl font-black">{emails.last7Days.skipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                    </div>
                  </div>
                </div>

                {expandedEmails && (
                  <div className="border-t border-border pt-4 space-y-2 max-h-64 overflow-y-auto">
                    {emails.emails.map((email) => (
                      <div key={email.id} className="flex items-start justify-between text-xs border border-border rounded p-2">
                        <div className="flex-1">
                          <p className="font-semibold">{email.subject}</p>
                          <p className="text-muted-foreground">
                            {email.tenantName} → {email.recipient} · {email.template}
                          </p>
                          {email.error && <p className="text-red-600 mt-1">{email.error}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 ml-2">
                          <Badge variant="outline" className={cn(
                            "text-[10px]",
                            email.status === "sent" && "bg-green-50 text-green-700 border-green-200",
                            email.status === "failed" && "bg-red-50 text-red-700 border-red-200",
                            email.status === "skipped" && "bg-amber-50 text-amber-700 border-amber-200"
                          )}>
                            {email.status}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(email.sentAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Tenant list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Campaigns</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search campaigns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 text-sm"
                  />
                </div>
                <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paying">Paying</SelectItem>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="at-risk">At Risk</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  disabled={filteredTenants.length === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tenantsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : filteredTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No campaigns found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20 text-xs font-black uppercase tracking-wider text-muted-foreground">
                      <SortHeader label="Campaign" k="name" className="text-left" />
                      <th className="px-4 py-3 text-left">Plan</th>
                      <SortHeader label="MRR" k="mrr" className="text-right" />
                      <th className="px-4 py-3 text-left">Stripe</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <SortHeader label="Trial" k="trial" className="text-left" />
                      <SortHeader label="Agents" k="agents" className="text-right" />
                      <SortHeader label="Last active" k="activity" className="text-left" />
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTenants.map((tenant) => (
                      <tr
                        key={tenant.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/platform-admin?tenant=${tenant.id}`)}
                        title="Open campaign detail"
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold">{tenant.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{tenant.slug}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn(
                            tenant.effectivePlan === "enterprise" && "bg-purple-50 text-purple-700 border-purple-200",
                            tenant.effectivePlan === "pro" && "bg-blue-50 text-blue-700 border-blue-200",
                            tenant.effectivePlan === "free" && "bg-gray-50 text-gray-700 border-gray-200"
                          )}>
                            {tenant.planLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          KES {tenant.mrrKes.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {tenant.subscriptionStatus ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-mono text-[10px] capitalize",
                                tenant.subscriptionStatus === "active" && "bg-green-50 text-green-700 border-green-200",
                                tenant.subscriptionStatus === "trialing" && "bg-blue-50 text-blue-700 border-blue-200",
                                (tenant.subscriptionStatus === "past_due" || tenant.subscriptionStatus === "unpaid") && "bg-amber-50 text-amber-700 border-amber-200",
                                (tenant.subscriptionStatus === "canceled" || tenant.subscriptionStatus.startsWith("incomplete")) && "bg-gray-50 text-gray-600 border-gray-200",
                              )}
                            >
                              {tenant.subscriptionStatus.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {tenant.isSuspended && (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                              Suspended
                            </Badge>
                          )}
                          {tenant.lifecycleState === "deletion_scheduled" && (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                              Deleting
                            </Badge>
                          )}
                          {tenant.atRisk && !tenant.isSuspended && tenant.lifecycleState !== "deletion_scheduled" && (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
                              title={tenant.riskReason ?? undefined}
                            >
                              At Risk
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {tenant.isTrial && tenant.trialDaysLeft !== null ? (
                            <span className="text-amber-600 font-semibold">{tenant.trialDaysLeft}d left</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{tenant.agentCount}</td>
                        <td className="px-4 py-3 text-xs">
                          {tenant.lastActivityAt ? (
                            formatDistanceToNow(new Date(tenant.lastActivityAt), { addSuffix: true })
                          ) : (
                            <span className="text-muted-foreground italic">never</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTenant(tenant);
                              setGeneratedLink(null);
                              setLinkCopied(false);
                              setLinkDialogOpen(true);
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5 mr-1.5" />
                            Link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTenant(tenant);
                              setGrantDialogOpen(true);
                            }}
                          >
                            <Crown className="h-3.5 w-3.5 mr-1.5" />
                            Grant
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Grant plan dialog */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Plan Access</DialogTitle>
            <DialogDescription>
              Manually grant a plan to <strong>{selectedTenant?.name}</strong> without payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">Plan</Label>
              <Select value={grantPlan} onValueChange={(v) => setGrantPlan(v as typeof grantPlan)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {grantPlan !== "free" && (
              <div className="space-y-2">
                <Label className="font-semibold">Duration (months)</Label>
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={grantMonths}
                  onChange={(e) => setGrantMonths(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGrantPlan} disabled={grantPlanMutation.isPending}>
              {grantPlanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Crown className="h-4 w-4 mr-2" />}
              Grant Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment link dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Payment Link</DialogTitle>
            <DialogDescription>
              Generate a Stripe checkout link for <strong>{selectedTenant?.name}</strong>. The campaign completes
              payment themselves; the subscription activates automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">Plan</Label>
              <Select value={linkTier} onValueChange={(v) => { setLinkTier(v as typeof linkTier); setGeneratedLink(null); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {generatedLink && (
              <div className="space-y-2">
                <Label className="font-semibold">Checkout link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={generatedLink} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedLink);
                      setLinkCopied(true);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    {linkCopied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Links expire after 24 hours. Uses the campaign's billing email on file.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => selectedTenant && checkoutLinkMutation.mutate({ id: selectedTenant.id, tier: linkTier })}
              disabled={checkoutLinkMutation.isPending}
            >
              {checkoutLinkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
              {generatedLink ? "Regenerate" : "Generate Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SortKey = "name" | "mrr" | "agents" | "activity" | "trial" | "created";
