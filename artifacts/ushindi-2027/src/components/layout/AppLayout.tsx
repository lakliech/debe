import { Shield, Flag, Users, Activity, Settings, MapPin, Search, Menu, LogOut, ChevronRight, DollarSign, Megaphone, Library, Calendar, AlertTriangle, Settings2, ClipboardList, BarChart3, AlertOctagon, Scale, Monitor, Globe, Download, Lock, Vote, Mail, Building2, ChevronsUpDown, Check } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser, useOrganizationList } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AppLayoutProps {
  children: React.ReactNode;
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Activity },
  { name: "Volunteers", href: "/volunteers", icon: Users },
  { name: "Supporters / CRM", href: "/supporters", icon: Flag },
  { name: "Training", href: "/training", icon: Shield },
  { name: "Coordinator", href: "/coordinator", icon: MapPin },
];

const financeNav = [
  { name: "Finance Overview", href: "/finance", icon: DollarSign },
  { name: "Contributions", href: "/finance/contributions", icon: DollarSign },
  { name: "Budget", href: "/finance/budget", icon: DollarSign },
  { name: "Expenditure", href: "/finance/expenditure", icon: DollarSign },
];

const commsNav = [
  { name: "Comms Overview", href: "/communications", icon: Megaphone },
  { name: "Templates", href: "/communications/templates", icon: Megaphone },
  { name: "Statements", href: "/communications/statements", icon: Megaphone },
  { name: "Content Library", href: "/content-library", icon: Library },
];

const eventsNav = [
  { name: "Events", href: "/events-management", icon: Calendar },
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

const politicalNav = [
  { name: "Aspirants", href: "/aspirants", icon: Vote },
  { name: "Contact Messages", href: "/contact-messages", icon: Mail },
];

const adminNav = [
  { name: "Geography", href: "/geography", icon: MapPin },
  { name: "User Management", href: "/users", icon: Users },
  { name: "Roles & Permissions", href: "/roles", icon: Shield },
  { name: "Audit Log", href: "/audit", icon: Search },
  { name: "Data Requests", href: "/data-requests", icon: Activity },
  { name: "Compliance", href: "/compliance", icon: Lock },
  { name: "Reports & Exports", href: "/reporting", icon: Download },
  { name: "Privileged Access", href: "/privileged-access", icon: Shield },
];

// Separate section — only meaningful for platform_admin holders
const platformNav = [
  { name: "Platform Admin", href: "/platform-admin", icon: Building2 },
];

const settingsNav = [
  { name: "Branding", href: "/settings/branding", icon: Flag },
  { name: "System Config", href: "/settings/system", icon: Settings },
];

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
            { label: "Command Centre", items: navigation },
            { label: "Finance", items: financeNav },
            { label: "Communications", items: commsNav },
            { label: "Events & Response", items: eventsNav },
            { label: "Election Operations", items: electionNav },
            { label: "Political", items: politicalNav },
            { label: "Administration", items: adminNav },
            { label: "Settings", items: settingsNav },
            { label: "Platform", items: platformNav },
          ].map((section) => (
            <div key={section.label}>
              <div className="px-3 mb-1.5 text-[10px] font-black tracking-widest text-sidebar-foreground/40 uppercase">
                {section.label}
              </div>
              <nav className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/finance" && item.href !== "/communications" && item.href !== "/content-library" && location.startsWith(`${item.href}/`));
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
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
