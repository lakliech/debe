import { Shield, Flag, Users, Activity, Settings, MapPin, Search, Menu, LogOut, ChevronRight, DollarSign, Megaphone, Library, Calendar, AlertTriangle, Settings2, ClipboardList, BarChart3, AlertOctagon, Scale, Monitor, Globe, Download, Lock, Vote } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

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

const settingsNav = [
  { name: "Branding", href: "/settings/branding", icon: Flag },
  { name: "System Config", href: "/settings/system", icon: Settings },
];

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        <div className="flex h-16 shrink-0 items-center px-6 bg-sidebar-primary text-sidebar-primary-foreground font-bold tracking-tight text-xl border-b border-sidebar-border">
          <div className="flex flex-col leading-none mr-3">
            <div className="bg-white text-sidebar-primary font-black text-[9px] px-1.5 py-0.5 tracking-wider">
              LINDA
            </div>
            <div className="text-sidebar-foreground/70 font-black text-[7px] tracking-[0.18em] mt-0.5">
              MWANANCHI
            </div>
          </div>
          COMMAND CENTRE
        </div>
        
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
                      <span className="truncate">{item.name}</span>
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
          
          <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground">
            {/* Status indicator */}
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-sm border border-border">
              <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
              <span className="text-xs font-bold tracking-widest text-foreground">SYSTEM SECURE</span>
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
