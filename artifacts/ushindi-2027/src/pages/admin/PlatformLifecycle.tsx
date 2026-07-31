import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy, CheckCircle2, XCircle, Clock, Globe, Trash2, AlertTriangle,
  Pause, Play, RotateCcw, Loader2, Edit, Shield, User,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

interface DomainRequest {
  id: number;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  kind: "slug" | "custom_domain";
  currentValue: string | null;
  requestedValue: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface DeletionRequest {
  id: number;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface Tenant {
  id: number;
  name: string;
  slug: string;
  lifecycleState: string;
  isSuspended: boolean;
  scheduledDeletionAt: string | null;
  createdAt: string;
}

export default function PlatformLifecycle() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ type: "domain" | "deletion"; id: number } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const [lifecycleDialogOpen, setLifecycleDialogOpen] = useState(false);
  const [lifecycleTenant, setLifecycleTenant] = useState<Tenant | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<"suspend" | "reactivate" | "schedule-deletion" | "cancel-deletion" | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleGraceDays, setLifecycleGraceDays] = useState("30");

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTenant, setRenameTenant] = useState<Tenant | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameSlug, setRenameSlug] = useState("");

  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [purgeTenant, setPurgeTenant] = useState<Tenant | null>(null);
  const [purgeConfirmSlug, setPurgeConfirmSlug] = useState("");

  const { data: requests, isLoading: requestsLoading } = useQuery<{
    domainRequests: DomainRequest[];
    deletionRequests: DeletionRequest[];
  }>({
    queryKey: ["/api/platform/requests"],
    queryFn: () => apiFetch("/api/platform/requests"),
  });

  const { data: tenants, isLoading: tenantsLoading } = useQuery<{ tenants: Tenant[] }>({
    queryKey: ["/api/platform/billing/tenants"],
    queryFn: () => apiFetch("/api/platform/billing/tenants?filter=all"),
  });

  const reviewDomainRequest = useMutation({
    mutationFn: ({ id, approve, notes }: { id: number; approve: boolean; notes?: string }) =>
      apiFetch(`/api/platform/requests/domain/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, reviewNotes: notes }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/requests"] });
      toast({ title: "Request reviewed", description: data.message });
      setReviewDialogOpen(false);
      setReviewTarget(null);
      setReviewNotes("");
    },
    onError: (err: Error) => toast({ title: "Review failed", description: err.message, variant: "destructive" }),
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ id, action, reason, graceDays }: { id: number; action: string; reason?: string; graceDays?: number }) =>
      apiFetch(`/api/platform/tenants/${id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, graceDays }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/billing/tenants"] });
      toast({ title: "Lifecycle action applied", description: data.message });
      setLifecycleDialogOpen(false);
      setLifecycleTenant(null);
      setLifecycleAction(null);
      setLifecycleReason("");
    },
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name, slug }: { id: number; name?: string; slug?: string }) =>
      apiFetch(`/api/platform/tenants/${id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/billing/tenants"] });
      toast({ title: "Tenant renamed", description: data.message });
      setRenameDialogOpen(false);
      setRenameTenant(null);
      setRenameName("");
      setRenameSlug("");
    },
    onError: (err: Error) => toast({ title: "Rename failed", description: err.message, variant: "destructive" }),
  });

  const purgeMutation = useMutation({
    mutationFn: ({ id, confirmSlug }: { id: number; confirmSlug: string }) =>
      apiFetch(`/api/platform/tenants/${id}/purge`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSlug }),
      }),
    onSuccess: (data: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/billing/tenants"] });
      toast({ title: "Campaign purged", description: data.message });
      setPurgeDialogOpen(false);
      setPurgeTenant(null);
      setPurgeConfirmSlug("");
    },
    onError: (err: Error) => toast({ title: "Purge failed", description: err.message, variant: "destructive" }),
  });

  const handleReview = (approve: boolean) => {
    if (!reviewTarget) return;
    if (reviewTarget.type === "domain") {
      reviewDomainRequest.mutate({ id: reviewTarget.id, approve, notes: reviewNotes || undefined });
    }
    // Deletion requests handled inline below
  };

  const handleLifecycle = () => {
    if (!lifecycleTenant || !lifecycleAction) return;
    lifecycleMutation.mutate({
      id: lifecycleTenant.id,
      action: lifecycleAction,
      reason: lifecycleReason || undefined,
      graceDays: lifecycleAction === "schedule-deletion" ? Number(lifecycleGraceDays) : undefined,
    });
  };

  const handleRename = () => {
    if (!renameTenant) return;
    renameMutation.mutate({
      id: renameTenant.id,
      name: renameName || undefined,
      slug: renameSlug || undefined,
    });
  };

  const handlePurge = () => {
    if (!purgeTenant || purgeConfirmSlug !== purgeTenant.slug) return;
    purgeMutation.mutate({ id: purgeTenant.id, confirmSlug: purgeConfirmSlug });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-black tracking-tight">Platform Lifecycle</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review queue, tenant state management, and irreversible operations
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Domain requests */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Domain Change Requests
            </CardTitle>
            <CardDescription>Pending slug and custom domain requests</CardDescription>
          </CardHeader>
          <CardContent>
            {requestsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : requests?.domainRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No pending domain requests</p>
            ) : (
              <div className="space-y-2">
                {requests?.domainRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between border border-border rounded p-3">
                    <div>
                      <p className="font-semibold text-sm">
                        {req.tenantName} <span className="text-muted-foreground font-normal">({req.tenantSlug})</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {req.kind === "slug" ? "Slug change" : "Custom domain"}: <span className="font-mono font-semibold">{req.currentValue ?? "(none)"}</span> →{" "}
                        <span className="font-mono font-semibold">{req.requestedValue}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}</p>
                    </div>
                    <div className="flex gap-2">
                      {req.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReviewTarget({ type: "domain", id: req.id });
                              setReviewDialogOpen(true);
                            }}
                          >
                            Review
                          </Button>
                        </>
                      )}
                      {req.status !== "pending" && (
                        <Badge variant="outline" className={cn(
                          req.status === "approved" && "bg-green-50 text-green-700 border-green-200",
                          req.status === "rejected" && "bg-red-50 text-red-700 border-red-200"
                        )}>
                          {req.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deletion requests */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Deletion Requests
            </CardTitle>
            <CardDescription>Campaigns requesting permanent deletion</CardDescription>
          </CardHeader>
          <CardContent>
            {requestsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : requests?.deletionRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No pending deletion requests</p>
            ) : (
              <div className="space-y-2">
                {requests?.deletionRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between border border-red-200 rounded p-3 bg-red-50/30">
                    <div>
                      <p className="font-semibold text-sm">
                        {req.tenantName} <span className="text-muted-foreground font-normal">({req.tenantSlug})</span>
                      </p>
                      {req.reason && <p className="text-xs text-muted-foreground mt-1">Reason: {req.reason}</p>}
                      <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}</p>
                    </div>
                    <div className="flex gap-2">
                      {req.status === "pending" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            const tenant = tenants?.tenants.find((t) => t.id === req.tenantId);
                            if (tenant) {
                              setLifecycleTenant(tenant);
                              setLifecycleAction("schedule-deletion");
                              setLifecycleReason(req.reason ?? "");
                              setLifecycleDialogOpen(true);
                            }
                          }}
                        >
                          Schedule Deletion
                        </Button>
                      )}
                      {req.status !== "pending" && (
                        <Badge variant="outline" className={cn(
                          req.status === "approved" && "bg-green-50 text-green-700 border-green-200",
                          req.status === "rejected" && "bg-red-50 text-red-700 border-red-200"
                        )}>
                          {req.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tenant actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5" />
              All Campaigns
            </CardTitle>
            <CardDescription>State management, renaming, and destructive actions</CardDescription>
          </CardHeader>
          <CardContent>
            {tenantsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : tenants?.tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No campaigns found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20 text-xs font-black uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Campaign</th>
                      <th className="px-4 py-3 text-left">State</th>
                      <th className="px-4 py-3 text-left">Created</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants?.tenants.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-semibold">{tenant.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{tenant.slug}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {tenant.isSuspended && (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 w-fit">
                                <Pause className="h-3 w-3 mr-1" />
                                Suspended
                              </Badge>
                            )}
                            {tenant.lifecycleState === "deletion_scheduled" && tenant.scheduledDeletionAt && (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 w-fit">
                                <Trash2 className="h-3 w-3 mr-1" />
                                Deletes {format(new Date(tenant.scheduledDeletionAt), "d MMM")}
                              </Badge>
                            )}
                            {!tenant.isSuspended && tenant.lifecycleState !== "deletion_scheduled" && (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 w-fit">
                                <Play className="h-3 w-3 mr-1" />
                                Active
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {format(new Date(tenant.createdAt), "d MMM yyyy")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRenameTenant(tenant);
                                setRenameName(tenant.name);
                                setRenameSlug(tenant.slug);
                                setRenameDialogOpen(true);
                              }}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            {!tenant.isSuspended && tenant.lifecycleState !== "deletion_scheduled" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setLifecycleTenant(tenant);
                                  setLifecycleAction("suspend");
                                  setLifecycleDialogOpen(true);
                                }}
                              >
                                <Pause className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {tenant.isSuspended && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setLifecycleTenant(tenant);
                                  setLifecycleAction("reactivate");
                                  setLifecycleDialogOpen(true);
                                }}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {tenant.lifecycleState === "deletion_scheduled" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setLifecycleTenant(tenant);
                                  setLifecycleAction("cancel-deletion");
                                  setLifecycleDialogOpen(true);
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {tenant.lifecycleState !== "deletion_scheduled" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setPurgeTenant(tenant);
                                  setPurgeDialogOpen(true);
                                }}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
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

      {/* Review domain request dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Domain Request</DialogTitle>
            <DialogDescription>Approve or reject this domain change request</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">Review Notes (optional)</Label>
              <Textarea
                placeholder="Internal notes about this decision..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleReview(false)} disabled={reviewDomainRequest.isPending}>
              <XCircle className="h-4 w-4 mr-2" />
              Reject
            </Button>
            <Button onClick={() => handleReview(true)} disabled={reviewDomainRequest.isPending}>
              {reviewDomainRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lifecycle action dialog */}
      <Dialog open={lifecycleDialogOpen} onOpenChange={setLifecycleDialogOpen}>
        <DialogContent className={cn(lifecycleAction === "schedule-deletion" && "border-red-200")}>
          <DialogHeader>
            <DialogTitle className={cn(lifecycleAction === "schedule-deletion" && "text-red-600")}>
              {lifecycleAction === "suspend" && "Suspend Campaign"}
              {lifecycleAction === "reactivate" && "Reactivate Campaign"}
              {lifecycleAction === "schedule-deletion" && "Schedule Campaign Deletion"}
              {lifecycleAction === "cancel-deletion" && "Cancel Scheduled Deletion"}
            </DialogTitle>
            <DialogDescription>
              {lifecycleAction === "suspend" && "Suspend access immediately. Reversible."}
              {lifecycleAction === "reactivate" && "Restore full access."}
              {lifecycleAction === "schedule-deletion" && "Set a deletion date. Reversible until purge."}
              {lifecycleAction === "cancel-deletion" && "Stop the deletion countdown and restore access."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {(lifecycleAction === "suspend" || lifecycleAction === "schedule-deletion") && (
              <div className="space-y-2">
                <Label className="font-semibold">Reason</Label>
                <Textarea
                  placeholder="Why is this action being taken?"
                  value={lifecycleReason}
                  onChange={(e) => setLifecycleReason(e.target.value)}
                  rows={3}
                />
              </div>
            )}
            {lifecycleAction === "schedule-deletion" && (
              <div className="space-y-2">
                <Label className="font-semibold">Grace Period (days)</Label>
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={lifecycleGraceDays}
                  onChange={(e) => setLifecycleGraceDays(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Access suspends immediately; data purges after this period.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLifecycleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={lifecycleAction === "schedule-deletion" ? "destructive" : "default"}
              onClick={handleLifecycle}
              disabled={lifecycleMutation.isPending}
            >
              {lifecycleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Campaign</DialogTitle>
            <DialogDescription>
              Change the campaign name or slug. A slug change will break existing public links.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">Campaign Name</Label>
              <Input
                placeholder="New campaign name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Slug</Label>
              <Input
                placeholder="new-slug"
                value={renameSlug}
                onChange={(e) => setRenameSlug(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Changing the slug will break all existing public portal links
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renameMutation.isPending || (!renameName && !renameSlug)}>
              {renameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Edit className="h-4 w-4 mr-2" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purge dialog */}
      <AlertDialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
        <AlertDialogContent className="border-red-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Irreversible: Purge Campaign Data
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently destroy</strong> all data for <strong>{purgeTenant?.name}</strong>:
              all users, volunteers, supporters, polling stations, results, and every record.
              <br />
              <br />
              <strong className="text-red-600">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-2">
              <Label className="font-semibold">
                Type the campaign slug to confirm:{" "}
                <span className="font-mono text-sm">{purgeTenant?.slug}</span>
              </Label>
              <Input
                placeholder={purgeTenant?.slug}
                value={purgeConfirmSlug}
                onChange={(e) => setPurgeConfirmSlug(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setPurgeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePurge}
              disabled={purgeConfirmSlug !== purgeTenant?.slug || purgeMutation.isPending}
            >
              {purgeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Purge Forever
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
