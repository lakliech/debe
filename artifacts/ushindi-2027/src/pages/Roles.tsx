import { ROLES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Shield, ChevronRight } from "lucide-react";

export default function Roles() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Roles & Permissions</h1>
        <p className="text-muted-foreground mt-1">System access control hierarchy.</p>
      </div>

      <div className="bg-card border border-border rounded-md shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[1px] bg-border">
          {ROLES.sort((a, b) => b.level - a.level).map(role => (
            <div key={role.id} className="bg-card p-6 flex flex-col hover:bg-muted/20 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-sm bg-muted flex items-center justify-center border border-border">
                  <Shield className="w-5 h-5 text-foreground/70" />
                </div>
                <Badge variant="outline" className="font-mono bg-background">
                  Lvl {role.level}
                </Badge>
              </div>
              <h3 className="font-bold text-lg mb-1">{role.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 flex-1">{role.description}</p>
              
              <button className="text-sm font-semibold text-primary flex items-center gap-1 group w-fit">
                View Matrix <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
