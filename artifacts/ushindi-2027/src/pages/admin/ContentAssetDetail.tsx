import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, Copy, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const APPROVAL_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const RIGHTS_BADGE: Record<string, string> = {
  internal: "bg-gray-100 text-gray-700",
  restricted: "bg-orange-100 text-orange-800",
  public: "bg-blue-100 text-blue-800",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function ContentAssetDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: asset, isLoading } = useQuery({
    queryKey: ["content-asset", id],
    queryFn: () =>
      fetch(`${BASE}/api/content/assets/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  const { data: history } = useQuery({
    queryKey: ["content-asset-history", id],
    queryFn: () =>
      fetch(`${BASE}/api/content/assets/${id}/history`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["content-asset", id] });

  const { mutate: approveAsset, isPending: approving } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/content/assets/${id}/approve`, { method: "POST", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Asset approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: rejectAsset, isPending: rejecting } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/content/assets/${id}/reject`, { method: "POST", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Asset rejected" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: downloadAsset, isPending: downloading } = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/content/assets/${id}/download`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "view" }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setDownloadPath(data?.objectPath ?? data?.url ?? "—");
      toast({ title: "Download link ready" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  function copyPath() {
    if (downloadPath) {
      navigator.clipboard.writeText(downloadPath).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  if (isLoading) {
    return (
        <div className="space-y-4 animate-pulse">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48 w-full" />
        </div>
    );
  }

  const a = asset ?? {};
  const versions: any[] = Array.isArray(a.versions) ? a.versions : [];
  const historyList: any[] = Array.isArray(history) ? history : [];

  return (
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/content-library")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Content Library
        </button>

        {/* Header */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-2xl font-extrabold uppercase tracking-tight">{a.title ?? "Asset"}</h1>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-3 py-1 text-xs font-black uppercase ${APPROVAL_BADGE[a.approvalStatus] ?? "bg-gray-100 text-gray-700"}`}>
                {a.approvalStatus ?? "—"}
              </span>
              <span className={`px-3 py-1 text-xs font-black uppercase ${RIGHTS_BADGE[a.publishingRights] ?? "bg-gray-100 text-gray-700"}`}>
                {a.publishingRights ?? "—"}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Category" value={(a.category ?? "—").replace(/_/g, " ")} />
            <Field label="MIME Type" value={a.mimeType} />
            <Field label="Version" value={a.version ? `v${a.version}` : null} />
            <Field label="Downloads" value={String(a.downloadCount ?? 0)} />
            <Field label="Expires" value={a.expiresAt ? fmtDate(a.expiresAt) : "Never"} />
            <Field label="Created" value={a.createdAt ? fmtDate(a.createdAt) : null} />
          </div>
          {a.description && (
            <div className="mt-4 p-3 bg-muted/30">
              <p className="text-sm text-muted-foreground">{a.description}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => downloadAsset()}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Get Download Link
          </button>
          {a.approvalStatus === "pending" && (
            <>
              <button
                onClick={() => approveAsset()}
                disabled={approving}
                className="px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => rejectAsset()}
                disabled={rejecting}
                className="px-4 py-2 text-sm font-bold border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
        </div>

        {/* Download Path */}
        {downloadPath && (
          <div className="bg-muted/30 border border-border p-4 flex items-center gap-3">
            <p className="text-sm font-mono flex-1 break-all">{downloadPath}</p>
            <button
              onClick={copyPath}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-border hover:bg-muted transition-colors shrink-0"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        {/* Versions */}
        {versions.length > 0 && (
          <div className="bg-card border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Versions</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Version", "Object Path", "Change Note", "Date"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((v: any, i: number) => (
                  <tr key={v.id ?? i} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono font-bold">v{v.version ?? i + 1}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{v.objectPath ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.changeNote ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.createdAt ? fmtDate(v.createdAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Download History */}
        {historyList.length > 0 && (
          <div className="bg-card border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Download History</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Downloaded By", "Purpose", "Date"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historyList.slice(0, 20).map((h: any, i: number) => (
                  <tr key={h.id ?? i} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 text-muted-foreground">{h.downloadedByEmail ?? "—"}</td>
                    <td className="px-4 py-3">{h.purpose ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{h.createdAt ? fmtDate(h.createdAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
}
