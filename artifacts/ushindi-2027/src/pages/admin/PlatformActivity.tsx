/**
 * Platform Activity Log — every audited platform action across every campaign.
 *
 * Backed by GET /api/platform/activity, which only platform standing can
 * reach (a campaign administrator — even a campaign super-admin — gets 403).
 * Filterable by campaign, action and operator; newest first.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, ChevronDown } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE = 50;

interface ActivityRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  newValue: string | null;
  oldValue: string | null;
  createdAt: string | null;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
}

const KNOWN_ACTIONS = [
  "platform.tenant.create",
  "platform.tenant.suspend",
  "platform.tenant.resume",
  "platform.tenant.schedule-deletion",
  "platform.tenant.cancel-deletion",
  "platform.tenant.purge",
  "platform.tenant.rename",
  "platform.tenant.plan-change",
  "platform.domain-request.review",
  "platform.membership.grant",
  "platform.campaign.enter",
  "platform.campaign.exit",
  "assign_role",
  "remove_role",
];

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailsCell({ row }: { row: ActivityRow }) {
  const raw = row.newValue ?? row.oldValue;
  if (!raw) return <span className="text-muted-foreground">—</span>;
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* leave raw */
  }
  return (
    <details className="max-w-xs">
      <summary className="cursor-pointer text-primary hover:underline text-xs font-medium">
        details
      </summary>
      <pre className="mt-1 p-2 bg-muted/50 border border-border rounded-sm text-[11px] overflow-x-auto whitespace-pre-wrap">
        {pretty}
      </pre>
    </details>
  );
}

export default function PlatformActivity() {
  const { data: tenants } = useQuery<any[]>({
    queryKey: ["/api/platform/tenants"],
    queryFn: () =>
      fetch(`${BASE}/api/platform/tenants`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : [],
      ),
    staleTime: 60_000,
  });

  const [tenantId, setTenantId] = useState("");
  const [action, setAction] = useState("");
  // Operator filter is server-side (spans every page of results), debounced.
  const [emailInput, setEmailInput] = useState("");
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (tenantId) params.set("tenantId", tenantId);
      if (action) params.set("action", action);
      if (email) params.set("email", email);
      const res = await fetch(`${BASE}/api/platform/activity?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load activity log (${res.status})`);
      const batch: ActivityRow[] = await res.json();
      setRows((prev) => (offset === 0 ? batch : [...prev, ...batch]));
      setExhausted(batch.length < PAGE);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Debounce the operator filter before reloading from the API.
  useEffect(() => {
    const t = setTimeout(() => setEmail(emailInput.trim()), 400);
    return () => clearTimeout(t);
  }, [emailInput]);

  // Reload from the top whenever the server-side filters change.
  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, action, email]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 border border-primary/20 rounded-sm">
          <Activity className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight text-foreground">Platform Activity Log</h1>
          <p className="text-sm text-muted-foreground">
            Every platform-level action across every campaign — who, what, where, when.
          </p>
        </div>
        <button
          onClick={() => load(0)}
          disabled={loading}
          className="ml-auto flex items-center gap-2 text-sm border border-border rounded-sm px-3 py-1.5 hover:bg-muted/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-sm p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Campaign
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="normal-case tracking-normal text-sm font-normal text-foreground bg-background border border-border rounded-sm px-3 py-1.5 min-w-[180px]"
          >
            <option value="">All campaigns</option>
            {(tenants ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Action
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            list="platform-action-options"
            placeholder="e.g. platform.tenant.create"
            className="normal-case tracking-normal text-sm font-normal text-foreground bg-background border border-border rounded-sm px-3 py-1.5 min-w-[220px] font-mono"
          />
          <datalist id="platform-action-options">
            {KNOWN_ACTIONS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Operator email
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="operator@email…"
            className="normal-case tracking-normal text-sm font-normal text-foreground bg-background border border-border rounded-sm px-3 py-1.5 min-w-[200px]"
          />
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* Log table */}
      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Operator</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {formatTime(r.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{r.userFullName || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.userEmail}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block font-mono text-xs bg-muted/60 border border-border rounded-sm px-2 py-1">
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {r.tenantName ? (
                    <>
                      <div className="font-medium text-foreground">{r.tenantName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.tenantSlug}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <DetailsCell row={r} />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No activity recorded for those filters yet.
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!exhausted && rows.length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={() => load(rows.length)}
            disabled={loading}
            className="flex items-center gap-2 text-sm border border-border rounded-sm px-4 py-2 hover:bg-muted/50 disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
