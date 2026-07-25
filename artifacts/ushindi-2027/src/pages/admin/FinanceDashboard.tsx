import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DollarSign, TrendingUp, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtKES = (x: unknown) => (Number(x) / 1).toLocaleString("en-KE") + " KES";

const CHANNEL_COLORS: Record<string, string> = {
  mpesa: "bg-green-500",
  card: "bg-blue-500",
  bank_transfer: "bg-indigo-500",
  cash: "bg-orange-500",
  in_kind: "bg-purple-500",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border border-red-200",
  high: "bg-orange-100 text-orange-800 border border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  low: "bg-gray-100 text-gray-700 border border-gray-200",
};

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  isLoading,
}: {
  title: string;
  value?: string;
  icon: React.ElementType;
  color: string;
  isLoading?: boolean;
}) {
  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-32" />
      ) : (
        <p className={`text-2xl font-black font-mono ${color}`}>{value ?? "—"}</p>
      )}
    </div>
  );
}

export default function FinanceDashboard() {
  const [, setLocation] = useLocation();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["finance-dashboard"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/dashboard`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["finance-alerts-open"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/alerts?status=open`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const byChannel: { channel: string; total: number; count: number }[] = dashboard?.byChannel ?? [];
  const maxTotal = Math.max(...byChannel.map((c) => Number(c.total)), 1);
  const openAlerts: any[] = Array.isArray(alerts) ? alerts : [];

  return (
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase">
              FINANCE COMMAND CENTRE
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time campaign finance overview and alerts.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Raised"
            value={dashboard ? fmtKES(dashboard.totalRaisedKes) : undefined}
            icon={DollarSign}
            color="text-[#1D9BF0]"
            isLoading={isLoading}
          />
          <StatCard
            title="Today's Collection"
            value={dashboard ? fmtKES(dashboard.todayRaisedKes) : undefined}
            icon={TrendingUp}
            color="text-green-600"
            isLoading={isLoading}
          />
          <StatCard
            title="Open Alerts"
            value={dashboard ? String(dashboard.openAlerts ?? 0) : undefined}
            icon={AlertTriangle}
            color={
              Number(dashboard?.openAlerts) > 0 ? "text-red-600" : "text-muted-foreground"
            }
            isLoading={isLoading}
          />
          <StatCard
            title="Pending Verification"
            value={dashboard ? String(dashboard.pendingVerification ?? 0) : undefined}
            icon={Clock}
            color="text-yellow-600"
            isLoading={isLoading}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contributions by Channel */}
          <div className="bg-card border border-border p-5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
              Contributions by Channel
            </h2>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : byChannel.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data available.</p>
            ) : (
              <div className="space-y-3">
                {byChannel.map((c) => (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold uppercase tracking-wide">{c.channel.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground font-mono">
                        {fmtKES(c.total)} · {c.count} txns
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${CHANNEL_COLORS[c.channel] ?? "bg-gray-400"} rounded-full transition-all`}
                        style={{ width: `${Math.round((Number(c.total) / maxTotal) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open Alerts */}
          <div className="bg-card border border-border p-5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
              Open Alerts
            </h2>
            {alertsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : openAlerts.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-bold text-sm">No open alerts</span>
              </div>
            ) : (
              <div className="space-y-2">
                {openAlerts.slice(0, 6).map((alert: any) => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 border border-border">
                    <span
                      className={`px-2 py-0.5 text-xs font-black uppercase tracking-wider shrink-0 ${
                        SEVERITY_STYLES[alert.severity ?? "low"]
                      }`}
                    >
                      {alert.severity ?? "low"}
                    </span>
                    <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-card border border-border p-5 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
            Quick Actions
          </h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setLocation("/finance/contributions")}
              className="px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
            >
              View Contributions
            </button>
            <button
              onClick={() => setLocation("/finance/budget")}
              className="px-4 py-2 bg-black text-white text-sm font-bold hover:bg-gray-800 transition-colors"
            >
              Budget
            </button>
            <button
              onClick={() => setLocation("/finance/expenditure")}
              className="px-4 py-2 border border-border text-sm font-bold hover:bg-muted transition-colors"
            >
              Expenditure Requests
            </button>
          </div>
        </div>
      </div>
  );
}
