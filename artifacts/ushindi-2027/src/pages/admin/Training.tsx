import { useState } from "react";
import { BookOpen, Plus, Clock, Users, Award, CheckCircle2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import AppLayout from "@/components/layout/AppLayout";
import { useListTrainingCourses, createTrainingCourse } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ROLES = ["Ward Agent", "Polling Agent", "Social Media Volunteer", "Driver", "Translator", "Coordinator", "Other"];

const courseSchema = z.object({
  title: z.string().min(2, "Title required"),
  titleSw: z.string().optional(),
  description: z.string().optional(),
  targetRoles: z.array(z.string()).optional(),
  estimatedHours: z.number().min(0).optional(),
  mandatory: z.boolean().optional(),
  passMark: z.number().min(0).max(100).optional(),
  status: z.string().optional(),
});
type CourseForm = z.infer<typeof courseSchema>;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-700",
  archived: "bg-yellow-100 text-yellow-800",
};

export default function Training() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: courses, isLoading, isError, refetch } = useListTrainingCourses(statusFilter ? { status: statusFilter } : undefined);

  const { mutate: createCourse, isPending } = useMutation({
    mutationFn: (body: any) => createTrainingCourse(body),
    onSuccess: () => {
      toast({ title: "Course Created", description: "New training course has been created." });
      qc.invalidateQueries({ queryKey: ["/api/training/courses"] });
      setSheetOpen(false);
      reset();
    },
    onError: () => toast({ title: "Error", description: "Could not create course.", variant: "destructive" }),
  });

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CourseForm>({
    resolver: zodResolver(courseSchema),
    defaultValues: { mandatory: false, targetRoles: [], status: "draft" },
  });

  const targetRoles = watch("targetRoles") ?? [];

  const onSubmit = (data: CourseForm) => {
    createCourse({
      title: data.title,
      titleSw: data.titleSw,
      description: data.description,
      targetRoles: data.targetRoles,
      estimatedHours: data.estimatedHours,
      mandatory: data.mandatory ?? false,
      passMark: data.passMark,
      status: data.status ?? "draft",
    });
  };

  const courseList = Array.isArray(courses) ? courses : [];

  // Compute stats
  const totalCourses = courseList.length;
  const activeCourses = courseList.filter((c: any) => c.status === "active").length;
  const totalEnrolled = courseList.reduce((sum: number, c: any) => sum + (c.enrollmentCount ?? 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground uppercase">
              Training & Certification
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Manage training courses and volunteer certifications.</p>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-4 py-2 font-bold text-sm transition-colors">
                <Plus className="h-4 w-4" />
                Create Course
              </button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="font-black uppercase">New Training Course</SheetTitle>
              </SheetHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="title">Course Title *</Label>
                  <Input id="title" {...register("title")} className={cn("mt-1", errors.title && "border-red-500")} />
                  {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                </div>
                <div>
                  <Label htmlFor="titleSw">Title (Swahili)</Label>
                  <Input id="titleSw" {...register("titleSw")} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={3} {...register("description")} className="mt-1" />
                </div>
                <div>
                  <Label className="mb-2 block">Target Roles</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLES.map((role) => (
                      <label key={role} className={cn("flex items-center gap-2 border p-2 cursor-pointer text-xs", targetRoles.includes(role) ? "border-primary bg-primary/5" : "border-border")}>
                        <input
                          type="checkbox"
                          checked={targetRoles.includes(role)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setValue("targetRoles", [...targetRoles, role]);
                            } else {
                              setValue("targetRoles", targetRoles.filter((r) => r !== role));
                            }
                          }}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {role}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="estimatedHours">Estimated Hours</Label>
                    <Input id="estimatedHours" type="number" {...register("estimatedHours", { valueAsNumber: true })} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="passMark">Pass Mark (%)</Label>
                    <Input id="passMark" type="number" {...register("passMark", { valueAsNumber: true })} className="mt-1" placeholder="e.g. 70" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="mandatory" {...register("mandatory")} className="h-4 w-4 accent-primary" />
                  <Label htmlFor="mandatory">Mandatory course</Label>
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <select id="status" {...register("status")} className="mt-1 w-full border border-input px-3 py-2 text-sm bg-background focus:outline-none">
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <button type="submit" disabled={isPending} className="w-full bg-primary text-white hover:bg-primary/90 py-3 font-bold text-sm tracking-wide disabled:opacity-50">
                  {isPending ? "Creating..." : "Create Course"}
                </button>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: BookOpen, label: "Total Courses", value: totalCourses, color: "text-foreground" },
            { icon: CheckCircle2, label: "Active", value: activeCourses, color: "text-green-600" },
            { icon: Users, label: "Total Enrolled", value: totalEnrolled, color: "text-primary" },
            { icon: Award, label: "Certified", value: 0, color: "text-yellow-600" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-border p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              </div>
              <p className={cn("text-3xl font-black font-mono", stat.color)}>{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Course grid */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">Could not load courses.</p>
            <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">Retry</button>
          </div>
        )}

        {!isLoading && courseList.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No courses found. Create the first one.</p>
          </div>
        )}

        {!isLoading && courseList.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {courseList.map((course: any) => (
              <div key={course.id} className="border border-border p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <span className={cn("text-xs font-bold px-2 py-0.5 uppercase", STATUS_STYLES[course.status ?? ""] ?? STATUS_STYLES.draft)}>
                    {course.status ?? "Draft"}
                  </span>
                  {course.mandatory && (
                    <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 uppercase">Mandatory</span>
                  )}
                </div>
                <h3 className="font-black text-sm uppercase tracking-tight mb-2">{course.title}</h3>
                {course.description && (
                  <p className="text-muted-foreground text-xs leading-relaxed line-clamp-2 mb-3">{course.description}</p>
                )}
                {(course.targetRoles ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(course.targetRoles ?? []).slice(0, 3).map((role: string) => (
                      <span key={role} className="bg-muted text-muted-foreground text-xs px-1.5 py-0.5">{role}</span>
                    ))}
                    {(course.targetRoles ?? []).length > 3 && (
                      <span className="text-xs text-muted-foreground">+{(course.targetRoles ?? []).length - 3} more</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {course.estimatedHours != null && (
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{course.estimatedHours}h</span>
                  )}
                  {course.passMark != null && (
                    <span className="flex items-center gap-1"><Award className="h-3 w-3" />Pass: {course.passMark}%</span>
                  )}
                  {course.enrollmentCount != null && (
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{course.enrollmentCount} enrolled</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
