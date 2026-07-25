import { useState } from "react";
import { AlertTriangle, MapPin, Users, Activity } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import {
  useGetCoordinatorDashboard,
  useGetVolunteerCoverage,
  useGetCoverageGapAlerts,
  useListCoordinatorVolunteers,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type Scope = "national" | "county" | "constituency" | "ward";

function StatTile({ title, value, color }: { title: string; value?: number | null; color: string }) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {value == null ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className={cn("text-3xl font-black font-mono", color)}>{value.toLocaleString()}</p>
      )}
    </div>
  );
}

export default function Coordinator() {
  const [scope, setScope] = useState<Scope>("national");
  const [scopeId, setScopeId] = useState("");
  const [volPage, setVolPage] = useState(1);

  const { data: dashboard, isLoading: loadingDash } = useGetCoordinatorDashboard(
    scope !== "national" && scopeId ? { scope, id: scopeId } : { scope: "national" }
  );
  const { data: coverage, isLoading: loadingCoverage } = useGetVolunteerCoverage();
  const { data: gaps } = useGetCoverageGapAlerts();
  const { data: volList, isLoading: loadingVols } = useListCoordinatorVolunteers({
    countyId: scope === "county" ? scopeId : undefined,
    page: volPage,
  });

  const dash = dashboard as any;
  const coverageList: any[] = Array.isArray(coverage) ? coverage : [];
  const volData: any = volList;
  const gapData: any = gaps;

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase">Field Coordinator Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor volunteer coverage and ground operations across Kenya.</p>
        </div>

        {/* Scope selector */}
        <div className="flex flex-wrap gap-3 items-center border border-border p-4 bg-muted/20 shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">View Scope:</span>
          </div>
          <select
            value={scope}
            onChange={(e) => { setScope(e.target.value as Scope); setScopeId(""); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary font-medium"
          >
            <option value="national">🇰🇪 National</option>
            <option value="county">County</option>
            <option value="constituency">Constituency</option>
            <option value="ward">Ward</option>
          </select>
          {scope !== "national" && (
            <input
              type="text"
              placeholder={`Enter ${scope} ID...`}
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary min-w-[200px] font-medium"
            />
          )}
        </div>

        {/* Gap alerts */}
        {gapData?.lowCoverageCounties?.length > 0 && (
          <div className="border-l-4 border-red-500 bg-red-50 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-sm text-red-800 uppercase tracking-wide">Coverage Alert</p>
              <p className="text-sm text-red-700 mt-1">
                {gapData.lowCoverageCounties.length} {gapData.lowCoverageCounties.length === 1 ? "county" : "counties"} have critically low volunteer coverage.
                {gapData.stalePendingCount > 0 && ` ${gapData.stalePendingCount} volunteers have been pending for over 7 days.`}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {gapData.lowCoverageCounties.slice(0, 8).map((c: any) => (
                  <span key={c.id ?? c.code} className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5">{c.name ?? c.code}</span>
                ))}
                {gapData.lowCoverageCounties.length > 8 && (
                  <span className="text-xs text-red-600 font-bold">+{gapData.lowCoverageCounties.length - 8} more</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dashboard stats */}
        {loadingDash ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile title="Total Volunteers" value={dash?.volunteers?.total} color="text-foreground" />
            <StatTile title="Active" value={dash?.volunteers?.active} color="text-green-600" />
            <StatTile title="Pending Approval" value={dash?.volunteers?.pending} color="text-yellow-600" />
            <StatTile title="Supporters" value={dash?.supporters?.total} color="text-primary" />
          </div>
        )}

        {/* Coverage table */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <h2 className="font-black text-sm uppercase tracking-wider">County Coverage ({coverageList.length} counties)</h2>
            {loadingCoverage && <Skeleton className="h-4 w-16" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  {["County", "Total Volunteers", "Active", "Coverage Rate"].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverageList.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No coverage data available.
                    </td>
                  </tr>
                )}
                {coverageList
                  .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
                  .map((c) => {
                    const rate = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
                    const isLow = c.active === 0 && c.total === 0;
                    return (
                      <tr key={c.countyId} className={cn("border-b border-border hover:bg-muted/20 transition-colors", isLow && "bg-red-50/50")}>
                        <td className="px-4 py-3 font-bold text-sm">
                          <span className="text-muted-foreground text-xs font-medium mr-2">{c.countyCode}</span>
                          {c.countyName}
                          {isLow && <span className="ml-2 text-xs text-red-600 font-black">⚠ ZERO</span>}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold">{(c.total ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-green-700 font-bold">{(c.active ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full max-w-[80px]">
                              <div
                                className={cn("h-2 rounded-full", rate >= 70 ? "bg-green-500" : rate >= 40 ? "bg-yellow-500" : "bg-red-500")}
                                style={{ width: `${Math.min(rate, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-muted-foreground">{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent volunteers from dashboard */}
        {dash?.recentVolunteers && Array.isArray(dash.recentVolunteers) && dash.recentVolunteers.length > 0 && (
          <div className="border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h2 className="font-black text-sm uppercase tracking-wider">Recent Volunteer Registrations</h2>
            </div>
            <div className="divide-y divide-border">
              {dash.recentVolunteers.slice(0, 5).map((v: any) => (
                <div key={v.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors">
                  <div className="w-8 h-8 bg-primary/10 text-primary flex items-center justify-center font-black text-sm shrink-0">
                    {(v.fullName ?? "V").charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{v.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{v.phoneNumber} · {v.countyId ?? "—"}</p>
                  </div>
                  <span className={cn("text-xs font-bold px-2 py-0.5 uppercase",
                    v.status === "active" ? "bg-green-100 text-green-800" :
                    v.status === "pending" ? "bg-yellow-100 text-yellow-800" :
                    "bg-gray-100 text-gray-700"
                  )}>
                    {v.status}
                  </span>
                  <Link href={`/volunteers/${v.id}`} className="text-xs font-bold text-primary hover:underline shrink-0">View</Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Coordinator volunteer list */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <h2 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Volunteer List {scope !== "national" && `— ${scope} scope`}
            </h2>
          </div>
          {loadingVols ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    {["Name", "Phone", "Location", "Role", "Status"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {((volData?.data ?? []) as any[]).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No volunteers found for this scope.
                      </td>
                    </tr>
                  ) : (
                    (volData?.data ?? []).map((v: any) => (
                      <tr key={v.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-bold text-sm">
                          <Link href={`/volunteers/${v.id}`} className="hover:text-primary transition-colors">{v.fullName}</Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{v.phoneNumber}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{v.countyId ?? "—"}</td>
                        <td className="px-4 py-3 text-xs">{v.preferredRole ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("px-2 py-0.5 text-xs font-bold uppercase",
                            v.status === "active" ? "bg-green-100 text-green-800" :
                            v.status === "pending" ? "bg-yellow-100 text-yellow-800" :
                            "bg-gray-100 text-gray-700"
                          )}>
                            {v.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {/* Pagination */}
              {(volData?.total ?? 0) > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground font-medium">
                    Showing {((volPage - 1) * 20) + 1}–{Math.min(volPage * 20, volData?.total ?? 0)} of {(volData?.total ?? 0).toLocaleString()}
                  </span>
                  <div className="flex gap-2">
                    <button disabled={volPage <= 1} onClick={() => setVolPage(p => p - 1)} className="px-3 py-1.5 text-xs font-bold border border-border disabled:opacity-50 hover:bg-muted transition-colors">← Prev</button>
                    <button disabled={volPage * 20 >= (volData?.total ?? 0)} onClick={() => setVolPage(p => p + 1)} className="px-3 py-1.5 text-xs font-bold border border-border disabled:opacity-50 hover:bg-muted transition-colors">Next →</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
