import { Shield, Flag, Users, Activity, Settings, MapPin, Search, Menu, LogOut, ChevronRight, DollarSign, Megaphone, Library, Calendar, AlertTriangle, Settings2, ClipboardList, BarChart3, AlertOctagon, Scale, Monitor, Globe, Download, Lock, Vote, Mail, Building2, ChevronsUpDown, Check, Radio, CreditCard, LifeBuoy, Ban } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBranding, useBrandingSuspended } from "@/contexts/BrandingContext";
import { SECTION_RULES } from "@/lib/access";
import { useIdentity, type ActiveTenant } from "@/hooks/useIdentity";
import DemoTour from "@/components/DemoTour";
import TrialBanner from "@/components/TrialBanner";
import { MultiOrgGate } from "@/components/NoActiveOrgPrompt";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AppLayoutProps {
  children: React.ReactNode;
}

// Campaign operations — day-to-day campaign management.
// Events, Aspirants, and Contact Messages are merged here
// (removing the separate "Events" and "Political" sections).
const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Activity },
  { name: "Volunteers", href: "/volunteers", icon: Users },
  { name: "Supporters / CRM", href: "/supporters", icon: Flag },
  { name: "Training", href: "/training", icon: Shield },
  { name: "Coordinator", href: "/coordinator", icon: MapPin },
  { name: "Command Center", href: "/command-center", icon: Radio },
  { name: "Events", href: "/events-management", icon: Calendar },
  { name: "Aspirants", href: "/aspirants", icon: Vote },
  { name: "Contact Messages", href: "/contact-messages", icon: Mail },
];

const financeNav = [
  { name: "Finance Overview", href: "/finance", icon: DollarSign },
  { name: "Contributions", href: "/finance/contributions", icon: DollarSign },
  { name: "Budget", href: "/finance/budget", icon: DollarSign },
  { name: "Expenditure", href: "/finance/expenditure", icon: DollarSign },
];

// Rapid Response moves here from the old "Events & Response" section —
// managing misinformation claims is communications work, not event logistics.
const commsNav = [
  { name: "Comms Overview", href: "/communications", icon: Megaphone },
  { name: "Templates", href: "/communications/templates", icon: Megaphone },
  { name: "Statements", href: "/communications/statements", icon: Megaphone },
  { name: "Content Library", href: "/content-library", icon: Library },
  { name: "Rapid Response", href: "/rapid-response", icon: AlertTriangle },
];

const electionNav = [
  { name: "Election Admin", href: "/election-admin", icon: Settings2 },
  { name: "Polling Stations", href: "/polling-stations", icon: MapPin },
  { name: "Coverage Gaps", href: "/coverage-gaps", icon: AlertTriangle },
  { name: "Polling Agents", href: "/polling-agents", icon: Users },
  { name: "Results", href: "/election-results", icon: ClipboardList },
  { name: "Tally Dashboard", href: "/tally", icon: BarChart3 },
  { name: "PVT Dashboard", href: "/pvt", icon: BarChart3 },
  { name: "PVT Setup", href: "/pvt/setup", icon: Settings2 },
  { name: "Incidents", href: "/election-incidents", icon: AlertOctagon },
  { name: "Disputes", href: "/election-disputes", icon: Scale },
  { name: "Command Centre", href: "/command-centre", icon: Monitor },
  { name: "Transparency", href: "/transparency-portal", icon: Globe },
];

// Campaign Admin merges the old "Administration" and "Settings" sections.
// Branding and System Config appear first so campaign identity settings
// are easy to find. Geography moves to Platform (it is shared reference data).
const campaignAdminNav = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Branding", href: "/settings/branding", icon: Flag },
  { name: "System Config", href: "/settings/system", icon: Settings },
  { name: "User Management", href: "/users", icon: Users },
  { name: "Roles & Permissions", href: "/roles", icon: Shield },
  { name: "Audit Log", href: "/audit", icon: Search },
  { name: "Data Requests", href: "/data-requests", icon: Activity },
  { name: "Compliance", href: "/compliance", icon: Lock },
  { name: "Reports & Exports", href: "/reporting", icon: Download },
  { name: "Privileged Access", href: "/privileged-access", icon: Shield },
];

// Platform section — only meaningful for platform_admin holders.
// Geography lives here because it is global reference data shared across all
// tenants (counties, constituencies, wards), not per-campaign configuration.
const platformNav = [
  { name: "Platform Admin", href: "/platform-admin", icon: Building2 },
  { name: "Billing & Revenue", href: "/platform/billing", icon: CreditCard },
  { name: "Tenant Lifecycle", href: "/platform/lifecycle", icon: LifeBuoy },
  { name: "User Search", href: "/platform/users", icon: Search },
  { name: "Operations Monitor", href: "/platform/ops", icon: Radio },
  { name: "Activity Log", href: "/platform/activity", icon: Activity },
  { name: "Geography", href: "/geography", icon: MapPin },
];

// ── Role-based nav visibility ─────────────────────────────────────────────────
//
// The derivation and the per-section rules live in @/lib/access so they can be
// unit-tested against the seeded role catalogue. See that module for the
// privilege scale (lower = more privileged) and why gates are family-based.
//
// The identity payload (/api/users/me, via useIdentity) carries roles scoped to
// the campaign in context, each with an authoritative `roleLevel`.

/** Sidebar header — renders candidate name + "COMMAND CENTRE" from live branding */
function SidebarHeader() {
  const branding = useBranding();
  // Split candidateName into two lines: first word on top, rest below (max 2 lines)
  const parts = branding.candidateName.toUpperCase().split(" ");
  const line1 = parts[0] ?? "";
  const line2 = parts.slice(1).join(" ");
  return (
    <div className="flex h-16 shrink-0 items-center px-6 bg-sidebar-primary text-sidebar-primary-foreground font-bold tracking-tight text-xl border-b border-sidebar-border">
      <div className="flex flex-col leading-none mr-3">
        <div className="bg-white text-sidebar-primary font-black text-[9px] px-1.5 py-0.5 tracking-wider">
          {line1}
        </div>
        {line2 && (
          <div className="text-sidebar-foreground/70 font-black text-[7px] tracking-[0.18em] mt-0.5">
            {line2}
          </div>
        )}
      </div>
      COMMAND CENTRE
    </div>
  );
}

// ── Campaign Switcher ─────────────────────────────────────────────────────────
//
// Two different mechanisms, because the two kinds of user are different:
//
//   Campaign staff belong to campaigns via app-owned membership (user_roles).
//   Switching campaign means entering another of their memberships — the
//   choice is stored server-side on the user row and takes effect immediately.
//
//   Platform operators belong to no campaign at all. They administer every
//   campaign from the platform surface and explicitly *enter* one when they
//   need to change its configuration. That choice is stored server-side, and
//   exiting returns them to the platform with no campaign context.

/**
 * Persistent override notice — while a platform operator is working inside a
 * customer's campaign the interface must make that unmistakable, and offer a
 * one-click return to the platform area.
 */
function PlatformOverrideBanner({ activeTenant }: { activeTenant: ActiveTenant }) {
  const [busy, setBusy] = useState(false);

  const exitToPlatform = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/platform/active-campaign`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: null }),
      });
      if (res.ok) window.location.assign(`${BASE}/platform-admin`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 bg-amber-100 border-b border-amber-300 text-amber-950 text-sm">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          You are working inside <strong>{activeTenant.name}</strong> as platform super admin
          — every action is recorded.
        </span>
      </span>
      <button
        onClick={exitToPlatform}
        disabled={busy}
        className="font-semibold underline underline-offset-2 hover:text-amber-700 disabled:opacity-50"
      >
        Return to platform
      </button>
    </div>
  );
}

/** Operator variant — enter or leave any campaign on the platform. */
function PlatformCampaignSwitcher({ activeTenant }: { activeTenant: ActiveTenant | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, navigate] = useLocation();

  const { data: tenants } = useQuery<any[]>({
    queryKey: ["/api/platform/tenants"],
    queryFn: () =>
      fetch(`${BASE}/api/platform/tenants`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : [],
      ),
    enabled: open,
    staleTime: 60_000,
  });

  const setCampaign = async (tenantId: string | null) => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/platform/active-campaign`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return;
      setOpen(false);
      // Entering or leaving a campaign re-scopes every cached query, so send
      // the operator to the surface that matches the new context and reload.
      window.location.assign(`${BASE}${tenantId ? "/dashboard" : "/platform-admin"}`);
    } finally {
      setBusy(false);
    }
  };

  const list = (tenants ?? []).filter((t: any) => !t.isSuspended);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={cn(
          "flex items-center gap-2 text-sm border rounded-sm px-3 py-1.5 transition-colors hover:bg-muted/50",
          activeTenant ? "border-border" : "border-dashed border-primary/60 text-primary",
        )}
        title={
          activeTenant
            ? `Working inside ${activeTenant.name}`
            : "Platform view — no campaign selected"
        }
      >
        <Building2 className="h-4 w-4 shrink-0 opacity-70" />
        <span className="font-semibold truncate max-w-[140px]">
          {activeTenant ? activeTenant.name : "Platform view"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-sm shadow-md py-1">
            <p className="px-3 py-1.5 text-[10px] font-black tracking-widest text-muted-foreground uppercase">
              Enter a campaign
            </p>

            <button
              onClick={() => navigate("/platform-admin")}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
            >
              <span className="w-3.5 shrink-0" />
              <span className="truncate text-muted-foreground">Manage all campaigns…</span>
            </button>

            <div className="my-1 border-t border-border" />

            {list.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No active campaigns.</p>
            )}

            {list.map((t: any) => {
              const isCurrent = t.id === activeTenant?.id;
              return (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => setCampaign(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                >
                  {isCurrent ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}

            {activeTenant && (
              <>
                <div className="my-1 border-t border-border" />
                <button
                  disabled={busy}
                  onClick={() => setCampaign(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                >
                  <span className="w-3.5 shrink-0" />
                  <span className="truncate">Leave campaign</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Campaign-staff variant — switch between the campaigns you belong to. */
function MemberCampaignSwitcher() {
  const { campaigns, activeTenant } = useIdentity();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (campaigns.length <= 1) return null;

  const handleSwitch = async (tenantId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/users/me/active-campaign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return;
      setOpen(false);
      // Hard reload to re-scope all queries to the new tenant
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm border border-border rounded-sm px-3 py-1.5 hover:bg-muted/50 transition-colors"
      >
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-semibold truncate max-w-[120px]">
          {activeTenant?.name ?? "Select campaign"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-sm shadow-md py-1">
            <p className="px-3 py-1.5 text-[10px] font-black tracking-widest text-muted-foreground uppercase">
              Switch Campaign
            </p>
            {campaigns.map((c) => {
              const isCurrent = c.id === activeTenant?.id;
              return (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => handleSwitch(c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                >
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {!isCurrent && <span className="w-3.5 shrink-0" />}
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Shown when the campaign's account has been suspended by a platform admin.
 * Replaces the entire page content so the admin does not see a wall of broken
 * API states, and tells them exactly what happened and who to contact.
 */
function CampaignSuspendedPage() {
  const { signOut } = useClerk();
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] px-6 text-center gap-6">
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-red-100 text-red-600">
        <Ban className="h-8 w-8" />
      </div>
      <div className="space-y-2 max-w-md">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Campaign Suspended
        </h1>
        <p className="text-muted-foreground">
          This campaign's account has been suspended by the platform. You cannot
          access the Command Centre until the suspension is lifted.
        </p>
        <p className="text-sm text-muted-foreground pt-2">
          If you believe this is an error, please contact platform support at{" "}
          <a
            href="mailto:support@ushindi.app"
            className="font-semibold text-foreground underline underline-offset-2 hover:text-primary"
          >
            support@ushindi.app
          </a>{" "}
          and reference your campaign name.
        </p>
      </div>
      <Button
        variant="outline"
        className="rounded-sm"
        onClick={() => signOut({ redirectUrl: "/" })}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sign out
      </Button>
    </div>
  );
}

/**
 * Shown to a platform operator who has landed on a campaign page without
 * entering a campaign. This is a normal state, not an error: operators hold no
 * campaign of their own, so there is simply nothing to render until they pick
 * one.
 */
function NoCampaignSelected() {
  const [, navigate] = useLocation();
  return (
    <div className="max-w-xl mx-auto mt-12 border border-border rounded-sm bg-card p-8 text-center">
      <Building2 className="h-10 w-10 mx-auto text-muted-foreground/60" />
      <h1 className="mt-4 text-lg font-black tracking-tight">No campaign selected</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You are signed in as a platform operator, which is not tied to any single
        campaign. Choose a campaign from the switcher above to work inside it, or
        continue administering all campaigns from the platform.
      </p>
      <Button className="mt-6 rounded-sm" onClick={() => navigate("/platform-admin")}>
        Go to platform admin
      </Button>
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { access, isPlatformOperator, activeTenant } = useIdentity();
  const isSuspended = useBrandingSuspended();

  // A platform operator outside any campaign has no campaign data to show, so
  // the campaign sections would be dead links. Show only Platform until they
  // enter a campaign.
  const inCampaignContext = !isPlatformOperator || Boolean(activeTenant);

  // Hiding the nav is not enough — a bookmark or a typed URL still lands on a
  // campaign page. Those pages would fire requests the API answers with
  // "no campaign selected", so intercept and say so plainly instead.
  const isPlatformRoute =
    location.startsWith("/platform-admin") ||
    location.startsWith("/platform/") ||
    location.startsWith("/geography");
  const needsCampaign = !inCampaignContext && !isPlatformRoute;

  // Fetch open message count for the sidebar badge; refresh every 60 s.
  const { data: msgCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/contact-messages/counts"],
    queryFn: () =>
      fetch(`${BASE}/api/contact-messages/counts`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : {}),
    refetchInterval: 60_000,
    // Don't throw on failure — the badge silently disappears if the fetch fails.
    retry: false,
  });
  const openCount = msgCounts?.open ?? 0;

  const getInitials = (name?: string | null) => {
    if (!name) return "US";
    return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <DemoTour />
      
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/80 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarHeader />
        
        <div className="flex-1 overflow-y-auto py-4 px-4 space-y-6">
          {/*
            Visibility rules live in @/lib/access (SECTION_RULES) so they can be
            unit-tested against the seeded role catalogue. Keep these labels in
            sync with the SectionLabel union there.
          */}
          {([
            { label: "Campaign", items: navigation },
            { label: "Finance", items: financeNav },
            { label: "Communications", items: commsNav },
            { label: "Election Operations", items: electionNav },
            { label: "Campaign Admin", items: campaignAdminNav },
            { label: "Platform", items: platformNav },
          ] as const)
            .filter((s) => (s.label === "Platform" ? true : inCampaignContext))
            .filter((s) => SECTION_RULES[s.label](access))
            .map((section) => (
            <div key={section.label}>
              <div className="px-3 mb-1.5 text-[10px] font-black tracking-widest text-sidebar-foreground/40 uppercase">
                {section.label}
              </div>
              <nav className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/finance" && item.href !== "/communications" && item.href !== "/content-library" && location.startsWith(`${item.href}/`));
                  
                  // Add data-tour attributes for tour targets
                  const tourAttr: Record<string, string> = {};
                  if (item.href === "/dashboard") tourAttr["data-tour"] = "dashboard";
                  if (item.href === "/polling-stations") tourAttr["data-tour"] = "polling-stations";
                  if (item.href === "/polling-agents") tourAttr["data-tour"] = "polling-agents";
                  if (item.href === "/election-results") tourAttr["data-tour"] = "results";
                  if (item.href === "/tally") tourAttr["data-tour"] = "tally";
                  if (item.href === "/transparency-portal") tourAttr["data-tour"] = "transparency";
                  
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      )}
                      onClick={() => setSidebarOpen(false)}
                      {...tourAttr}
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50")} />
                      <span className="truncate flex-1">{item.name}</span>
                      {item.href === "/contact-messages" && openCount > 0 && (
                        <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center leading-none">
                          {openCount > 99 ? "99+" : openCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        <div className="p-4 bg-sidebar-accent/30 border-t border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <Avatar className="h-10 w-10 border border-sidebar-border rounded-sm bg-sidebar-primary">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground rounded-sm font-bold">
                {getInitials(user?.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="truncate">
              <div className="text-sm font-bold truncate text-sidebar-foreground">{user?.fullName || "User"}</div>
              <div className="text-xs text-sidebar-foreground/60 truncate">{user?.primaryEmailAddress?.emailAddress}</div>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-sidebar-foreground/50 hover:text-white hover:bg-sidebar-accent rounded-sm shrink-0"
            onClick={() => signOut({ redirectUrl: "/" })}
            title="Log out"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {/* Unmistakable while an operator works inside a customer's campaign. */}
        {isPlatformOperator && activeTenant && (
          <PlatformOverrideBanner activeTenant={activeTenant} />
        )}
        {/* Topbar for mobile & subtle breadcrumb for desktop */}
        <header className="h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-border bg-card">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden mr-4 -ml-2 text-foreground"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </Button>
            
            <div className="hidden lg:flex items-center text-sm font-medium text-muted-foreground space-x-2">
              <span className="text-foreground font-bold">Command Centre</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
              <span className="capitalize">{location.split('/')[1] || 'Dashboard'}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3 text-sm font-mono text-muted-foreground">
            {/* Platform operators pick which campaign to enter; campaign staff
                switch between the campaigns they belong to. */}
            {isPlatformOperator ? (
              <PlatformCampaignSwitcher activeTenant={activeTenant} />
            ) : (
              <MemberCampaignSwitcher />
            )}
            {/* Status indicator */}
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-sm border border-border">
              <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
              <span className="text-xs font-bold tracking-widest text-foreground hidden sm:block">SYSTEM SECURE</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {/* Suspended campaign: show a clear explanation instead of a wall of broken API states.
                Platform operators are exempt — they can still manage the campaign from platform admin. */}
            {isSuspended && !isPlatformOperator ? (
              <CampaignSuspendedPage />
            ) : (
              <>
                {/* Trial / billing state. Renders nothing on a healthy paid plan. */}
                <TrialBanner />
                {needsCampaign ? (
                  <NoCampaignSelected />
                ) : (
                  // MultiOrgGate intercepts multi-campaign consultants who have
                  // not yet selected a campaign, showing a clear picker instead
                  // of a wall of broken API states.
                  <MultiOrgGate>{children}</MultiOrgGate>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
