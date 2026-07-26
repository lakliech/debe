import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronRight, Users, Loader2, Lock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  level: number;
  color?: string;
  userCount: number;
}

interface Permission {
  id: string;
  resource: string;
  action: string;
  scope?: string;
}

const LEVEL_COLORS: Record<number, string> = {
  10: "bg-red-100 text-red-800 border-red-200",
  9:  "bg-orange-100 text-orange-800 border-orange-200",
  8:  "bg-amber-100 text-amber-800 border-amber-200",
  7:  "bg-yellow-100 text-yellow-800 border-yellow-200",
  6:  "bg-lime-100 text-lime-800 border-lime-200",
  5:  "bg-green-100 text-green-800 border-green-200",
  4:  "bg-teal-100 text-teal-800 border-teal-200",
  3:  "bg-cyan-100 text-cyan-800 border-cyan-200",
  2:  "bg-blue-100 text-blue-800 border-blue-200",
  1:  "bg-gray-100 text-gray-700 border-gray-200",
};

function levelColor(level: number) {
  return LEVEL_COLORS[Math.min(level, 10)] ?? LEVEL_COLORS[1];
}

export default function Roles() {
  const [selected, setSelected] = useState<Role | null>(null);

  const { data: roles, isLoading: rolesLoading, isError } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
    queryFn: () =>
      fetch(`${BASE}/api/roles`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
  });

  const { data: permissions, isLoading: permsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/roles", selected?.id, "permissions"],
    queryFn: () =>
      fetch(`${BASE}/api/roles/${selected!.id}/permissions`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
    enabled: !!selected,
  });

  const sorted = [...(roles ?? [])].sort((a, b) => b.level - a.level);

  // Group permissions by resource for the matrix view
  const grouped: Record<string, Permission[]> = {};
  for (const p of permissions ?? []) {
    if (!grouped[p.resource]) grouped[p.resource] = [];
    grouped[p.resource].push(p);
  }
  const resources = Object.keys(grouped).sort();

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground uppercase flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          Roles &amp; Permissions
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          System access-control hierarchy. Click <strong>View Matrix</strong> to inspect a role's permissions.
        </p>
      </div>

      {/* Loading */}
      {rolesLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 text-destructive border border-destructive/30 bg-destructive/5 p-4 rounded-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">Could not load roles. Check your permissions.</p>
        </div>
      )}

      {/* Role grid */}
      {!rolesLoading && !isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((role) => (
            <div
              key={role.id}
              className="bg-card border border-border p-6 flex flex-col hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 flex items-center justify-center bg-muted border border-border">
                  <Shield className="w-5 h-5 text-foreground/60" />
                </div>
                <Badge
                  variant="outline"
                  className={cn("font-mono text-xs border", levelColor(role.level))}
                >
                  Lvl {role.level}
                </Badge>
              </div>

              <h3 className="font-black text-base uppercase tracking-tight mb-1">
                {role.name}
              </h3>
              <p className="text-sm text-muted-foreground mb-4 flex-1">
                {role.description}
              </p>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  {role.userCount} user{role.userCount !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => setSelected(role)}
                  className="flex items-center gap-1 text-xs font-bold text-primary uppercase tracking-wider hover:underline group"
                >
                  View Matrix
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Permission Matrix Sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Permission Matrix
              </span>
              <span className="text-xl font-black uppercase tracking-tight">
                {selected?.name}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={cn("font-mono text-xs border", selected ? levelColor(selected.level) : "")}
                >
                  Level {selected?.level}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {selected?.slug}
                </span>
              </div>
            </SheetTitle>
          </SheetHeader>

          {permsLoading && (
            <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading permissions…</span>
            </div>
          )}

          {!permsLoading && resources.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Lock className="h-10 w-10 mb-4 opacity-25" />
              <p className="text-sm font-medium">No explicit permissions defined for this role.</p>
              <p className="text-xs mt-1 text-center max-w-xs">
                Access for this role is controlled by the API middleware, not the permissions table.
              </p>
            </div>
          )}

          {!permsLoading && resources.length > 0 && (
            <div className="space-y-5">
              {resources.map((resource) => (
                <div key={resource} className="border border-border">
                  <div className="bg-muted px-4 py-2 border-b border-border">
                    <span className="text-xs font-black uppercase tracking-widest">
                      {resource.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {grouped[resource].map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm font-mono text-foreground">
                          {p.action}
                        </span>
                        {p.scope && (
                          <Badge variant="outline" className="text-xs font-mono">
                            {p.scope}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
