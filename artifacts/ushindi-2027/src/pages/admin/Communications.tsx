import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, MessageSquare, Mic, Users, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-800",
  published: "bg-emerald-100 text-emerald-800",
  retracted: "bg-red-100 text-red-900",
  pending: "bg-yellow-100 text-yellow-800",
  sent: "bg-blue-100 text-blue-800",
};

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  isLoading,
}: {
  title: string;
  value?: number | string;
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
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className={`text-3xl font-black font-mono ${color}`}>{value ?? "—"}</p>
      )}
    </div>
  );
}

export default function Communications() {
  const [, setLocation] = useLocation();

  const { data: templates, isLoading: tLoading } = useQuery({
    queryKey: ["comms-templates"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/templates`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: messages, isLoading: mLoading } = useQuery({
    queryKey: ["comms-messages-recent"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/messages?limit=5`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const { data: statements, isLoading: sLoading } = useQuery({
    queryKey: ["comms-statements-recent"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/statements?limit=5`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const { data: spokespeople } = useQuery({
    queryKey: ["spokespeople"],
    queryFn: () =>
      fetch(`${BASE}/api/communications/spokespeople`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const templateList: any[] = Array.isArray(templates) ? templates : [];
  const approvedTemplates = templateList.filter((t) => t.status === "approved").length;
  const msgList: any[] = Array.isArray(messages?.data) ? messages.data : Array.isArray(messages) ? messages : [];
  const pendingMsgs = msgList.filter((m) => m.status === "pending" || m.status === "scheduled").length;
  const spokespeopleList: any[] = Array.isArray(spokespeople) ? spokespeople : [];
  const activeSpokespeople = spokespeopleList.filter((s) => s.status === "active" || !s.status).length;
  const statementList: any[] = Array.isArray(statements) ? statements : [];

  const quickLinks = [
    { label: "Message Templates", href: "/communications/templates", icon: MessageSquare, color: "text-[#1D9BF0]" },
    { label: "Press Statements", href: "/communications/statements", icon: FileText, color: "text-purple-600" },
    { label: "Content Library", href: "/content-library", icon: FileText, color: "text-orange-600" },
    { label: "Spokespeople", href: "/communications/statements", icon: Mic, color: "text-green-600" },
  ];

  return (
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight uppercase">COMMUNICATIONS COMMAND CENTRE</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage messages, statements, and content distribution.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Templates" value={templateList.length} icon={MessageSquare} color="text-[#1D9BF0]" isLoading={tLoading} />
          <StatCard title="Approved Templates" value={approvedTemplates} icon={MessageSquare} color="text-green-600" isLoading={tLoading} />
          <StatCard title="Scheduled Messages" value={pendingMsgs} icon={FileText} color="text-yellow-600" isLoading={mLoading} />
          <StatCard title="Active Spokespeople" value={activeSpokespeople} icon={Users} color="text-purple-600" />
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {quickLinks.map((link) => (
            <button
              key={link.href + link.label}
              onClick={() => setLocation(link.href)}
              className="bg-card border border-border p-4 shadow-sm text-left hover:bg-muted/30 transition-colors group"
            >
              <link.icon className={`h-6 w-6 mb-3 ${link.color}`} />
              <p className="font-bold text-sm">{link.label}</p>
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                Open <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Messages */}
          <div className="bg-card border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Recent Scheduled Messages</h2>
              <button onClick={() => setLocation("/communications/templates")} className="text-xs text-[#1D9BF0] font-bold hover:underline">View all</button>
            </div>
            {mLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : msgList.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent messages.</p>
            ) : (
              <div className="space-y-2">
                {msgList.slice(0, 5).map((msg: any) => (
                  <div key={msg.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium">{msg.subject ?? msg.templateName ?? "Message"}</p>
                      <p className="text-xs text-muted-foreground">{msg.scheduledAt ? fmtDate(msg.scheduledAt) : "—"}</p>
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[msg.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {msg.status ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Statements */}
          <div className="bg-card border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Recent Statements</h2>
              <button onClick={() => setLocation("/communications/statements")} className="text-xs text-[#1D9BF0] font-bold hover:underline">View all</button>
            </div>
            {sLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : statementList.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent statements.</p>
            ) : (
              <div className="space-y-2">
                {statementList.slice(0, 5).map((stmt: any) => (
                  <div key={stmt.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium">{stmt.title ?? "—"}</p>
                      <span className={`inline-block px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[stmt.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {stmt.status ?? "—"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5">{stmt.category ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
