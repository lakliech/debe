/**
 * Platform User Search & Role Inspector
 *
 * Lets the platform owner look up any user across all tenants, inspect their
 * current role assignments (with geographic scope), assign new roles, and
 * remove existing ones. Every mutation is audit-logged server-side.
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, UserCircle2, Shield, Building2, BadgeAlert, ChevronRight,
  Trash2, Plus, Loader2, CheckCircle2, XCircle, RefreshCw, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  roleCount: number;
}

interface UserSearchResult {
  id: string;
  email: string;
  fullName: string;
  status: string;
  isGlobalAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  tenants: TenantSummary[];
}

interface RoleAssignment {
  assignmentId: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  roleId: string;
  roleName: string;
  roleSlug: string;
  roleLevel: number;
  countyId: string | null;
  countyName: string | null;
  constituencyId: string | null;
  constituencyName: string | null;
  wardId: string | null;
  wardName: string | null;
  assignedBy: string | null;
  createdAt: string;
}

interface UserDetail {
  id: string;
  email: string;
  fullName: string;
  status: string;
  isGlobalAdmin: boolean;
  phoneNumber: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  assignments: RoleAssignment[];
}

interface Role {
  id: string;
  name: string;
  slug: string;
  level: number;
  color: string | null;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  isSuspended: boolean;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const r = await fetch(`${BASE}/api/platform${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${r.status}`);
  }
  // 204 No Content (e.g. DELETE) returns an empty body — don't attempt JSON parse
  if (r.status === 204 || r.headers.get("content-length") === "0") return null;
  return r.json();
}

// ── Utility ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function statusBadge(status: string, isGlobalAdmin: boolean) {
  if (isGlobalAdmin)
    return <Badge className="bg-violet-100 text-violet-800 border-violet-200">Global Admin</Badge>;
  if (status === "active")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>;
  if (status === "suspended")
    return <Badge className="bg-red-100 text-red-800 border-red-200">Suspended</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function scopeLabel(a: RoleAssignment): string {
  if (a.wardName) return `Ward: ${a.wardName}`;
  if (a.constituencyName) return `Constituency: ${a.constituencyName}`;
  if (a.countyName) return `County: ${a.countyName}`;
  if (a.tenantName) return `Campaign: ${a.tenantName}`;
  return "Platform-wide";
}

// ── Add Role form ─────────────────────────────────────────────────────────────

function AddRoleForm({
  userId,
  roles,
  tenants,
  onDone,
}: {
  userId: string;
  roles: Role[];
  tenants: Tenant[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ tenantId: "", roleId: "", countyId: "", constituencyId: "", wardId: "" });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/users/${userId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          tenantId: form.tenantId || undefined,
          roleId: form.roleId,
          countyId: form.countyId || undefined,
          constituencyId: form.constituencyId || undefined,
          wardId: form.wardId || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-user-detail", userId] });
      qc.invalidateQueries({ queryKey: ["platform-users"] });
      toast({ title: "Role assigned", description: "The role has been assigned and the cache flushed." });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Failed to assign role", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-medium">Assign a role</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Campaign (tenant)</Label>
          <select
            value={form.tenantId}
            onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— Platform-wide —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Role <span className="text-destructive">*</span></Label>
          <select
            value={form.roleId}
            onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            required
          >
            <option value="">Select a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name} (L{r.level})</option>
            ))}
          </select>
        </div>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">
          Geographic scope (optional)
        </summary>
        <div className="mt-2 space-y-1">
          <Input
            placeholder="County ID"
            value={form.countyId}
            onChange={(e) => setForm((f) => ({ ...f, countyId: e.target.value }))}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Constituency ID"
            value={form.constituencyId}
            onChange={(e) => setForm((f) => ({ ...f, constituencyId: e.target.value }))}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Ward ID"
            value={form.wardId}
            onChange={(e) => setForm((f) => ({ ...f, wardId: e.target.value }))}
            className="h-7 text-xs"
          />
        </div>
      </details>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!form.roleId || mutation.isPending}
        >
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Assign
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── User detail panel ─────────────────────────────────────────────────────────

function UserDetailPanel({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addingRole, setAddingRole] = useState(false);

  const { data: user, isLoading, error } = useQuery<UserDetail>({
    queryKey: ["platform-user-detail", userId],
    queryFn: async () => {
      const d = await apiFetch(`/users/${userId}`);
      return d as UserDetail;
    },
    staleTime: 15_000,
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["platform-roles"],
    queryFn: () => apiFetch("/roles"),
    staleTime: 300_000,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["platform-tenants"],
    queryFn: () => apiFetch("/tenants"),
    staleTime: 60_000,
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/users/${userId}/roles/${assignmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-user-detail", userId] });
      qc.invalidateQueries({ queryKey: ["platform-users"] });
      toast({ title: "Role removed" });
    },
    onError: (e: Error) => toast({ title: "Failed to remove role", description: e.message, variant: "destructive" }),
  });

  // Group assignments by tenant
  const byTenant: Record<string, RoleAssignment[]> = {};
  for (const a of user?.assignments ?? []) {
    const key = a.tenantId ?? "__platform__";
    if (!byTenant[key]) byTenant[key] = [];
    byTenant[key].push(a);
  }
  const tenantGroups = Object.entries(byTenant).sort(([a], [b]) =>
    a === "__platform__" ? -1 : b === "__platform__" ? 1 : a.localeCompare(b),
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <h3 className="font-semibold text-base">Role Inspector</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4" /> Failed to load user: {(error as Error).message}
          </div>
        )}

        {user && (
          <>
            {/* User identity */}
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <UserCircle2 className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{user.fullName}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                {user.phoneNumber && (
                  <p className="text-xs text-muted-foreground">{user.phoneNumber}</p>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  {statusBadge(user.status, user.isGlobalAdmin)}
                  <span className="text-xs text-muted-foreground">
                    Last login: {timeAgo(user.lastLoginAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Role assignments grouped by tenant */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Role assignments
                  {user.assignments.length === 0 && (
                    <span className="ml-2 text-muted-foreground font-normal">(none — orphaned account)</span>
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setAddingRole((v) => !v)}
                >
                  <Plus className="h-3 w-3" />
                  Add role
                </Button>
              </div>

              {addingRole && (
                <AddRoleForm
                  userId={userId}
                  roles={roles}
                  tenants={tenants}
                  onDone={() => setAddingRole(false)}
                />
              )}

              {tenantGroups.length === 0 && !addingRole && (
                <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  <BadgeAlert className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No role assignments. This account is orphaned and cannot access any campaign.
                </div>
              )}

              {tenantGroups.map(([tenantKey, assignments]) => {
                const tenantLabel =
                  tenantKey === "__platform__"
                    ? "Platform-wide"
                    : assignments[0].tenantName ?? tenantKey;
                return (
                  <div key={tenantKey} className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <Building2 className="h-3.5 w-3.5" />
                      {tenantLabel}
                    </div>
                    <div className="space-y-1.5">
                      {assignments.map((a) => (
                        <div
                          key={a.assignmentId}
                          className="flex items-start justify-between rounded-md border bg-background px-3 py-2 gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Shield className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                              <span className="text-sm font-medium">{a.roleName}</span>
                              <Badge variant="outline" className="text-xs px-1.5 py-0">
                                L{a.roleLevel}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{scopeLabel(a)}</p>
                            <p className="text-xs text-muted-foreground">
                              Assigned {timeAgo(a.createdAt)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                            onClick={() => removeMutation.mutate(a.assignmentId)}
                            disabled={removeMutation.isPending}
                            title="Remove this role"
                          >
                            {removeMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── User search result card ───────────────────────────────────────────────────

function UserCard({
  user,
  selected,
  onClick,
}: {
  user: UserSearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50",
        selected && "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <UserCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{user.fullName}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {statusBadge(user.status, user.isGlobalAdmin)}
              {user.tenants.length === 0 ? (
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                  Orphaned
                </Badge>
              ) : (
                user.tenants.map((t) => (
                  <Badge key={t.tenantId} variant="outline" className="text-xs">
                    {t.tenantName} ({t.roleCount})
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {timeAgo(user.lastLoginAt)}
          </span>
          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", selected && "rotate-90 text-primary")} />
        </div>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PlatformUsersPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const t = setTimeout(() => setDebouncedQuery(value), 300);
      setDebounceTimer(t);
    },
    [debounceTimer],
  );

  const { data, isLoading, error, refetch } = useQuery<{ users: UserSearchResult[] }>({
    queryKey: ["platform-users", debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      params.set("limit", "50");
      const d = await apiFetch(`/users?${params}`);
      return d as { users: UserSearchResult[] };
    },
    staleTime: 20_000,
  });

  const users = data?.users ?? [];

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Left panel — search + results */}
      <div className="flex flex-col w-full max-w-md border-r overflow-hidden flex-shrink-0">
        {/* Header */}
        <div className="px-5 py-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">User Search</h1>
              <p className="text-sm text-muted-foreground">Find any user across all campaigns</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              className="pl-9"
              autoFocus
            />
            {query && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => { setQuery(""); setDebouncedQuery(""); }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {!isLoading && !error && (
            <p className="text-xs text-muted-foreground">
              {debouncedQuery
                ? `${users.length} result${users.length !== 1 ? "s" : ""} for "${debouncedQuery}"`
                : `${users.length} user${users.length !== 1 ? "s" : ""} shown`}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive px-1">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {(error as Error).message}
            </div>
          )}

          {!isLoading && !error && users.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No users found</p>
              {debouncedQuery && (
                <p className="text-xs mt-1">Try a different name or email address</p>
              )}
            </div>
          )}

          {users.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              selected={selectedUserId === u.id}
              onClick={() => setSelectedUserId((prev) => (prev === u.id ? null : u.id))}
            />
          ))}
        </div>
      </div>

      {/* Right panel — detail / role inspector */}
      <div className="flex-1 overflow-hidden">
        {selectedUserId ? (
          <UserDetailPanel
            key={selectedUserId}
            userId={selectedUserId}
            onClose={() => setSelectedUserId(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
            <Shield className="h-12 w-12 mb-3 opacity-25" />
            <p className="font-medium text-base">Role Inspector</p>
            <p className="text-sm mt-1 max-w-xs">
              Select a user from the list to inspect their roles across all campaigns, fix access problems, or remove stale assignments.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
