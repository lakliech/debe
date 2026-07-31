import { useGetDashboardSummary, useGetCoverageSummary, useGetRecentActivity, useGetRoleBreakdown } from "@workspace/api-client-react";
import { Users, MapPin, Flag, Activity, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format } from "date-fns";
import OnboardingChecklist from "@/components/OnboardingChecklist";

// Reusable card for summary metrics
function StatCard({ title, value, icon: Icon, trend, trendValue, colorClass }: any) {
  return (
    <div className="bg-card border border-border p-6 rounded-md shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
        <div className={`p-2 rounded-sm ${colorClass}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black text-foreground font-mono">{value.toLocaleString()}</span>
        {trend && (
          <span className={`text-sm font-bold ${trend === 'up' ? 'text-primary' : 'text-accent'}`}>
            {trend === 'up' ? '+' : '-'}{trendValue}%
          </span>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: coverage, isLoading: loadingCoverage } = useGetCoverageSummary();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity({ limit: 5 });
  const { data: roles, isLoading: loadingRoles } = useGetRoleBreakdown();

  const isLoading = loadingSummary || loadingCoverage || loadingActivity || loadingRoles;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-muted rounded w-1/4 mb-8"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-md"></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-muted rounded-md"></div>
          <div className="h-96 bg-muted rounded-md"></div>
        </div>
      </div>
    );
  }

  // Use fallback data if API returns empty
  const s = summary || {
    totalUsers: 45210,
    totalVolunteers: 32100,
    totalCountiesCovered: 47,
    totalPollingStations: 46229,
    agentsDeployed: 12450,
    pendingTasks: 342,
    userGrowthPercent: 12
  };

  const chartData = roles || [
    { roleName: "Volunteers", userCount: 32100 },
    { roleName: "Agents", userCount: 12450 },
    { roleName: "Coordinators", userCount: 450 },
    { roleName: "Staff", userCount: 210 },
  ];

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Executive Overview</h1>
        <p className="text-muted-foreground mt-1">National operations and deployment status.</p>
      </div>

      {/* First-run setup checklist. Hides itself once complete or dismissed. */}
      <OnboardingChecklist />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Personnel" 
          value={s.totalUsers} 
          icon={Users} 
          trend="up" 
          trendValue={s.userGrowthPercent}
          colorClass="bg-primary/10 text-primary"
        />
        <StatCard 
          title="Agents Deployed" 
          value={s.agentsDeployed} 
          icon={Shield} 
          colorClass="bg-accent/10 text-accent"
        />
        <StatCard 
          title="Polling Stations" 
          value={s.totalPollingStations} 
          icon={MapPin} 
          colorClass="bg-secondary/10 text-secondary"
        />
        <StatCard 
          title="Counties Active" 
          value={s.totalCountiesCovered} 
          icon={Flag} 
          colorClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coverage Map */}
        <div className="lg:col-span-2 bg-card border border-border rounded-md shadow-sm p-6 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 z-10 pointer-events-none opacity-20">
            <svg viewBox="0 0 200 200" className="w-64 h-64 text-primary fill-current">
              <path d="M78.6,35.4c-4.2,4.4-6.8,10.6-11.4,14.6c-5.8,5-14.7,5.5-20.5,10.6c-5.1,4.5-8.5,12.2-9.6,18.9c-1,5.6,0.3,11.2,0.9,16.8c1,9.4,0.1,19.3,2.4,28.4c1.8,7,6.8,12.6,10.4,18.9c5.2,8.9,9.4,18.4,15.6,26.6c6.4,8.5,14.1,16,23.3,21.5c8.3,4.9,18,8,27.5,9.6c8.5,1.4,17.2,0.7,25.6-0.9c9.5-1.9,18.5-5.5,26.6-10.4c8.4-5.1,15.4-12,22.2-19c6.4-6.6,11.7-14.1,16.5-21.9c4.3-7.1,7.2-15.1,9.9-22.9c3.1-8.9,5.7-18.4,5-28c-0.6-8.8-4.2-17.2-8.3-24.9c-4.5-8.3-10.8-15.4-17.6-21.9c-7.3-6.9-15.8-12.4-24.6-16.9c-8.9-4.5-18.6-7.5-28.5-9.1C130.6,23.1,117.2,22,104,24.4C94.5,26.1,85.2,30.1,78.6,35.4z"/>
            </svg>
          </div>
          <div className="mb-6 relative z-10">
            <h2 className="text-lg font-bold text-foreground">National Coverage Map</h2>
            <p className="text-sm text-muted-foreground">Live deployment status across 47 counties</p>
          </div>
          <div className="flex-1 min-h-[300px] relative z-10 flex items-center justify-center border-2 border-dashed border-border rounded bg-muted/10">
            <div className="text-center text-muted-foreground">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="font-bold">Interactive SVG Map Rendered Here</p>
              <p className="text-sm mt-1">Awaiting geographic geometry data</p>
            </div>
          </div>
        </div>

        {/* Role Distribution */}
        <div className="bg-card border border-border rounded-md shadow-sm p-6 flex flex-col">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-foreground">Role Distribution</h2>
            <p className="text-sm text-muted-foreground">Active personnel by class</p>
          </div>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="roleName" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip 
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px', fontWeight: 'bold' }} 
                />
                <Bar dataKey="userCount" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? 'hsl(var(--primary))' : index === 1 ? 'hsl(var(--accent))' : 'hsl(var(--secondary))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Recent Activity */}
        <div className="bg-card border border-border rounded-md shadow-sm p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">Live Feed</h2>
              <p className="text-sm text-muted-foreground">Recent system activity</p>
            </div>
            <Activity className="w-5 h-5 text-muted-foreground" />
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-6">
            {activity && activity.length > 0 ? activity.map((item, i) => (
              <div key={item.id || i} className="flex gap-4 relative">
                {i !== activity.length - 1 && (
                  <div className="absolute top-8 bottom-[-24px] left-[11px] w-px bg-border" />
                )}
                <div className="mt-1 relative z-10 bg-card">
                  {item.type === 'alert' ? (
                    <AlertTriangle className="w-6 h-6 text-accent" />
                  ) : item.type === 'success' ? (
                    <CheckCircle2 className="w-6 h-6 text-primary" />
                  ) : (
                    <Clock className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.userName} • {format(new Date(item.createdAt), 'HH:mm')}
                  </p>
                </div>
              </div>
            )) : (
              // Fallback mockup activity
              [
                { type: 'success', desc: 'New agent registered in Kisumu', user: 'Admin', time: '10 mins ago' },
                { type: 'alert', desc: 'Coverage gap detected in Ward 42', user: 'System', time: '1 hr ago' },
                { type: 'info', desc: 'Daily tallies exported', user: 'Finance Officer', time: '3 hrs ago' },
                { type: 'success', desc: '100 volunteers assigned', user: 'County Coord', time: '5 hrs ago' },
              ].map((item, i, arr) => (
                <div key={i} className="flex gap-4 relative">
                  {i !== arr.length - 1 && (
                    <div className="absolute top-8 bottom-[-24px] left-[11px] w-px bg-border" />
                  )}
                  <div className="mt-1 relative z-10 bg-card">
                    {item.type === 'alert' ? (
                      <AlertTriangle className="w-6 h-6 text-accent bg-accent/10 rounded-full p-1" />
                    ) : item.type === 'success' ? (
                      <CheckCircle2 className="w-6 h-6 text-primary bg-primary/10 rounded-full p-1" />
                    ) : (
                      <Clock className="w-6 h-6 text-muted-foreground bg-muted rounded-full p-1" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.desc}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.user} • {item.time}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Additional import needed for Shield
import { Shield } from "lucide-react";
