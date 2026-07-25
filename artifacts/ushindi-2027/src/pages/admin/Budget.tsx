import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtKES = (x: unknown) => (Number(x) / 1).toLocaleString("en-KE") + " KES";

type Category = {
  id: string;
  name: string;
  code: string;
  totalAllocatedKes: number;
  ledger: string;
};

type BudgetLine = {
  id: string;
  title: string;
  allocatedAmountKes: number;
  spentAmountKes: number;
  fiscalPeriod: string;
  status: string;
};

function ProgressBar({ spent, allocated }: { spent: number; allocated: number }) {
  const pct = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-orange-400" : "bg-[#1D9BF0]";
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CategoryCard({
  category,
  onAddLine,
}: {
  category: Category;
  onAddLine: (categoryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data: lines, isLoading } = useQuery<BudgetLine[]>({
    queryKey: ["budget-lines", category.id],
    queryFn: () =>
      fetch(`${BASE}/api/finance/budget-lines?categoryId=${category.id}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: expanded,
  });

  const linesList: BudgetLine[] = Array.isArray(lines) ? lines : [];

  return (
    <div className="border border-border bg-card shadow-sm">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <p className="font-bold">{category.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{category.code}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-[#1D9BF0] font-mono">
            {fmtKES(category.totalAllocatedKes)}
          </p>
          <p className="text-xs text-muted-foreground">allocated</p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : linesList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No budget lines. Add one below.</p>
          ) : (
            linesList.map((line) => (
              <div key={line.id} className="bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{line.title}</p>
                  <span className="text-xs bg-muted px-2 py-0.5 font-bold">{line.fiscalPeriod}</span>
                </div>
                <ProgressBar
                  spent={Number(line.spentAmountKes)}
                  allocated={Number(line.allocatedAmountKes)}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Spent: {fmtKES(line.spentAmountKes)}</span>
                  <span>Allocated: {fmtKES(line.allocatedAmountKes)}</span>
                </div>
              </div>
            ))
          )}
          <button
            onClick={() => onAddLine(category.id)}
            className="flex items-center gap-1 text-xs text-[#1D9BF0] font-bold hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Budget Line
          </button>
        </div>
      )}
    </div>
  );
}

export default function Budget() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ledger, setLedger] = useState<"candidate" | "party">("candidate");
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [lineSheetOpen, setLineSheetOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const [catForm, setCatForm] = useState({ name: "", code: "", description: "", ledger: "candidate" });
  const [lineForm, setLineForm] = useState({ title: "", allocatedAmountKes: "", fiscalPeriod: "" });

  const { data: categories, isLoading } = useQuery<Category[]>({
    queryKey: ["budget-categories"],
    queryFn: () =>
      fetch(`${BASE}/api/finance/budget-categories`, { credentials: "include" }).then((r) =>
        r.json()
      ),
  });

  const { mutate: addCategory, isPending: addingCat } = useMutation({
    mutationFn: (body: typeof catForm) =>
      fetch(`${BASE}/api/finance/budget-categories`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Category added" });
      qc.invalidateQueries({ queryKey: ["budget-categories"] });
      setCatSheetOpen(false);
      setCatForm({ name: "", code: "", description: "", ledger: "candidate" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: addLine, isPending: addingLine } = useMutation({
    mutationFn: (body: { categoryId: string; title: string; allocatedAmountKes: number; fiscalPeriod: string }) =>
      fetch(`${BASE}/api/finance/budget-lines`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Budget line added" });
      qc.invalidateQueries({ queryKey: ["budget-lines", selectedCategoryId] });
      setLineSheetOpen(false);
      setLineForm({ title: "", allocatedAmountKes: "", fiscalPeriod: "" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const catList: Category[] = Array.isArray(categories) ? categories : [];
  const filtered = catList.filter((c) => c.ledger === ledger);

  function handleAddLine(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setLineSheetOpen(true);
  }

  return (
    <>
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight uppercase">BUDGET MANAGEMENT</h1>
            <p className="text-muted-foreground text-sm mt-1">Campaign budget categories and allocation lines.</p>
          </div>
          <button
            onClick={() => setCatSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1D9BF0] text-white text-sm font-bold hover:bg-[#1A8CD8] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </button>
        </div>

        {/* Ledger Tabs */}
        <div className="flex gap-0 border border-border w-fit">
          {(["candidate", "party"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLedger(l)}
              className={`px-5 py-2 text-sm font-bold uppercase tracking-wider transition-colors ${
                ledger === l
                  ? "bg-[#1D9BF0] text-white"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {l} Ledger
            </button>
          ))}
        </div>

        {/* Categories */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center text-muted-foreground">
            <p className="font-medium">No budget categories for {ledger} ledger.</p>
            <p className="text-sm mt-1">Add a category to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((cat) => (
              <CategoryCard key={cat.id} category={cat} onAddLine={handleAddLine} />
            ))}
          </div>
        )}
      </div>

      {/* Add Category Sheet */}
      <Sheet open={catSheetOpen} onOpenChange={setCatSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add Budget Category</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Name</label>
              <Input value={catForm.name} onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Campaign Events" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Code</label>
              <Input value={catForm.code} onChange={(e) => setCatForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. EVT" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
              <Textarea value={catForm.description} onChange={(e) => setCatForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional..." rows={3} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">Ledger</label>
              <div className="flex gap-4">
                {["candidate", "party"].map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      value={l}
                      checked={catForm.ledger === l}
                      onChange={() => setCatForm((f) => ({ ...f, ledger: l }))}
                      className="accent-[#1D9BF0]"
                    />
                    <span className="capitalize">{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setCatSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addCategory(catForm)}
              disabled={addingCat || !catForm.name.trim() || !catForm.code.trim()}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Add Category
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add Budget Line Sheet */}
      <Sheet open={lineSheetOpen} onOpenChange={setLineSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add Budget Line</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Title</label>
              <Input value={lineForm.title} onChange={(e) => setLineForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Nairobi Rally Venue" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Allocated Amount (KES)</label>
              <Input type="number" value={lineForm.allocatedAmountKes} onChange={(e) => setLineForm((f) => ({ ...f, allocatedAmountKes: e.target.value }))} placeholder="500000" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Fiscal Period</label>
              <Input value={lineForm.fiscalPeriod} onChange={(e) => setLineForm((f) => ({ ...f, fiscalPeriod: e.target.value }))} placeholder="e.g. 2027-Q1" />
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setLineSheetOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                addLine({
                  categoryId: selectedCategoryId,
                  title: lineForm.title,
                  allocatedAmountKes: Number(lineForm.allocatedAmountKes),
                  fiscalPeriod: lineForm.fiscalPeriod,
                })
              }
              disabled={addingLine || !lineForm.title.trim() || !lineForm.allocatedAmountKes}
              className="bg-[#1D9BF0] hover:bg-[#1A8CD8]"
            >
              Add Line
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
