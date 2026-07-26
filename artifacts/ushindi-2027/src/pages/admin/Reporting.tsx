import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileText, Table, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Report {
  id: string;
  label: string;
  formats: string[];
}

const REPORT_CATEGORIES = [
  {
    label: "People & Organisation",
    reports: ["volunteers", "supporters", "polling-agents", "training-completions"],
  },
  {
    label: "Finance",
    reports: ["donations", "expenditure", "donor-summary", "agent-allowances"],
  },
  {
    label: "Election Operations",
    reports: ["polling-stations", "result-submissions", "tally-summary", "county-coverage"],
  },
  {
    label: "Incidents & Disputes",
    reports: ["incidents", "disputes", "rapid-response"],
  },
  {
    label: "Audit & Compliance",
    reports: ["audit-log", "export-log", "comms-reach", "event-attendance"],
  },
];

export default function ReportingPage() {
  const { toast } = useToast();
  const [selectedFormats, setSelectedFormats] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: reportsData } = useQuery<{ reports: Report[] }>({
    queryKey: ["reports-list"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/reporting/list`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load reports");
      return r.json();
    },
  });

  const { data: exportLog } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["export-log"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/reporting/export-log`, { credentials: "include" });
      if (!r.ok) return { data: [], total: 0 };
      return r.json();
    },
  });

  const reportMap = new Map<string, Report>(
    (reportsData?.reports ?? []).map((r) => [r.id, r])
  );

  async function handleDownload(reportId: string) {
    const format = selectedFormats[reportId] ?? "csv";
    setDownloading(reportId);
    try {
      const r = await fetch(`${BASE}/api/reporting/export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, format, filters: {} }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error ?? "Export failed");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportId}-${Date.now()}.${format === "excel" ? "xlsx" : "csv"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: `${reportId}.${format}` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Exports</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Download CSV or Excel reports. All exports are logged to the audit trail.
        </p>
      </div>

      {REPORT_CATEGORIES.map((cat) => (
        <Card key={cat.label}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">{cat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
              {cat.reports.map((reportId) => {
                const report = reportMap.get(reportId);
                const format = selectedFormats[reportId] ?? "csv";
                const isLoading = downloading === reportId;
                return (
                  <div
                    key={reportId}
                    className="flex items-center justify-between gap-3 rounded-md border px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {report?.label ?? reportId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {report?.formats.map((f) => f.toUpperCase()).join(" / ") ?? "CSV"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {report?.formats && report.formats.length > 1 && (
                        <Select
                          value={format}
                          onValueChange={(v) =>
                            setSelectedFormats((p) => ({ ...p, [reportId]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {report.formats.map((f) => (
                              <SelectItem key={f} value={f}>
                                {f.toUpperCase()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={isLoading}
                        onClick={() => handleDownload(reportId)}
                      >
                        {isLoading ? (
                          <span className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Export Audit Trail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Export History
          </CardTitle>
          <CardDescription>Last 20 exports — all downloads are immutably logged</CardDescription>
        </CardHeader>
        <CardContent>
          {!exportLog?.data?.length ? (
            <p className="text-sm text-muted-foreground">No exports yet.</p>
          ) : (
            <div className="space-y-2">
              {exportLog.data.map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-sm border rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    <span className="font-medium">{entry.reportType}</span>
                    <Badge variant="secondary" className="text-xs">
                      {entry.format?.toUpperCase()}
                    </Badge>
                    {entry.rowCount != null && (
                      <span className="text-muted-foreground">{entry.rowCount} rows</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {entry.downloadedAt
                      ? new Date(entry.downloadedAt).toLocaleString()
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
