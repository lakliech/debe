import { Shield, Flag, Users, Activity, Settings, MapPin, Search, Menu, LogOut, ChevronRight } from "lucide-react";
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
  { name: "Geography", href: "/geography", icon: MapPin },
  { name: "User Management", href: "/users", icon: Users },
  { name: "Roles & Permissions", href: "/roles", icon: Shield },
  { name: "Audit Log", href: "/audit", icon: Search },
  { name: "Data Requests", href: "/data-requests", icon: Activity },
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
        
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          <div>
            <div className="px-3 mb-2 text-xs font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
              Command Centre
            </div>
            <nav className="space-y-1">
              {navigation.map((item) => {
                const isActive = location === item.href || location.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon className={cn("h-5 w-5", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50")} />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div>
            <div className="px-3 mb-2 text-xs font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
              Administration
            </div>
            <nav className="space-y-1">
              {settingsNav.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon className={cn("h-5 w-5", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50")} />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
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
