import { useParams, Link } from "wouter";
import { useGetUser, useGetRoleBreakdown } from "@workspace/api-client-react"; // Note: Use real query if available
import { ArrowLeft, User as UserIcon, MapPin, Shield, Activity, Phone, Mail, Calendar, CheckCircle2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function UserDetail() {
  const { id } = useParams();
  const { data: user, isLoading } = useGetUser(id || "");
  
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-24 bg-muted rounded"></div>
        <div className="h-48 bg-muted rounded-md"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-muted rounded-md"></div>
          <div className="h-64 bg-muted rounded-md"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Personnel record not found.
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link href="/users" className="inline-flex items-center text-sm font-semibold text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Personnel Roster
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
          Personnel Dossier
        </h1>
      </div>

      <div className="bg-card border border-border shadow-sm rounded-md overflow-hidden">
        <div className="p-6 md:p-8 flex flex-col md:flex-row items-start gap-8 relative">
          <div className="w-24 h-24 rounded bg-primary/10 text-primary flex flex-col items-center justify-center border border-primary/20 shadow-sm shrink-0">
            <span className="font-black text-3xl uppercase tracking-tighter">{user.fullName.substring(0, 2)}</span>
          </div>
          
          <div className="flex-1 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-foreground">{user.fullName}</h2>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {user.email}</span>
                  {user.phoneNumber && <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {user.phoneNumber}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {user.status === 'active' ? (
                  <Badge className="bg-primary/10 text-primary border-primary/20 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Active Clearance
                  </Badge>
                ) : user.status === 'suspended' ? (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <UserX className="w-3 h-3" /> Suspended
                  </Badge>
                ) : (
                  <Badge variant="secondary">{user.status}</Badge>
                )}
                <Button variant="outline" size="sm">Edit Dossier</Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
              {user.roles && user.roles.map((role) => (
                <Badge key={role.roleId} variant="outline" className="bg-muted/50 py-1.5 px-3">
                  <Shield className="w-3 h-3 mr-1.5 text-accent" /> {role.roleName}
                </Badge>
              ))}
              {(!user.roles || user.roles.length === 0) && (
                <span className="text-sm text-muted-foreground italic">No roles assigned</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-md shadow-sm p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border pb-4">
            <MapPin className="w-5 h-5 text-muted-foreground" /> Operational Area
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 border-b border-border pb-4">
              <span className="text-sm font-semibold text-muted-foreground">County</span>
              <span className="col-span-2 font-bold">{user.countyId ? `County #${user.countyId}` : "National Level"}</span>
            </div>
            <div className="grid grid-cols-3 gap-4 border-b border-border pb-4">
              <span className="text-sm font-semibold text-muted-foreground">Constituency</span>
              <span className="col-span-2 font-bold">{user.constituencyId ? `Constituency #${user.constituencyId}` : "—"}</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <span className="text-sm font-semibold text-muted-foreground">Ward</span>
              <span className="col-span-2 font-bold">{user.wardId ? `Ward #${user.wardId}` : "—"}</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-md shadow-sm p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border pb-4">
            <Activity className="w-5 h-5 text-muted-foreground" /> Access Details
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 border-b border-border pb-4">
              <span className="text-sm font-semibold text-muted-foreground">System ID</span>
              <span className="col-span-2 font-mono text-xs text-muted-foreground">{user.id}</span>
            </div>
            <div className="grid grid-cols-3 gap-4 border-b border-border pb-4">
              <span className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4" /> Provisioned</span>
              <span className="col-span-2 font-medium">{format(new Date(user.createdAt), "dd MMM yyyy")}</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <span className="text-sm font-semibold text-muted-foreground">Last Access</span>
              <span className="col-span-2 font-medium">
                {user.lastLoginAt ? format(new Date(user.lastLoginAt), "dd MMM yyyy, HH:mm") : "Never accessed"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
