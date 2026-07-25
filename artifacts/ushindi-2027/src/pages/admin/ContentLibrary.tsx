import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, FileText, Image, Video, File, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const APPROVAL_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const CATEGORIES = [
  "logo", "brand_guidelines", "photo", "poster", "video", "template",
  "script", "speech", "manifesto_summary", "translation",
];

const RIGHTS = ["internal", "restricted", "public"];

const PAGE_SIZE = 20;

function CategoryIcon({ category }: { category: string }) {
  if (category === "photo" || category === "logo" || category === "poster") return <Image className="h-6 w-6 text-blue-500" />;
  if (category === "video") return <Video className="h-6 w-6 text-purple-500" />;
  return <FileText className="h-6 w-6 text-orange-500" />;
}

export default function ContentLibrary() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "photo",
    objectPath: "",
    mimeType: "",
    publishingRights: "internal",
  });

  const params = new URLSearchParams();
  if (categoryFilter) params.set("category", categoryFilter);
  if (approvalFilter) params.set("approvalStatus", approvalFilter);
  if (search) params.set("search", search);
  params.set("page", String(page));

  const { data, isLoading } = useQuery({
    queryKey: ["content-assets", categoryFilter, approvalFilter, search, page],
    queryFn: () =>
      fetch(`${BASE}/api/content/assets?${params.toString()}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["content-assets"] });

  const { mutate: uploadAsset, isPending: uploading } = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/api/content/assets`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Asset uploaded" });
      invalidate();
      setSheetOpen(false);
      setForm({ title: "", description: "", category: "photo", objectPath: "", mimeType: "", publishingRights: "internal" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approveAsset } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/content/assets/${id}/approve`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Asset approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: rejectAsset } = useMutation({
    mutationFn: (id: string) =>
      fetch(`${BASE}/api/content/assets/${id}/reject`, {
        method: "POST",
        credentials: "include",
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "Asset rejected" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const assets: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const total = data?.total ?? assets.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">CONTENT LIBRARY</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage campaign assets, media, and documents.</p>
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Upload Asset
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <select
            value={approvalFilter}
            onChange={(e) => { setApprovalFilter(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Asset Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : assets.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center text-muted-foreground">
            <File className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No assets found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {assets.map((asset: any) => (
              <div key={asset.id} className="bg-card border border-border p-4 shadow-sm flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <CategoryIcon category={asset.category ?? ""} />
                  <span className={`px-2 py-0.5 text-xs font-bold uppercase ${APPROVAL_BADGE[asset.approvalStatus] ?? "bg-gray-100 text-gray-700"}`}>
                    {asset.approvalStatus ?? "—"}
                  </span>
                </div>
                <button
                  onClick={() => setLocation(`/content-library/${asset.id}`)}
                  className="font-bold text-sm text-left hover:text-[#1D9BF0] transition-colors line-clamp-2"
                >
                  {asset.title ?? "—"}
                </button>
                <span className="text-xs bg-muted px-2 py-0.5 font-bold uppercase text-muted-foreground w-fit">
                  {(asset.category ?? "—").replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto">
                  <Download className="h-3.5 w-3.5" />
                  {asset.downloadCount ?? 0} downloads · {asset.createdAt ? fmtDate(asset.createdAt) : "—"}
                </div>
                {asset.approvalStatus === "pending" && (
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => approveAsset(asset.id)}
                      className="flex-1 py-1 text-xs font-bold text-green-700 border border-green-300 hover:bg-green-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectAsset(asset.id)}
                      className="flex-1 py-1 text-xs font-bold text-red-700 border border-red-300 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-foreground disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>Page {page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 hover:text-foreground disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Upload Asset</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Title *</label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Asset title..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Category *</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">GCS Object Path *</label>
              <Input value={form.objectPath} onChange={(e) => setForm((f) => ({ ...f, objectPath: e.target.value }))} placeholder="gs://bucket/path/to/file" />
              <p className="text-xs text-muted-foreground mt-1">Enter the Google Cloud Storage path after uploading the file.</p>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">MIME Type</label>
              <Input value={form.mimeType} onChange={(e) => setForm((f) => ({ ...f, mimeType: e.target.value }))} placeholder="image/jpeg, video/mp4..." />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Publishing Rights</label>
              <select value={form.publishingRights} onChange={(e) => setForm((f) => ({ ...f, publishingRights: e.target.value }))} className="w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                {RIGHTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => uploadAsset(form)}
              disabled={uploading || !form.title.trim() || !form.objectPath.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Upload Asset
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
