import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, Inbox, MailOpen, MailCheck, Archive,
  ChevronLeft, ChevronRight, Loader2, Reply, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE_SIZE = 25;

type Status = "open" | "read" | "replied" | "archived";

interface MessageSummary {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  status: Status;
  createdAt: string;
  repliedAt: string | null;
}

interface MessageDetail extends MessageSummary {
  message: string;
  replyNote: string | null;
}

interface ListResponse {
  data: MessageSummary[];
  total: number;
  page: number;
}

/** Prefixes BASE; callers pass bare `/api/...` paths. */
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const STATUS_META: Record<Status, { label: string; icon: React.ElementType; classes: string }> = {
  open:     { label: "Open",     icon: Inbox,     classes: "bg-blue-50 text-blue-700 border border-blue-200" },
  read:     { label: "Read",     icon: MailOpen,  classes: "bg-yellow-50 text-yellow-700 border border-yellow-200" },
  replied:  { label: "Replied",  icon: MailCheck, classes: "bg-green-50 text-green-700 border border-green-200" },
  archived: { label: "Archived", icon: Archive,   classes: "bg-gray-100 text-gray-500 border border-gray-200" },
};

function StatusBadge({ status }: { status: Status }) {
  const meta = STATUS_META[status] ?? STATUS_META.open;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded-sm", meta.classes)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

const TABS: { value: string; label: string }[] = [
  { value: "",         label: "All" },
  { value: "open",     label: "Open" },
  { value: "read",     label: "Read" },
  { value: "replied",  label: "Replied" },
  { value: "archived", label: "Archived" },
];

export default function ContactMessages() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab]   = useState("");
  const [page, setPage]             = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  // ── Counts ─────────────────────────────────────────────────────────────────
  const { data: counts } = useQuery<Record<string, number>>({
    queryKey: ["/api/contact-messages/counts"],
    queryFn: () => apiFetch("/api/contact-messages/counts"),
    refetchInterval: 30_000,
  });

  // ── List ───────────────────────────────────────────────────────────────────
  const listKey = ["/api/contact-messages", activeTab, page] as const;
  const { data: list, isLoading: listLoading } = useQuery<ListResponse>({
    queryKey: listKey,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (activeTab) params.set("status", activeTab);
      return apiFetch(`/api/contact-messages?${params}`);
    },
  });

  // ── Detail ─────────────────────────────────────────────────────────────────
  const { data: detail, isLoading: detailLoading } = useQuery<MessageDetail>({
    queryKey: ["/api/contact-messages", selectedId],
    queryFn: () => apiFetch(`/api/contact-messages/${selectedId}`),
    enabled: !!selectedId,
  });

  // After fetching a message the server auto-advances open→read; re-sync counts + list.
  // useEffect is the React Query v5-compatible replacement for onSuccess.
  useEffect(() => {
    if (detail?.id) {
      qc.invalidateQueries({ queryKey: ["/api/contact-messages/counts"] });
      qc.invalidateQueries({ queryKey: ["/api/contact-messages", activeTab, page] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const handleOpen = (id: string) => {
    setSelectedId(id);
    setReplyDraft("");
  };

  // ── Patch mutation ─────────────────────────────────────────────────────────
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiFetch(`/api/contact-messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (updated: MessageDetail) => {
      qc.setQueryData(["/api/contact-messages", updated.id], updated);
      qc.invalidateQueries({ queryKey: ["/api/contact-messages"] });
      qc.invalidateQueries({ queryKey: ["/api/contact-messages/counts"] });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleReply = () => {
    if (!detail) return;
    const note = replyDraft || detail.replyNote || "";
    patch.mutate(
      { id: detail.id, body: { status: "replied", replyNote: note } },
      { onSuccess: () => toast({ title: "Saved", description: "Reply note saved and status set to Replied." }) },
    );
  };

  const handleArchive = (id: string) => {
    patch.mutate(
      { id, body: { status: "archived" } },
      { onSuccess: () => { setSelectedId(null); toast({ title: "Archived" }); } },
    );
  };

  const handleReopen = (id: string) => {
    patch.mutate(
      { id, body: { status: "open" } },
      { onSuccess: () => toast({ title: "Reopened", description: "Message marked as open." }) },
    );
  };

  const totalPages = Math.ceil((list?.total ?? 0) / PAGE_SIZE);
  const allCount   = Object.values(counts ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-black tracking-tight">Contact Messages</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {counts?.open
                ? <span className="text-blue-600 font-semibold">{counts.open} open</span>
                : "No open messages"
              }
              {" · "}{list?.total ?? "…"} total
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          qc.invalidateQueries({ queryKey: ["/api/contact-messages"] });
          qc.invalidateQueries({ queryKey: ["/api/contact-messages/counts"] });
        }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-0 border-b border-border bg-muted/30 px-8">
        {TABS.map((tab) => {
          const cnt = tab.value ? (counts?.[tab.value] ?? 0) : allCount;
          const active = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => { setActiveTab(tab.value); setPage(1); }}
              className={cn(
                "px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5",
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {cnt > 0 && (
                <span className={cn(
                  "text-[10px] font-black px-1.5 py-0.5 rounded-full",
                  active
                    ? "bg-primary/10 text-primary"
                    : tab.value === "open"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-muted text-muted-foreground",
                )}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {listLoading ? (
          <div className="px-8 py-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (list?.data.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <MailOpen className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">
              No messages{activeTab ? ` with status "${activeTab}"` : ""}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs font-black uppercase tracking-wider text-muted-foreground">
                <th className="px-8 py-3 text-left">Sender</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Received</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list?.data.map((msg) => (
                <tr
                  key={msg.id}
                  className={cn(
                    "hover:bg-muted/30 transition-colors cursor-pointer",
                    msg.status === "open" ? "font-semibold" : "",
                  )}
                  onClick={() => handleOpen(msg.id)}
                >
                  <td className="px-8 py-3.5">
                    <div className="font-medium">{msg.fullName}</div>
                    <div className="text-xs text-muted-foreground">{msg.email}</div>
                  </td>
                  <td className="px-4 py-3.5 max-w-xs">
                    <span className="truncate block">{msg.subject}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={msg.status} />
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleOpen(msg.id); }}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-8 py-3 border-t border-border bg-background">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {list?.total ?? 0} total
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full max-w-xl flex flex-col overflow-hidden p-0">
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <SheetTitle className="text-base font-bold leading-tight pr-4">
                    {detail.subject}
                  </SheetTitle>
                  <StatusBadge status={detail.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{detail.fullName}</span>
                  <span>·</span>
                  <a href={`mailto:${detail.email}`} className="text-primary underline underline-offset-2">
                    {detail.email}
                  </a>
                  <span>·</span>
                  <span>{format(new Date(detail.createdAt), "d MMM yyyy, HH:mm")}</span>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {/* Message body */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                    Message
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                    {detail.message}
                  </p>
                </div>

                {/* Existing reply note */}
                {detail.replyNote && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700 mb-1.5">
                      Reply Note
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-green-900">{detail.replyNote}</p>
                    {detail.repliedAt && (
                      <p className="text-xs text-green-600 mt-2">
                        Saved {format(new Date(detail.repliedAt), "d MMM yyyy, HH:mm")}
                      </p>
                    )}
                  </div>
                )}

                {/* Reply editor */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                    {detail.replyNote ? "Update Reply Note" : "Add Reply Note"}
                  </p>
                  <Textarea
                    placeholder="Draft a reply or add a note for your team…"
                    rows={5}
                    value={replyDraft !== "" ? replyDraft : (detail.replyNote ?? "")}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    className="text-sm resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Internal note only — not automatically emailed to the sender.
                  </p>
                </div>
              </div>

              {/* Action footer */}
              <div className="border-t border-border px-6 py-4 shrink-0 flex items-center justify-between gap-3 bg-background">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleArchive(detail.id)}
                  disabled={patch.isPending || detail.status === "archived"}
                  className="text-muted-foreground"
                >
                  <Archive className="h-3.5 w-3.5 mr-1.5" />
                  Archive
                </Button>

                <div className="flex gap-2">
                  {detail.status === "archived" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReopen(detail.id)}
                      disabled={patch.isPending}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleReply}
                    disabled={patch.isPending || (!replyDraft && !detail.replyNote)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {patch.isPending
                      ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : <Reply className="h-3.5 w-3.5 mr-1.5" />
                    }
                    Save &amp; Mark Replied
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
