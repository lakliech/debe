import { Link, useParams } from "wouter";
import { ChevronRight, MapPin } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useGetCountyPriorities, submitCitizenPolicy } from "@workspace/api-client-react";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  title: z.string().min(3, "Title required"),
  content: z.string().min(10, "Please describe your priority"),
  submitterName: z.string().optional(),
  submitterEmail: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function CountyDetail() {
  const params = useParams();
  const countyCode = params.code ?? "";
  const { t } = useLanguage();
  const { toast } = useToast();

  const county = KENYA_COUNTIES.find((c) => c.code === countyCode);
  const { data, isLoading, isError, refetch } = useGetCountyPriorities(countyCode);

  const { mutate: submit, isPending, isSuccess, reset: resetMutation } = useMutation({
    mutationFn: (body: any) => submitCitizenPolicy(body),
    onSuccess: () => {
      toast({ title: t("Submitted!", "Imetumwa!"), description: t("Your priority has been received.", "Kipaumbele chako kimepokelewa.") });
      reset();
    },
    onError: () => {
      toast({ title: t("Error", "Hitilafu"), description: t("Could not submit. Please try again.", "Haiwezekani kutuma."), variant: "destructive" });
    },
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => {
    submit({ ...data, countyId: countyCode, sectorSlug: `county-${countyCode}` });
  };

  return (
    <PublicPortalLayout>
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-border px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/county-priorities" className="hover:text-primary transition-colors font-medium">
            {t("County Priorities", "Vipaumbele vya Kaunti")}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-bold text-foreground">{county?.name ?? countyCode}</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-primary flex items-center justify-center">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-xs font-black tracking-widest uppercase text-muted-foreground">{countyCode}</p>
            <h1 className="text-3xl font-black tracking-tight uppercase">{county?.name ?? countyCode}</h1>
          </div>
        </div>

        {/* Priorities */}
        <div className="mb-12">
          <h2 className="text-lg font-black uppercase tracking-tight mb-4">
            {t("Development Priorities", "Vipaumbele vya Maendeleo")}
          </h2>

          {isLoading && (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-10">
              <p className="text-muted-foreground mb-3">{t("Could not load priorities.", "Haiwezekani kupakia vipaumbele.")}</p>
              <button onClick={() => refetch()} className="bg-primary text-white px-4 py-2 font-bold text-sm hover:bg-primary/90">
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {!isLoading && data && (
            <>
              {data.priorities && data.priorities.length > 0 ? (
                <div className="space-y-3">
                  {data.priorities.map((priority: any, i: number) => (
                    <div key={priority.id ?? i} className="border border-border p-4 shadow-sm flex items-start gap-4">
                      <div className="w-8 h-8 bg-primary text-white flex items-center justify-center font-black text-sm shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-sm">{priority.titleEn ?? priority.title ?? "Priority"}</div>
                        {priority.descriptionEn && (
                          <p className="text-muted-foreground text-sm mt-1">{priority.descriptionEn}</p>
                        )}
                        {priority.score != null && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 bg-muted rounded-full flex-1 max-w-xs">
                              <div
                                className="h-1.5 bg-primary rounded-full"
                                style={{ width: `${Math.min(priority.score, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">Score: {priority.score}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground py-8 text-center">
                  {t("No priorities listed yet for this county.", "Hakuna vipaumbele vilivyoorodheshwa kwa kaunti hii bado.")}
                </p>
              )}
            </>
          )}
        </div>

        {/* Submit form */}
        <div className="border border-border p-6 shadow-sm">
          <h2 className="text-lg font-black uppercase tracking-tight mb-2">
            {t("Submit Your Priority", "Wasilisha Kipaumbele Chako")}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {t(
              "Tell us what matters most to the people of your county.",
              "Tuambie kipi kinachohusika zaidi kwa watu wa kaunti yako."
            )}
          </p>

          {isSuccess ? (
            <div className="bg-primary/10 border border-primary/20 p-6 text-center">
              <p className="font-black text-primary text-lg">{t("Thank you!", "Asante!")}</p>
              <p className="text-muted-foreground text-sm mt-1">
                {t("Your submission has been recorded.", "Uwasilishaji wako umerekodiwa.")}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="title">{t("Priority Title *", "Kichwa cha Kipaumbele *")}</Label>
                <Input id="title" {...register("title")} placeholder={t("e.g. Water access in rural areas", "mfano: Maji katika maeneo ya vijijini")} className="mt-1" />
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
              </div>
              <div>
                <Label htmlFor="content">{t("Description *", "Maelezo *")}</Label>
                <Textarea id="content" rows={4} {...register("content")} placeholder={t("Describe the issue and what you'd like to see done...", "Eleza tatizo na unachopenda kufanywa...")} className="mt-1" />
                {errors.content && <p className="text-red-500 text-xs mt-1">{errors.content.message}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="submitterName">{t("Your Name (optional)", "Jina Lako (si lazima)")}</Label>
                  <Input id="submitterName" {...register("submitterName")} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="submitterEmail">{t("Your Email (optional)", "Barua Pepe (si lazima)")}</Label>
                  <Input id="submitterEmail" type="email" {...register("submitterEmail")} className="mt-1" />
                </div>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="bg-primary text-white hover:bg-primary/90 px-6 py-3 font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
              >
                {isPending ? t("Submitting...", "Inatuma...") : t("Submit Priority", "Tuma Kipaumbele")}
              </button>
            </form>
          )}
        </div>
      </div>
    </PublicPortalLayout>
  );
}
