import { useState } from "react";
import { Link, useParams } from "wouter";
import { ChevronLeft, BookOpen, Users, Award, Clock, CheckCircle2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  useGetTrainingCourse,
  enrollInCourse,
  updateTrainingCourse,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status?: string | null }) {
  const cls: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    draft: "bg-yellow-100 text-yellow-800",
    archived: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={cn("px-2 py-0.5 text-xs font-bold uppercase tracking-wider", cls[status ?? ""] ?? "bg-gray-100 text-gray-700")}>
      {status ?? "Unknown"}
    </span>
  );
}

export default function TrainingCourse() {
  const params = useParams();
  const id = params.id ?? "";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [volunteerId, setVolunteerId] = useState("");

  const { data: course, isLoading, isError, refetch } = useGetTrainingCourse(id);

  const { mutate: enroll, isPending: enrolling } = useMutation({
    mutationFn: () => enrollInCourse(id, { volunteerId: volunteerId || undefined }),
    onSuccess: () => {
      toast({ title: "Enrolled", description: "Volunteer has been enrolled in this course." });
      qc.invalidateQueries({ queryKey: [`/api/training/courses/${id}`] });
      setEnrollOpen(false);
      setVolunteerId("");
    },
    onError: () => toast({ title: "Error", description: "Could not enroll. Please try again.", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <>
        <div className="animate-pulse space-y-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  if (isError || !course) {
    return (
      <>
        <div className="text-center py-20">
          <BookOpen className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">Course not found or could not be loaded.</p>
          <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">Retry</button>
        </div>
      </>
    );
  }

  const modules: any[] = (course as any).modules ?? [];

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Back */}
        <Link href="/training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
          <ChevronLeft className="h-4 w-4" />
          Back to Training
        </Link>

        {/* Header */}
        <div className="border border-border p-6 shadow-sm bg-card">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-black tracking-tight text-foreground uppercase">{course.title}</h1>
                <StatusBadge status={course.status} />
                {course.mandatory && (
                  <span className="bg-red-100 text-red-700 text-xs font-black px-2 py-0.5 uppercase">MANDATORY</span>
                )}
              </div>
              {course.description && (
                <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">{course.description}</p>
              )}
            </div>
            <button
              onClick={() => setEnrollOpen(true)}
              className="bg-primary text-white hover:bg-primary/90 px-5 py-2.5 font-bold text-sm shrink-0 flex items-center gap-2"
            >
              <Users className="h-4 w-4" />
              Enroll Volunteer
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
            {[
              { icon: Clock, label: "Est. Hours", value: course.estimatedHours ?? "—" },
              { icon: Award, label: "Pass Mark", value: course.passMark != null ? `${course.passMark}%` : "—" },
              { icon: Users, label: "Enrolled", value: (course.enrollmentCount ?? 0).toLocaleString() },
              { icon: BookOpen, label: "Modules", value: modules.length },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="text-center">
                <Icon className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-2xl font-black font-mono">{value}</p>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Target Roles */}
        {Array.isArray(course.targetRoles) && course.targetRoles.length > 0 && (
          <div className="border border-border p-5 shadow-sm">
            <h2 className="font-black text-sm uppercase tracking-wider mb-3">Target Roles</h2>
            <div className="flex flex-wrap gap-2">
              {course.targetRoles.map((role: string) => (
                <span key={role} className="bg-primary/10 text-primary text-xs font-bold px-3 py-1 uppercase tracking-wide">{role}</span>
              ))}
            </div>
          </div>
        )}

        {/* Modules */}
        <div className="border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h2 className="font-black text-sm uppercase tracking-wider">Course Modules ({modules.length})</h2>
          </div>
          {modules.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-40" />
              No modules added yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {modules.map((mod: any, idx: number) => (
                <div key={mod.id ?? idx} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-8 h-8 bg-primary text-white flex items-center justify-center font-black text-sm shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-foreground truncate">{mod.title ?? `Module ${idx + 1}`}</p>
                    {mod.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{mod.description}</p>
                    )}
                  </div>
                  <div className="text-xs font-bold text-muted-foreground shrink-0">
                    {mod.estimatedMinutes ? `${mod.estimatedMinutes} min` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Enroll Sheet */}
      <Sheet open={enrollOpen} onOpenChange={setEnrollOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-black uppercase tracking-tight">Enroll a Volunteer</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label className="font-bold text-xs uppercase tracking-wider">Volunteer ID</Label>
              <Input
                className="mt-1"
                placeholder="Enter volunteer UUID..."
                value={volunteerId}
                onChange={(e) => setVolunteerId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">You can find the volunteer ID on their profile page.</p>
            </div>
            <button
              disabled={!volunteerId.trim() || enrolling}
              onClick={() => enroll()}
              className="w-full bg-primary text-white hover:bg-primary/90 py-3 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {enrolling ? "Enrolling..." : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Enrollment
                </>
              )}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
