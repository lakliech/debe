import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Plus, Search, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const urgencyColors: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-gray-100 text-gray-700 border-gray-300",
};

const statusColors: Record<string, string> = {
  intake: "bg-blue-100 text-blue-800",
  assigned: "bg-indigo-100 text-indigo-800",
  fact_checking: "bg-purple-100 text-purple-800",
  legal_review: "bg-pink-100 text-pink-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-gray-100 text-gray-600",
};

interface Claim {
  id: string;
  claimText: string;
  platform: string;
  urgency: string;
  status: string;
  assignedTo?: string;
  createdAt: string;
}

export default function RapidResponse() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState({ claimText: "", sourceUrl: "", platform: "twitter", urgency: "medium" });

  const params = new URLSearchParams();
  if (urgencyFilter !== "all") params.set("urgency", urgencyFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search) params.set("search", search);
  params.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["rapid-response-claims", urgencyFilter, statusFilter, search, page],
    queryFn: () => fetch(`${BASE}/api/rapid-response/claims?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/rapid-response/claims`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rapid-response-claims"] });
      setSheetOpen(false);
      setForm({ claimText: "", sourceUrl: "", platform: "twitter", urgency: "medium" });
      toast({ title: "Claim reported", description: "The misinformation claim has been logged." });
    },
    onError: () => toast({ title: "Error", description: "Failed to report claim.", variant: "destructive" }),
  });

  const claims: Claim[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 20;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">RAPID RESPONSE</h1>
          <p className="text-sm text-muted-foreground mt-1">Misinformation tracking &amp; fact-checking</p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button className="bg-[#1D9BF0] hover:bg-[#1a8fd1]">
              <Plus className="h-4 w-4 mr-2" /> Report Claim
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Report Misinformation Claim</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div>
                <Label>Claim Text *</Label>
                <Textarea
                  rows={5}
                  placeholder="Paste the exact misinformation claim..."
                  value={form.claimText}
                  onChange={e => setForm(f => ({ ...f, claimText: e.target.value }))}
                />
              </div>
              <div>
                <Label>Source URL</Label>
                <Input
                  type="url"
                  placeholder="https://..."
                  value={form.sourceUrl}
                  onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))}
                />
              </div>
              <div>
                <Label>Platform</Label>
                <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["twitter", "facebook", "whatsapp", "tiktok", "mainstream_media", "other"].map(p => (
                      <SelectItem key={p} value={p}>{p.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Urgency *</Label>
                <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">🔴 Critical</SelectItem>
                    <SelectItem value="high">🟠 High</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="low">⚪ Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full bg-[#1D9BF0] hover:bg-[#1a8fd1]"
                disabled={!form.claimText || createMutation.isPending}
                onClick={() => createMutation.mutate(form)}
              >
                {createMutation.isPending ? "Reporting..." : "Report Claim"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Urgency tabs */}
      <Tabs value={urgencyFilter} onValueChange={v => { setUrgencyFilter(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="critical" className="data-[state=active]:bg-red-600 data-[state=active]:text-white">CRITICAL</TabsTrigger>
          <TabsTrigger value="high" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white">HIGH</TabsTrigger>
          <TabsTrigger value="medium" className="data-[state=active]:bg-yellow-400 data-[state=active]:text-black">MEDIUM</TabsTrigger>
          <TabsTrigger value="low">LOW</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search claims..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {["intake", "assigned", "fact_checking", "legal_review", "approved", "published", "archived"].map(s => (
              <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#1D9BF0]" />
            Claims ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No claims found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map(claim => (
                  <TableRow key={claim.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rapid-response/${claim.id}`)}>
                    <TableCell className="max-w-xs">
                      <p className="text-sm truncate">{claim.claimText}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{claim.platform}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${urgencyColors[claim.urgency] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                        {claim.urgency?.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${statusColors[claim.status] ?? "bg-gray-100 text-gray-700"}`} variant="outline">
                        {claim.status?.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {claim.createdAt ? new Date(claim.createdAt).toLocaleDateString("en-KE") : "—"}
                    </TableCell>
                    <TableCell>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>Page {page} of {Math.ceil(total / pageSize)}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
