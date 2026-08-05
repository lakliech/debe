import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Settings as SettingsIcon, CreditCard, Palette, Globe, AlertTriangle,
  CheckCircle2, Clock, ArrowRight, ExternalLink, Loader2, AlertCircle,
  Trash2, ChevronRight, Users, Database, TrendingUp, Zap, Shield,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { CampaignScopeFields, SEAT_TO_LEVEL, scopeComplete, type ScopeSelection } from "@/components/CampaignScopeFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
    const body = await res.json().catch(() => ({})) as { error?: string; feature?: string; currentPlan?: string; requiredPlan?: string };
    if (res.status === 402 && body.feature) {
      throw new Error(`Upgrade required: ${body.feature} requires ${body.requiredPlan ?? "a higher plan"}`);
    }
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface OverviewData {
  campaign: {
    id: number;
    name: string;
    slug: string;
    customDomain: string | null;
    tlsStatus: string | null;
    createdAt: string;
    lifecycleState: string;
    scheduledDeletionAt: string | null;
    isSuspended: boolean;
    seatType: string | null;
    scopeCounty: { id: string; name: string } | null;
    scopeConstituency: { id: string; name: string; countyId: string } | null;
    scopeWard: { id: string; name: string; constituencyId: string; countyId: string } | null;
  };
  branding: {
    campaignName: string;
    candidateName: string;
    positionTitle: string;
    partyName: string;
    primaryColor: string;
    logoUrl: string | null;
  } | null;
  plan: {
    current: string;
    label: string;
    isTrial: boolean;
    trialDaysLeft: number | null;
    trialEndsAt: string | null;
    subscriptionStatus: string | null;
    billingEmail: string | null;
    billingEnabled: boolean;
  };
  usage: {
    team: number;
    agents: number;
    stations: number;
    maxAgents: number | null;
    maxStations: number | null;
  };
  onboarding: {
    steps: Array<{ key: string; label: string; completed: boolean }>;
    completed: number;
    total: number;
    percent: number;
    allDone: boolean;
    dismissed: boolean;
  };
  pendingDomainRequest: any | null;
  pendingDeletionRequest: any | null;
}

interface PlanDetail {
  tier: string;
  name: string;
  priceKes: number;
  billingPeriod: string;
  maxAgents: number | null;
  maxStations: number | null;
  features: string[];
}

interface DomainRequest {
  id: number;
  kind: "slug" | "custom_domain";
  currentValue: string | null;
  requestedValue: string;
  status: string;
  createdAt: string;
}

const TABS = [
  { key: "plan", label: "Plan & Billing", icon: CreditCard },
  { key: "branding", label: "Branding", icon: Palette },
  { key: "domain", label: "Web Address", icon: Globe },
  { key: "danger", label: "Danger Zone", icon: AlertTriangle },
] as const;

function TabNav({ active, onChange }: { active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-border bg-muted/20">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              isActive
                ? "border-primary text-primary bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function OnboardingChecklist({ data }: { data: OverviewData["onboarding"] }) {
  if (data.dismissed || data.allDone) return null;
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Setup Progress</CardTitle>
            <CardDescription className="text-xs">
              {data.completed} of {data.total} steps completed
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-white">
            {data.percent}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={data.percent} className="h-2" />
        <div className="space-y-1.5">
          {data.steps.map((step) => (
            <div key={step.key} className="flex items-center gap-2 text-sm">
              {step.completed ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
              )}
              <span className={cn(step.completed ? "text-muted-foreground line-through" : "font-medium")}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanTab({ overview }: { overview: OverviewData }) {
  const { toast } = useToast();
  const { plan, usage } = overview;
  const [billingEmail, setBillingEmail] = useState(plan.billingEmail ?? "");

  const { data: plans, isLoading: plansLoading } = useQuery<{ plans: PlanDetail[] }>({
    queryKey: ["/api/billing/plans"],
    queryFn: () => apiFetch("/api/billing/plans"),
  });

  const checkout = useMutation({
    mutationFn: ({ tier, email }: { tier: string; email: string }) =>
      apiFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, billingEmail: email }),
      }),
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => toast({ title: "Checkout failed", description: err.message, variant: "destructive" }),
  });

  const portal = useMutation({
    mutationFn: () => apiFetch("/api/billing/portal", { method: "POST" }),
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => toast({ title: "Portal unavailable", description: err.message, variant: "destructive" }),
  });

  const handleUpgrade = (tier: string) => {
    if (!billingEmail) {
      toast({ title: "Billing email required", variant: "destructive" });
      return;
    }
    checkout.mutate({ tier, email: billingEmail });
  };

  return (
    <div className="space-y-6">
      {/* Current plan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-black">{plan.label}</p>
              {plan.isTrial && plan.trialDaysLeft !== null && (
                <p className="text-sm text-amber-600 font-semibold mt-1 flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {plan.trialDaysLeft} days left in trial
                  {plan.trialEndsAt && ` (ends ${format(new Date(plan.trialEndsAt), "d MMM yyyy")})`}
                </p>
              )}
              {plan.subscriptionStatus && (
                <p className="text-xs text-muted-foreground mt-1">
                  Status: <span className="font-semibold capitalize">{plan.subscriptionStatus}</span>
                </p>
              )}
            </div>
            <Badge variant={plan.isTrial ? "outline" : "default"} className="text-xs">
              {plan.current.toUpperCase()}
            </Badge>
          </div>

          {plan.billingEmail && (
            <div className="text-sm">
              <span className="text-muted-foreground">Billing email:</span>{" "}
              <span className="font-mono text-xs">{plan.billingEmail}</span>
            </div>
          )}

          {plan.billingEnabled && (
            <Button variant="outline" size="sm" onClick={() => portal.mutate()} disabled={portal.isPending}>
              {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ExternalLink className="h-4 w-4 mr-2" />}
              Manage Subscription
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Usage</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Users className="h-4 w-4" />
              Team Members
            </div>
            <p className="text-2xl font-black">{usage.team}</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Shield className="h-4 w-4" />
              Polling Agents
            </div>
            <p className="text-2xl font-black">
              {usage.agents}
              {usage.maxAgents !== null && <span className="text-base font-normal text-muted-foreground"> / {usage.maxAgents}</span>}
            </p>
            {usage.maxAgents === null && <p className="text-xs text-muted-foreground">Unlimited</p>}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Database className="h-4 w-4" />
              Polling Stations
            </div>
            <p className="text-2xl font-black">
              {usage.stations}
              {usage.maxStations !== null && <span className="text-base font-normal text-muted-foreground"> / {usage.maxStations}</span>}
            </p>
            {usage.maxStations === null && <p className="text-xs text-muted-foreground">Unlimited</p>}
          </div>
        </CardContent>
      </Card>

      {/* Upgrade section */}
      {plan.billingEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upgrade Plan</CardTitle>
            <CardDescription>Choose a plan that fits your campaign needs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="font-semibold">Billing Email</Label>
              <Input
                type="email"
                placeholder="billing@campaign.ke"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
              />
            </div>

            {plansLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plans?.plans.map((p) => (
                  <Card key={p.tier} className={cn("relative", p.tier === plan.current && "border-primary")}>
                    {p.tier === plan.current && (
                      <div className="absolute top-3 right-3">
                        <Badge variant="default" className="text-xs">Current</Badge>
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <div className="text-2xl font-black">
                        KES {p.priceKes.toLocaleString()}
                        <span className="text-sm font-normal text-muted-foreground">/{p.billingPeriod}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-1.5 text-xs">
                        {p.features.map((feat, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                      {p.tier !== plan.current && (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => handleUpgrade(p.tier)}
                          disabled={checkout.isPending}
                        >
                          {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upgrade"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!plan.billingEnabled && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Billing is not enabled for this deployment. Contact support to upgrade your plan.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function BrandingTab({ overview }: { overview: OverviewData }) {
  const { branding } = overview;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Campaign Branding</CardTitle>
          <CardDescription>
            A dedicated branding editor is available at{" "}
            <a href={`${BASE}/settings/branding`} className="text-primary underline underline-offset-2 font-semibold">
              /settings/branding
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {branding ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Name</p>
                <p className="font-semibold mt-1">{branding.campaignName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Candidate</p>
                <p className="font-semibold mt-1">{branding.candidateName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Position</p>
                <p className="font-semibold mt-1">{branding.positionTitle}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Party</p>
                <p className="font-semibold mt-1">{branding.partyName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Primary Color</p>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className="w-6 h-6 rounded border border-border"
                    style={{ backgroundColor: `hsl(${branding.primaryColor})` }}
                  />
                  <span className="font-mono text-xs">{branding.primaryColor}</span>
                </div>
              </div>
              {branding.logoUrl && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Logo</p>
                  <img src={branding.logoUrl} alt="Logo" className="h-8 mt-1" />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No branding configured yet.</p>
          )}
          <Separator />
          <Button asChild>
            <a href={`${BASE}/settings/branding`}>
              <Palette className="h-4 w-4 mr-2" />
              Edit Branding
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ScopeCard({ overview }: { overview: OverviewData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const c = overview.campaign;
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<ScopeSelection>({
    seatType: c.seatType ?? "",
    // Parent ids come back on the overview so the cascading pickers pre-fill.
    countyId: c.scopeCounty?.id ?? c.scopeConstituency?.countyId ?? c.scopeWard?.countyId ?? "",
    constituencyId: c.scopeConstituency?.id ?? c.scopeWard?.constituencyId ?? "",
    wardId: c.scopeWard?.id ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatType: sel.seatType,
          scopeCountyId: sel.countyId || undefined,
          scopeConstituencyId: sel.constituencyId || undefined,
          scopeWardId: sel.wardId || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/overview"] });
      toast({ title: "Campaign scope updated" });
      setEditing(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not update scope", description: err.message, variant: "destructive" }),
  });

  const showForm = editing || !c.seatType;
  const seatLabel = c.seatType ? SEAT_TO_LEVEL[c.seatType] ?? c.seatType : null;
  const geoName = c.scopeCounty?.name ?? c.scopeConstituency?.name ?? c.scopeWard?.name ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Campaign Scope
        </CardTitle>
        <CardDescription>The seat this campaign is contesting and the area it covers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!c.seatType && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No scope defined yet — set the seat and area this campaign is contesting.
            </AlertDescription>
          </Alert>
        )}
        {showForm ? (
          <div className="space-y-4">
            <CampaignScopeFields value={sel} onChange={setSel} />
            <div className="flex gap-2">
              <Button
                onClick={() => save.mutate()}
                disabled={!scopeComplete(sel) || save.isPending}
                data-testid="button-save-scope"
              >
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Scope
              </Button>
              {c.seatType && (
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold">{seatLabel}</p>
              <p className="text-sm text-muted-foreground">
                {c.seatType === "presidential" ? "National — all 47 counties" : geoName}
              </p>
            </div>
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-scope">
              Change
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DomainTab({ overview }: { overview: OverviewData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { campaign, pendingDomainRequest } = overview;

  const [slugInput, setSlugInput] = useState("");
  const [customDomainInput, setCustomDomainInput] = useState("");

  const { data: requests, isLoading: requestsLoading } = useQuery<{ requests: DomainRequest[] }>({
    queryKey: ["/api/settings/domain-requests"],
    queryFn: () => apiFetch("/api/settings/domain-requests"),
  });

  const createRequest = useMutation({
    mutationFn: ({ kind, requestedValue }: { kind: "slug" | "custom_domain"; requestedValue: string }) =>
      apiFetch("/api/settings/domain-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, requestedValue }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/settings/overview"] });
      qc.invalidateQueries({ queryKey: ["/api/settings/domain-requests"] });
      toast({ title: "Request submitted", description: data.message });
      setSlugInput("");
      setCustomDomainInput("");
    },
    onError: (err: Error) => {
      if (err.message.includes("Upgrade required")) {
        toast({
          title: "Upgrade Required",
          description: err.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Request failed", description: err.message, variant: "destructive" });
      }
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Slug</p>
            <p className="font-mono text-sm mt-1">{campaign.slug}</p>
          </div>
          {campaign.customDomain && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom Domain</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-sm">{campaign.customDomain}</p>
                {campaign.tlsStatus === "active" && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    HTTPS Active
                  </Badge>
                )}
                {campaign.tlsStatus === "pending" && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    <Clock className="h-3 w-3 mr-1" />
                    HTTPS Pending
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {pendingDomainRequest && (
        <Alert className="border-amber-200 bg-amber-50">
          <Clock className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <strong>Pending request:</strong> {pendingDomainRequest.kind === "slug" ? "Slug change" : "Custom domain"} to{" "}
            <span className="font-mono font-semibold">{pendingDomainRequest.requestedValue}</span> —{" "}
            awaiting platform admin approval.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request Slug Change</CardTitle>
          <CardDescription>
            Your campaign slug appears in your portal URL. Changing it will break existing public links.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="font-semibold">New Slug</Label>
            <Input
              placeholder="my-campaign-2027"
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              className="font-mono"
            />
          </div>
          <Button
            onClick={() => slugInput && createRequest.mutate({ kind: "slug", requestedValue: slugInput })}
            disabled={!slugInput || createRequest.isPending}
            variant="outline"
          >
            {createRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Request Slug Change
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request Custom Domain</CardTitle>
          <CardDescription>
            Point your own domain to this campaign portal. Requires DNS setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="font-semibold">Custom Domain</Label>
            <Input
              placeholder="vote.example.ke"
              value={customDomainInput}
              onChange={(e) => setCustomDomainInput(e.target.value)}
              className="font-mono"
            />
          </div>
          <Button
            onClick={() => customDomainInput && createRequest.mutate({ kind: "custom_domain", requestedValue: customDomainInput })}
            disabled={!customDomainInput || createRequest.isPending}
            variant="outline"
          >
            {createRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Request Custom Domain
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request History</CardTitle>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : requests?.requests.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No domain requests yet.</p>
          ) : (
            <div className="space-y-2">
              {requests?.requests.map((req) => (
                <div key={req.id} className="flex items-center justify-between border border-border rounded p-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {req.kind === "slug" ? "Slug" : "Custom domain"}: {req.requestedValue}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn(
                    req.status === "approved" && "bg-green-50 text-green-700 border-green-200",
                    req.status === "rejected" && "bg-red-50 text-red-700 border-red-200",
                    req.status === "pending" && "bg-amber-50 text-amber-700 border-amber-200"
                  )}>
                    {req.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DangerTab({ overview }: { overview: OverviewData }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { campaign, pendingDeletionRequest } = overview;

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");

  const createDeletionRequest = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName, reason: reason || undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/overview"] });
      toast({ title: "Deletion request submitted", description: "Platform admin will review your request." });
      setDeleteDialogOpen(false);
      setConfirmName("");
      setReason("");
    },
    onError: (err: Error) => toast({ title: "Request failed", description: err.message, variant: "destructive" }),
  });

  const withdrawDeletionRequest = useMutation({
    mutationFn: () => apiFetch("/api/settings/deletion-request", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/settings/overview"] });
      toast({ title: "Deletion request withdrawn" });
    },
    onError: (err: Error) => toast({ title: "Withdraw failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = confirmName === campaign.name;

  return (
    <div className="space-y-6">
      {campaign.lifecycleState === "deletion_scheduled" && campaign.scheduledDeletionAt && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <AlertDescription>
            <p className="font-bold text-red-900">This campaign is scheduled for deletion.</p>
            <p className="text-sm text-red-700 mt-1">
              All data will be permanently deleted on{" "}
              <strong>{format(new Date(campaign.scheduledDeletionAt), "d MMM yyyy, HH:mm")}</strong>.
              Contact support immediately if this was a mistake.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {campaign.isSuspended && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <AlertDescription>
            <p className="font-bold text-amber-900">This campaign is suspended.</p>
            <p className="text-sm text-amber-700 mt-1">
              Public portal access is disabled. Contact support to reactivate.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {pendingDeletionRequest && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-amber-700">
              <Clock className="h-5 w-5" />
              Pending Deletion Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              You have requested deletion of this campaign. Platform admin will review and process this request.
            </p>
            {pendingDeletionRequest.reason && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your reason</p>
                <p className="text-sm mt-1">{pendingDeletionRequest.reason}</p>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => withdrawDeletionRequest.mutate()}
              disabled={withdrawDeletionRequest.isPending}
            >
              {withdrawDeletionRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Withdraw Request
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-red-600">
            <Trash2 className="h-5 w-5" />
            Delete Campaign
          </CardTitle>
          <CardDescription>
            Permanently delete this campaign and all associated data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={!!pendingDeletionRequest || campaign.lifecycleState === "deletion_scheduled"}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Request Deletion
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Confirm Campaign Deletion
            </DialogTitle>
            <DialogDescription>
              This will request permanent deletion of <strong>{campaign.name}</strong> and all associated data:
              team members, volunteers, supporters, polling stations, results, and all records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">
                Type the campaign name to confirm:{" "}
                <span className="font-mono text-sm">{campaign.name}</span>
              </Label>
              <Input
                placeholder={campaign.name}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Reason (optional)</Label>
              <Textarea
                placeholder="Why are you deleting this campaign?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => createDeletionRequest.mutate()}
              disabled={!canSubmit || createDeletionRequest.isPending}
            >
              {createDeletionRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Request Deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Settings() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlTab = params.get("tab") ?? "plan";
  const [activeTab, setActiveTab] = useState(urlTab);

  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const { data: overview, isLoading } = useQuery<OverviewData>({
    queryKey: ["/api/settings/overview"],
    queryFn: () => apiFetch("/api/settings/overview"),
  });

  const handleTabChange = (key: string) => {
    const newUrl = `${window.location.pathname}?tab=${key}`;
    window.history.pushState({}, "", newUrl);
    setActiveTab(key);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-8 py-6 border-b border-border">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Failed to load settings.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-black tracking-tight">Campaign Settings</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage your plan, branding, domain, and campaign lifecycle
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <TabNav active={activeTab} onChange={handleTabChange} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl space-y-6">
          {overview.onboarding && activeTab === "plan" && <OnboardingChecklist data={overview.onboarding} />}

          {activeTab === "plan" && <PlanTab overview={overview} />}
          {activeTab === "branding" && <ScopeCard overview={overview} />}
          {activeTab === "branding" && <BrandingTab overview={overview} />}
          {activeTab === "domain" && <DomainTab overview={overview} />}
          {activeTab === "danger" && <DangerTab overview={overview} />}
        </div>
      </div>
    </div>
  );
}
