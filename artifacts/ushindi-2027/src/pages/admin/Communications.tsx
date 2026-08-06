import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, MessageSquare, Mic, Users, ArrowRight, Inbox, Send, CheckCircle2 } from "lucide-react";
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

function WhatsAppInbox() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["comms-tickets"],
    refetchInterval: 30_000,
    queryFn: () =>
      fetch(`${BASE}/api/communications/tickets`, { credentials: "include" }).then((r) => r.json()),
  });

  const { data: openTicket } = useQuery({
    queryKey: ["comms-ticket", openId],
    enabled: !!openId,
    refetchInterval: 15_000,
    queryFn: () =>
      fetch(`${BASE}/api/communications/tickets/${openId}`, { credentials: "include" }).then((r) => r.json()),
  });

  const reply = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/communications/tickets/${openId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error ?? "Send failed");
      }
      return r.json();
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["comms-ticket", openId] });
      qc.invalidateQueries({ queryKey: ["comms-tickets"] });
    },
  });

  const resolveTicket = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${BASE}/api/communications/tickets/${id}/resolve`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Resolve failed");
      return r.json();
    },
    onSuccess: () => {
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ["comms-tickets"] });
    },
  });

  const list: any[] = Array.isArray(tickets) ? tickets : [];
  const msgs: any[] = Array.isArray(openTicket?.messages) ? openTicket.messages : [];
  const openCount = list.filter((t) => t.status !== "resolved").length;

  return (
    <div className="bg-card border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Inbox className="h-4 w-4 text-green-600" /> Supporter Inbox — WhatsApp
        </h2>
        <span className="text-xs font-bold text-muted-foreground">{openCount} open</span>
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No WhatsApp conversations yet. Once the campaign's WhatsApp Business number is connected,
          inbound supporter and agent messages will appear here as tickets.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {list.map((t: any) => (
            <div key={t.id}>
              <button
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {t.contactName ?? t.supporterName ?? t.waPhone}
                    {t.category === "agent" && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-blue-100 text-blue-800">Agent</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{t.subject ?? t.waPhone}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {t.unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-xs font-black bg-green-600 text-white rounded-full">{t.unreadCount}</span>
                  )}
                  <span className={`px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[t.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {t.status}
                  </span>
                </div>
              </button>

              {openId === t.id && (
                <div className="pb-4 pl-2 pr-1 space-y-3">
                  <div className="max-h-64 overflow-y-auto space-y-2 bg-muted/20 p-3">
                    {msgs.length === 0 && <p className="text-xs text-muted-foreground">Loading conversation…</p>}
                    {msgs.map((m: any) => (
                      <div key={m.id} className={`max-w-[80%] px-3 py-2 text-sm ${m.direction === "inbound" ? "bg-muted text-foreground" : "bg-green-600 text-white ml-auto"}`}>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className={`text-[10px] mt-1 ${m.direction === "inbound" ? "text-muted-foreground" : "text-green-100"}`}>
                          {m.direction === "inbound" ? (m.senderName ?? t.waPhone) : (m.senderName ?? "Campaign team")} · {fmtDate(m.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                  {reply.isError && <p className="text-xs text-red-600 font-medium">{(reply.error as Error).message}</p>}
                  <div className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Reply on WhatsApp…"
                      className="flex-1 border border-border bg-background px-3 py-2 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && !reply.isPending) reply.mutate(); }}
                    />
                    <button
                      onClick={() => reply.mutate()}
                      disabled={!draft.trim() || reply.isPending}
                      className="px-3 py-2 bg-green-600 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1"
                    >
                      <Send className="h-4 w-4" /> Send
                    </button>
                    <button
                      onClick={() => resolveTicket.mutate(t.id)}
                      disabled={resolveTicket.isPending}
                      className="px-3 py-2 border border-border text-sm font-bold text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Resolve
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
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

        {/* WhatsApp supporter inbox (two-way ticketing) */}
        <WhatsAppInbox />
      </div>
  );
}
