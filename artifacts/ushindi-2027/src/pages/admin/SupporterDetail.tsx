import { Link, useParams, useLocation } from "wouter";
import { ChevronLeft, CheckCircle2, XCircle, Mail, MessageSquare, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import AppLayout from "@/components/layout/AppLayout";
import {
  useGetSupporter,
  useGetSupporterConsents,
  optOutSupporter,
  deleteSupporter,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function getInitials(name?: string | null) {
  if (!name) return "SP";
  return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
}

export default function SupporterDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: supporter, isLoading } = useGetSupporter(id);
  const { data: consents } = useGetSupporterConsents(id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [`/api/supporters/${id}`] });
    qc.invalidateQueries({ queryKey: ["/api/supporters"] });
  };

  const { mutate: optOut, isPending: optingOut } = useMutation({
    mutationFn: () => optOutSupporter(id),
    onSuccess: () => { toast({ title: "Opted Out", description: "Supporter has been opted out." }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: deleteSup, isPending: deleting } = useMutation({
    mutationFn: () => deleteSupporter(id),
    onSuccess: () => {
      toast({ title: "Record Deleted" });
      window.history.back();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-4">
            <Skeleton className="h-20 w-20 rounded-sm" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </AppLayout>
    );
  }

  const s = supporter;

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* Back */}
        <Link href="/supporters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ChevronLeft className="h-4 w-4" />
          Back to Supporters
        </Link>

        {/* Profile */}
        <div className="border border-border p-6 shadow-sm bg-card">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div className={cn("w-20 h-20 flex items-center justify-center font-black text-2xl shrink-0 text-white", s?.optedOut ? "bg-gray-400" : "bg-primary")}>
              {getInitials(s?.fullName)}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-black tracking-tight">{s?.fullName ?? "—"}</h1>
                {s?.optedOut ? (
                  <span className="bg-red-100 text-red-700 text-xs font-black px-3 py-1 uppercase">Opted Out</span>
                ) : (
                  <span className="bg-green-100 text-green-700 text-xs font-black px-3 py-1 uppercase">Active</span>
                )}
                {s?.membershipStatus && (
                  <span className="bg-muted text-muted-foreground text-xs font-bold px-2 py-0.5 uppercase">{s.membershipStatus}</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>📞 {s?.phoneNumber ?? "—"}</p>
                <p>✉️ {s?.email ?? "—"}</p>
                <p>📍 {[s?.wardId, s?.constituencyId, s?.countyId].filter(Boolean).join(", ") || "—"}</p>
                {s?.createdAt && <p>🗓 Joined {format(new Date(s.createdAt), "d MMMM yyyy")}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Consent management */}
        <div className="border border-border p-6 shadow-sm">
          <h2 className="font-black text-sm uppercase tracking-wider mb-4">Consent Management</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Marketing", value: s?.consentMarketing, icon: Mail },
              { label: "SMS", value: s?.consentSms, icon: MessageSquare },
              { label: "Email", value: s?.consentMarketing, icon: Mail },
            ].map((item) => (
              <div key={item.label} className={cn("flex items-center gap-3 border p-4", item.value ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50")}>
                <item.icon className={cn("h-5 w-5", item.value ? "text-green-600" : "text-gray-400")} />
                <div>
                  <p className="font-bold text-sm">{item.label}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {item.value ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /><span className="text-xs text-green-600 font-bold">Granted</span></>
                    ) : (
                      <><XCircle className="h-3.5 w-3.5 text-gray-400" /><span className="text-xs text-gray-500 font-bold">Not Granted</span></>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Policy interests */}
        {s?.policyInterests && s.policyInterests.length > 0 && (
          <div className="border border-border p-6 shadow-sm">
            <h2 className="font-black text-sm uppercase tracking-wider mb-4">Policy Interests</h2>
            <div className="flex flex-wrap gap-2">
              {s.policyInterests.map((interest: string) => (
                <span key={interest} className="bg-primary/10 text-primary text-xs font-bold px-3 py-1 uppercase tracking-wider">
                  {interest}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Consent history */}
        <div className="border border-border overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border bg-muted/30">
            <h2 className="font-black text-sm uppercase tracking-wider">Consent History</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {["Type", "Granted", "Date", "Notes"].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!consents || (Array.isArray(consents) ? consents : []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No consent records.</td></tr>
              ) : (
                (Array.isArray(consents) ? consents : []).map((c: any, i: number) => (
                  <tr key={c.id ?? i} className="border-b border-border">
                    <td className="px-4 py-3 font-medium">{c.consentType ?? c.type ?? "—"}</td>
                    <td className="px-4 py-3">
                      {c.granted ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {c.createdAt ? format(new Date(c.createdAt), "d MMM yyyy HH:mm") : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{c.notes ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="border border-border p-6 shadow-sm space-y-4">
          <h2 className="font-black text-sm uppercase tracking-wider">Actions</h2>
          {!s?.optedOut && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 px-4 py-2 font-bold text-sm transition-colors">
                  <XCircle className="h-4 w-4" />
                  Opt Out Supporter
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Opt Out Supporter</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will opt out {s?.fullName} from all campaign communications. This action complies with data protection requirements.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => optOut()} disabled={optingOut} className="bg-red-600 hover:bg-red-700">
                    Opt Out
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {/* Danger zone */}
          <div className="border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-red-700 mb-3">Danger Zone — DPO Only</p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-2 bg-red-600 text-white hover:bg-red-700 px-4 py-2 font-bold text-sm transition-colors">
                  <Trash2 className="h-4 w-4" />
                  Delete Record Permanently
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Record Permanently</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all data for {s?.fullName}. This action cannot be undone. Only proceed if required by a valid data deletion request.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteSup()} disabled={deleting} className="bg-red-600 hover:bg-red-700">
                    Delete Permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
