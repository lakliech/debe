import { Link, useParams } from "wouter";
import { ChevronLeft, Award, BookOpen, ClipboardList, Calendar, CheckCircle2, XCircle, ShieldAlert, RefreshCw, Shield } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import AppLayout from "@/components/layout/AppLayout";
import {
  useGetVolunteer,
  useGetVolunteerBadges,
  useGetVolunteerTraining,
  useGetVolunteerTasks,
  useGetVolunteerAttendance,
  verifyVolunteer,
  approveVolunteer,
  rejectVolunteer,
  suspendVolunteer,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  suspended: "bg-gray-100 text-gray-700",
  verified: "bg-blue-100 text-blue-800",
};

function StatusBadge({ status }: { status?: string | null }) {
  return (
    <span className={cn("px-3 py-1 text-xs font-black uppercase tracking-wider", STATUS_STYLES[status?.toLowerCase() ?? ""] ?? "bg-gray-100 text-gray-700")}>
      {status ?? "Unknown"}
    </span>
  );
}

function getInitials(name?: string | null) {
  if (!name) return "VL";
  return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
}

export default function VolunteerDetail() {
  const params = useParams();
  const id = params.id ?? "";
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: volunteer, isLoading } = useGetVolunteer(id);
  const { data: badges } = useGetVolunteerBadges(id);
  const { data: training } = useGetVolunteerTraining(id);
  const { data: tasks } = useGetVolunteerTasks(id);
  const { data: attendance } = useGetVolunteerAttendance(id);

  const invalidate = () => qc.invalidateQueries({ queryKey: [`/api/volunteers/${id}`] });

  const { mutate: verify, isPending: verifying } = useMutation({
    mutationFn: () => verifyVolunteer(id),
    onSuccess: () => { toast({ title: "Verified" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: approve, isPending: approving } = useMutation({
    mutationFn: () => approveVolunteer(id, {}),
    onSuccess: () => { toast({ title: "Approved" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: reject, isPending: rejecting } = useMutation({
    mutationFn: () => rejectVolunteer(id),
    onSuccess: () => { toast({ title: "Rejected" }); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const { mutate: suspend, isPending: suspending } = useMutation({
    mutationFn: () => suspendVolunteer(id, { reason: "Suspended by admin" }),
    onSuccess: () => { toast({ title: "Suspended" }); invalidate(); },
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
              <Skeleton className="h-4 w-1/5" />
            </div>
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </AppLayout>
    );
  }

  const v = volunteer;
  const status = v?.status?.toLowerCase() ?? "";

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* Back */}
        <Link href="/volunteers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ChevronLeft className="h-4 w-4" />
          Back to Volunteers
        </Link>

        {/* Profile header */}
        <div className="border border-border p-6 shadow-sm bg-card">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div className="w-20 h-20 bg-primary text-white flex items-center justify-center font-black text-2xl shrink-0">
              {getInitials(v?.fullName)}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-black tracking-tight">{v?.fullName ?? "—"}</h1>
                <StatusBadge status={v?.status} />
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>📞 {v?.phoneNumber ?? "—"}</p>
                <p>✉️ {v?.email ?? "—"}</p>
                {v?.createdAt && <p>🗓 Joined {format(new Date(v.createdAt), "d MMMM yyyy")}</p>}
              </div>
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap gap-2 shrink-0">
              {status !== "verified" && status !== "active" && (
                <button onClick={() => verify()} disabled={verifying} className="flex items-center gap-1 border border-blue-300 text-blue-700 hover:bg-blue-50 px-3 py-2 text-xs font-bold disabled:opacity-50">
                  <Shield className="h-3.5 w-3.5" />
                  Verify
                </button>
              )}
              {(status === "pending" || status === "verified") && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="flex items-center gap-1 border border-green-300 text-green-700 hover:bg-green-50 px-3 py-2 text-xs font-bold">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Approve Volunteer</AlertDialogTitle>
                      <AlertDialogDescription>This will activate {v?.fullName} as a campaign volunteer.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => approve()} disabled={approving}>Approve</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {status !== "rejected" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="flex items-center gap-1 border border-red-300 text-red-700 hover:bg-red-50 px-3 py-2 text-xs font-bold">
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reject Volunteer</AlertDialogTitle>
                      <AlertDialogDescription>This will reject {v?.fullName}'s application. They will be notified.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => reject()} disabled={rejecting} className="bg-red-600 hover:bg-red-700">Reject</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {status === "active" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="flex items-center gap-1 border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 text-xs font-bold">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Suspend
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Suspend Volunteer</AlertDialogTitle>
                      <AlertDialogDescription>This will suspend {v?.fullName} from campaign activities.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => suspend()} disabled={suspending} className="bg-gray-700 hover:bg-gray-800">Suspend</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {status === "suspended" && (
                <button onClick={() => approve()} disabled={approving} className="flex items-center gap-1 border border-green-300 text-green-700 hover:bg-green-50 px-3 py-2 text-xs font-bold">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reactivate
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="border-b border-border bg-transparent h-auto p-0 gap-0">
            {[
              { value: "overview", label: "Overview" },
              { value: "training", label: "Training", icon: BookOpen },
              { value: "badges", label: "Badges", icon: Award },
              { value: "tasks", label: "Tasks", icon: ClipboardList },
              { value: "attendance", label: "Attendance", icon: Calendar },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="px-4 py-3 text-sm font-bold border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary rounded-none bg-transparent"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="border border-border p-5 shadow-sm space-y-4">
                <h3 className="font-black text-sm uppercase tracking-wider">Location</h3>
                {[
                  { label: "County", value: v?.countyId },
                  { label: "Constituency", value: v?.constituencyId },
                  { label: "Ward", value: v?.wardId },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="font-medium">{item.value ?? "—"}</p>
                  </div>
                ))}
              </div>
              <div className="border border-border p-5 shadow-sm space-y-4">
                <h3 className="font-black text-sm uppercase tracking-wider">Role & Availability</h3>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Preferred Role</p>
                  <p className="font-medium">{v?.preferredRole ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Availability</p>
                  <p className="font-medium">{v?.availability ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Skills</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(v?.skills ?? []).length > 0
                      ? (v?.skills ?? []).map((s: string) => (
                          <span key={s} className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">{s}</span>
                        ))
                      : <span className="text-muted-foreground text-sm">—</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Consent</p>
                  <p className="font-medium">{v?.consentGiven ? "✅ Marketing" : "❌ No consent"}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Training */}
          <TabsContent value="training" className="pt-6">
            <div className="border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {["Course", "Status", "Score", "Certificate"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!training || (Array.isArray(training) ? training : []).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No training records.</td></tr>
                  ) : (
                    (Array.isArray(training) ? training : []).map((t: any, i: number) => (
                      <tr key={t.id ?? i} className="border-b border-border">
                        <td className="px-4 py-3 font-medium">{t.courseTitle ?? t.courseName ?? "—"}</td>
                        <td className="px-4 py-3"><span className="text-xs font-bold bg-muted px-2 py-0.5">{t.status ?? "—"}</span></td>
                        <td className="px-4 py-3">{t.score ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.certificateCode ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Badges */}
          <TabsContent value="badges" className="pt-6">
            {!badges || (Array.isArray(badges) ? badges : []).length === 0 ? (
              <p className="text-muted-foreground">No badges awarded yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(Array.isArray(badges) ? badges : []).map((badge: any, i: number) => (
                  <div key={badge.id ?? i} className="border border-border p-4 text-center shadow-sm">
                    <div className="text-3xl mb-2">{badge.emoji ?? "🏅"}</div>
                    <p className="font-black text-xs uppercase tracking-tight">{badge.badgeName ?? badge.name ?? "Badge"}</p>
                    {badge.awardedAt && (
                      <p className="text-muted-foreground text-xs mt-1">{format(new Date(badge.awardedAt), "d MMM yyyy")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Tasks */}
          <TabsContent value="tasks" className="pt-6">
            <div className="border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {["Task", "Status", "Hours Logged", "Due Date"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!tasks || (Array.isArray(tasks) ? tasks : []).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No tasks assigned.</td></tr>
                  ) : (
                    (Array.isArray(tasks) ? tasks : []).map((task: any, i: number) => (
                      <tr key={task.id ?? i} className="border-b border-border">
                        <td className="px-4 py-3 font-medium">{task.title ?? task.taskTitle ?? "—"}</td>
                        <td className="px-4 py-3"><span className="text-xs font-bold bg-muted px-2 py-0.5">{task.status ?? "—"}</span></td>
                        <td className="px-4 py-3">{task.hoursLogged ?? "0"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{task.dueDate ? format(new Date(task.dueDate), "d MMM yyyy") : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Attendance */}
          <TabsContent value="attendance" className="pt-6">
            <div className="border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {["Activity", "Check-In", "Check-Out", "Duration"].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!attendance || (Array.isArray(attendance) ? attendance : []).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No attendance records.</td></tr>
                  ) : (
                    (Array.isArray(attendance) ? attendance : []).map((rec: any, i: number) => (
                      <tr key={rec.id ?? i} className="border-b border-border">
                        <td className="px-4 py-3 font-medium">{rec.activityType ?? rec.activity ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{rec.checkInTime ? format(new Date(rec.checkInTime), "d MMM yy HH:mm") : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{rec.checkOutTime ? format(new Date(rec.checkOutTime), "d MMM yy HH:mm") : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{rec.duration ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
