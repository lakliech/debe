import { Shield, Flag, Users, Activity, Settings, MapPin, Search, Menu, LogOut, ChevronRight, DollarSign, Megaphone, Library, Calendar, AlertTriangle, Settings2, ClipboardList, BarChart3, AlertOctagon, Scale, Monitor, Globe, Download, Lock, Vote, Mail, Building2, ChevronsUpDown, Check, Radio, CreditCard, LifeBuoy } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser, useOrganizationList } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { ROLES } from "@/lib/constants";
import DemoTour from "@/components/DemoTour";
import TrialBanner from "@/components/TrialBanner";

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
  { name: "Geography", href: "/geography", icon: MapPin },
];

// ── Role-based nav visibility ─────────────────────────────────────────────────
//
// Each role slug is classified into a "family" so that sections can be shown
// to functional groups (e.g. comms officers) independently of their numeric
// level.  This lets us distinguish roles at the same level that have very
// different remits (e.g. finance-officer vs county-coordinator, both level 7).
//
// The API /api/users/me returns roles scoped to the active tenant.  We cache
// the result for 5 minutes — it only needs to refresh on role changes.
//
const ROLE_FAMILY: Record<string, string> = {
  // Finance back-office
  "finance-officer": "finance",   "treasurer": "finance",
  // Communications / content
  "communications-officer": "comms",  "content-approver": "comms",
  // Compliance / legal back-office
  "legal-officer": "compliance",       "data-protection-officer": "compliance",
  "auditor": "compliance",             "security-administrator": "compliance",
  "verification-officer": "compliance",
  // Field agents
  "polling-station-agent": "agent",    "backup-polling-agent": "agent",
  "call-centre-agent": "agent",        "polling-centre-coordinator": "agent",
  // Field coordinators
  "ward-coordinator": "coordinator",   "constituency-coordinator": "coordinator",
  "county-coordinator": "coordinator", "national-organising-director": "coordinator",
  // Senior campaign leadership
  "national-campaign-manager": "leadership",
  "campaign-executive-director": "leadership",
  "presidential-candidate": "leadership",
  "super-administrator": "leadership", "super-admin": "leadership",
  // General supporters
  "volunteer": "supporter",  "donor": "supporter",  "public-supporter": "supporter",
};

interface UserAccess {
  maxLevel: number;
  families: Set<string>;
  isGlobalAdmin: boolean;
  isLoaded: boolean;
}

// While the /api/users/me fetch is in-flight, show all sections so the
// sidebar doesn't flash an empty state.
const LOADING_ACCESS: UserAccess = {
  maxLevel: 999,
  families: new Set(Object.values(ROLE_FAMILY)),
  isGlobalAdmin: true,
  isLoaded: false,
};

// Least-privilege sentinel returned on fetch error or missing data — only
// the Campaign section is visible until a successful response arrives.
const ERROR_ACCESS: UserAccess = {
  maxLevel: 0,
  families: new Set<string>(),
  isGlobalAdmin: false,
  isLoaded: true,
};

function useUserAccess(): UserAccess {
  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["user-me-nav-access"],
    queryFn: () =>
      fetch(`${BASE}/api/users/me`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`/api/users/me ${r.status}`);
        return r.json();
      }),
    staleTime: 5 * 60 * 1000,  // 5 minutes — only refresh on role changes
    retry: 2,                  // allow 2 retries before falling back to ERROR_ACCESS
    retryDelay: 1_500,
  });

  // Still fetching — show everything temporarily to avoid a jarring empty sidebar.
  if (isLoading) return LOADING_ACCESS;

  // Network error or non-OK response — fall back to least privilege so we
  // never accidentally show sections the user shouldn't see.
  if (isError || !data) return ERROR_ACCESS;

  // Global admins bypass every role check — they see everything.
  if (data.isGlobalAdmin) {
    return {
      maxLevel: 999,
      families: new Set(Object.values(ROLE_FAMILY)),
      isGlobalAdmin: true,
      isLoaded: true,
    };
  }

  const slugs: string[] = (data.roles ?? []).map((r: any) => r.roleSlug as string);
  const families = new Set(slugs.map((s) => ROLE_FAMILY[s]).filter(Boolean));

  // Derive max level from the ROLES catalogue; unknown slugs contribute 0.
  const slugToLevel = Object.fromEntries(ROLES.map((r) => [r.slug, r.level]));
  const maxLevel = slugs.length
    ? Math.max(...slugs.map((s) => slugToLevel[s] ?? 0))
    : 0;

  return { maxLevel, families, isGlobalAdmin: false, isLoaded: true };
}

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
function CampaignSwitcher() {
  const { setActive, userMemberships, isLoaded } = useOrganizationList({ userMemberships: true });
  const [open, setOpen] = useState(false);
  const orgs = (userMemberships as any)?.data ?? [];

  if (!isLoaded || orgs.length <= 1) return null;

  const activeOrg = orgs.find((m: any) => m.organization) ?? null;

  const handleSwitch = async (orgId: string) => {
    if (!setActive) return;
    await setActive({ organization: orgId });
    setOpen(false);
    // Hard reload to re-scope all queries to the new tenant
    window.location.reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm border border-border rounded-sm px-3 py-1.5 hover:bg-muted/50 transition-colors"
      >
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-semibold truncate max-w-[120px]">
          {activeOrg?.organization?.name ?? "Select campaign"}
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
            {orgs.map((m: any) => {
              const org = m.organization;
              const isCurrent = m.organization?.id === (userMemberships as any)?.activeOrganizationId;
              return (
                <button
                  key={org.id}
                  onClick={() => handleSwitch(org.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
                >
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {!isCurrent && <span className="w-3.5 shrink-0" />}
                  <span className="truncate">{org.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const access = useUserAccess();

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
          {[
            // Campaign — always visible to any authenticated user
            { label: "Campaign", items: navigation, show: true },

            // Finance — county coordinator level (7) and above covers all senior
            // field staff; finance-officer and treasurer are also level 7, so a
            // single level threshold works for both groups
            { label: "Finance", items: financeNav, show: access.maxLevel >= 7 },

            // Communications — shown to comms/coordinator/leadership families
            // (level 7+ doesn't work alone because finance officers are also
            // level 7 but should not see this section)
            {
              label: "Communications", items: commsNav,
              show: access.families.has("comms")
                 || access.families.has("coordinator")
                 || access.families.has("leadership")
                 || access.maxLevel >= 8,
            },

            // Election Operations — shown to field roles (agents + coordinators +
            // leadership); back-office roles (finance, compliance) are excluded
            // even though they may have high numeric levels
            {
              label: "Election Operations", items: electionNav,
              show: access.families.has("agent")
                 || access.families.has("coordinator")
                 || access.families.has("leadership")
                 || access.maxLevel >= 8,
            },

            // Campaign Admin — county-coordinator level (7) and above, plus
            // compliance back-office roles (legal, auditor, DPO, etc.)
            {
              label: "Campaign Admin", items: campaignAdminNav,
              show: access.maxLevel >= 7 || access.families.has("compliance"),
            },

            // Platform — global admins only (set via is_global_admin DB column)
            { label: "Platform", items: platformNav, show: access.isGlobalAdmin },
          ].filter((s) => s.show).map((section) => (
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
            {/* Campaign switcher — only visible when user belongs to multiple orgs */}
            <CampaignSwitcher />
            {/* Status indicator */}
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-sm border border-border">
              <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
              <span className="text-xs font-bold tracking-widest text-foreground hidden sm:block">SYSTEM SECURE</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {/* Trial / billing state. Renders nothing on a healthy paid plan. */}
            <TrialBanner />
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
