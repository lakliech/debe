import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const fmtKES = (x: unknown) => (Number(x) / 1).toLocaleString("en-KE") + " KES";
const fmtDate = (x: unknown) => new Date(x as string).toLocaleDateString("en-KE");

const VERIFY_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function ContributionDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: contribution, isLoading } = useQuery({
    queryKey: ["contribution", id],
    queryFn: () =>
      fetch(`${BASE}/api/finance/contributions/${id}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!id,
  });

  const { mutate: verifyMutation, isPending: verifying } = useMutation({
    mutationFn: (body: { status: string; rejectionReason?: string }) =>
      fetch(`${BASE}/api/finance/contributions/${id}/verify`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (_, vars) => {
      toast({
        title: vars.status === "verified" ? "Verified" : "Rejected",
        description: `Contribution has been ${vars.status}.`,
      });
      qc.invalidateQueries({ queryKey: ["contribution", id] });
      qc.invalidateQueries({ queryKey: ["contributions"] });
      setRejectOpen(false);
    },
    onError: () =>
      toast({ title: "Error", description: "Action failed.", variant: "destructive" }),
  });

  if (isLoading) {
    return (
        <div className="space-y-4 animate-pulse">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
    );
  }

  const c = contribution ?? {};
  const isCompliant = !c.complianceFlag || c.complianceFlag === "none";

  return (
    <>
      <div className="space-y-6 pb-8">
        <button
          onClick={() => setLocation("/finance/contributions")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Contributions
        </button>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold uppercase tracking-tight">
            {c.referenceNumber ?? "Contribution"}
          </h1>
          <span
            className={`px-3 py-1 text-xs font-black uppercase tracking-wider ${
              VERIFY_BADGE[c.verificationStatus] ?? "bg-gray-100 text-gray-700"
            }`}
          >
            {c.verificationStatus ?? "—"}
          </span>
        </div>

        {/* Compliance Alert */}
        {!isCompliant && (
          <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200">
            <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-orange-800 text-sm">Compliance Flag: {c.complianceFlag?.replace(/_/g, " ")}</p>
              <p className="text-orange-700 text-xs mt-1">
                This contribution has been flagged for compliance review. Please verify carefully.
              </p>
            </div>
          </div>
        )}

        {/* Main Detail Card */}
        <div className="bg-card border border-border p-6 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
            Contribution Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Reference Number" value={c.referenceNumber} />
            <Field label="Amount" value={c.amount != null ? fmtKES(c.amount) : undefined} />
            <Field label="Channel" value={c.channel?.replace(/_/g, " ")} />
            <Field label="Donor Name" value={c.donorFullName} />
            <Field label="Donor Email" value={c.donorEmail} />
            <Field label="Donor Phone" value={c.donorPhone} />
            <Field label="Donor ID Number" value={c.donorIdNumber} />
            <Field label="Compliance Flag" value={c.complianceFlag} />
            <Field label="Verification Status" value={c.verificationStatus} />
            <Field label="Verified At" value={c.verifiedAt ? fmtDate(c.verifiedAt) : null} />
            <Field label="Ledger" value={c.ledger} />
            <Field label="Date" value={c.createdAt ? fmtDate(c.createdAt) : null} />
            {c.notes && <div className="col-span-2"><Field label="Notes" value={c.notes} /></div>}
          </div>
        </div>

        {/* M-Pesa Section */}
        {c.channel === "mpesa" && (
          <div className="bg-card border border-green-200 p-5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-wider text-green-700 mb-3">
              M-Pesa Receipt
            </h2>
            <Field label="M-Pesa Receipt Number" value={c.mpesaReceiptNumber} />
          </div>
        )}

        {/* Bank Transfer */}
        {c.channel === "bank_transfer" && c.bankTransactionRef && (
          <div className="bg-card border border-indigo-200 p-5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-wider text-indigo-700 mb-3">
              Bank Transfer
            </h2>
            <Field label="Bank Transaction Reference" value={c.bankTransactionRef} />
          </div>
        )}

        {/* In-Kind Items */}
        {Array.isArray(c.inKind) && c.inKind.length > 0 && (
          <div className="bg-card border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                In-Kind Items
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Description", "Estimated Value", "Unit"].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.inKind.map((item: any, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3">{item.description ?? "—"}</td>
                    <td className="px-4 py-3">{item.estimatedValue != null ? fmtKES(item.estimatedValue) : "—"}</td>
                    <td className="px-4 py-3">{item.unit ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Verification Actions */}
        {c.verificationStatus === "pending" && (
          <div className="bg-card border border-border p-5 shadow-sm">
            <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-4">
              Verification Actions
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => verifyMutation({ status: "verified" })}
                disabled={verifying}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" />
                Verify Contribution
              </button>
              <button
                onClick={() => setRejectOpen(true)}
                disabled={verifying}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Contribution</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for rejection. This will be recorded.
            </p>
            <Textarea
              placeholder="Rejection reason..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                verifyMutation({ status: "rejected", rejectionReason })
              }
              disabled={verifying || !rejectionReason.trim()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
