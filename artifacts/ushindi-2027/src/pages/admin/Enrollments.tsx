import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/enrollments${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Request failed (${r.status})`);
  return r.json();
}

const STATUS_FILTERS = ["pending", "approved", "rejected"] as const;

export default function Enrollments() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["enrollments-queue", status],
    queryFn: () => api<any[]>(`?status=${status}`),
    refetchInterval: 30_000,
  });

  const act = async (id: string, action: "approve" | "reject") => {
    setBusy(id); setError(null);
    try {
      const body = action === "reject" ? { reason: window.prompt("Reason for rejection (visible to the applicant):") ?? "" } : undefined;
      if (action === "reject" && (!body || body.reason.trim().length < 3)) { setBusy(null); return; }
      await api(`/${id}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await queue.refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const rows = queue.data ?? [];

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight uppercase flex items-center gap-2"><UserPlus className="h-6 w-6 text-primary" />Enrollment Applications</h1>
        <p className="text-muted-foreground text-sm mt-1">New volunteers and polling agents apply through onboarding. Approve to grant access and create their record.</p>
      </div>

      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("px-4 py-2 text-xs font-black uppercase tracking-wider border", status === s ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {s}
          </button>
        ))}
      </div>

      {error && <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 p-2">{error}</p>}

      {queue.isLoading ? <Skeleton className="h-48 w-full" /> : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border">
              <tr>{["Applicant", "Role", "Contact", "National ID", "Applied", status === "pending" ? "Actions" : "Outcome"].map((c) => <th key={c} className="px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">No {status} applications.</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-border">
                  <td className="px-4 py-2.5 font-bold">{e.fullName}</td>
                  <td className="px-4 py-2.5"><span className={cn("text-xs font-bold uppercase px-2 py-0.5", e.intendedRole === "polling-agent" ? "bg-indigo-100 text-indigo-700" : "bg-green-100 text-green-700")}>{e.intendedRole.replace("-", " ")}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.email}<br />{e.phoneNumber}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{e.nationalId ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    {status === "pending" ? (
                      <div className="flex gap-2">
                        <button disabled={busy === e.id} onClick={() => act(e.id, "approve")} className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 text-xs font-bold uppercase disabled:opacity-50"><Check className="h-3 w-3" />Approve</button>
                        <button disabled={busy === e.id} onClick={() => act(e.id, "reject")} className="flex items-center gap-1 border border-red-300 text-red-700 px-3 py-1.5 text-xs font-bold uppercase disabled:opacity-50"><X className="h-3 w-3" />Reject</button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{e.status === "rejected" && e.reviewReason ? e.reviewReason : e.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
