import { useState } from "react";
import { Link, useParams } from "wouter";
import { ChevronDown, ChevronUp, ChevronRight, Flag } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useGetManifestoSector,
  submitCitizenPolicy,
} from "@workspace/api-client-react";
import type { ManifestoItem } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const policySchema = z.object({
  title: z.string().min(3, "Title is required"),
  content: z.string().min(20, "Please provide more detail (at least 20 characters)"),
  submitterName: z.string().optional(),
  submitterEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  anonymous: z.boolean(),
});

type PolicyForm = z.infer<typeof policySchema>;

function ManifestoItemCard({ item, lang }: { item: ManifestoItem; lang: string }) {
  const [expanded, setExpanded] = useState(false);
  const title = lang === "sw" ? (item.titleSw ?? item.titleEn ?? "") : (item.titleEn ?? "");
  const body = lang === "sw" ? (item.bodySw ?? item.bodyEn ?? "") : (item.bodyEn ?? "");

  return (
    <div className="border border-border shadow-sm">
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="font-bold text-sm">{title}</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && body && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {body}
        </div>
      )}
    </div>
  );
}

export default function ManifestoSector() {
  const params = useParams();
  const slug = params.slug ?? "";
  const { lang, t } = useLanguage();
  const { toast } = useToast();

  const { data: sectorData, isLoading, isError, refetch } = useGetManifestoSector(slug);

  // ManifestoSectorDetail: { sector?: ManifestoSector, items?: ManifestoItem[] }
  const sector = sectorData?.sector;
  const items = sectorData?.items ?? [];

  const { mutate: submitPolicy, isPending: submitting, isSuccess } = useMutation({
    mutationFn: (body: any) => submitCitizenPolicy(body),
    onSuccess: () => {
      toast({ title: t("Submitted!", "Imetumwa!"), description: t("Your policy suggestion has been received.", "Mapendekezo yako ya sera yamepokelewa.") });
      reset();
    },
    onError: () => {
      toast({ title: t("Error", "Hitilafu"), description: t("Could not submit. Please try again.", "Haiwezekani kutuma. Tafadhali jaribu tena."), variant: "destructive" });
    },
  });

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<PolicyForm>({
    resolver: zodResolver(policySchema),
    defaultValues: { anonymous: false },
  });

  const isAnonymous = watch("anonymous");

  const onSubmit = (data: PolicyForm) => {
    submitPolicy({
      sectorId: sector?.id,
      title: data.title,
      content: data.content,
      submitterName: data.anonymous ? undefined : data.submitterName,
      submitterEmail: data.anonymous ? undefined : (data.submitterEmail || undefined),
      anonymous: data.anonymous,
    });
  };

  return (
    <PublicPortalLayout>
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-border px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/manifesto" className="hover:text-primary transition-colors font-medium">
            {t("Manifesto", "Ilani")}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-bold text-foreground">
            {isLoading ? "..." : (lang === "sw" ? (sector?.titleSw ?? sector?.titleEn ?? slug) : (sector?.titleEn ?? slug))}
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10">
        {isLoading && (
          <div className="space-y-6 animate-pulse">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="space-y-3 mt-8">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
        )}

        {isError && (
          <div className="text-center py-20">
            <Flag className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">
              {t("Could not load this sector.", "Haiwezekani kupakia sekta hii.")}
            </p>
            <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
              {t("Retry", "Jaribu tena")}
            </button>
          </div>
        )}

        {!isLoading && sectorData && (
          <>
            {/* Sector header */}
            <div className="mb-10">
              <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
                {t("Manifesto Sector", "Sekta ya Ilani")}
              </p>
              <h1 className="text-4xl font-black tracking-tight uppercase mb-4">
                {lang === "sw" ? (sector?.titleSw ?? sector?.titleEn) : sector?.titleEn}
              </h1>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                {lang === "sw"
                  ? (sector?.descriptionSw ?? sector?.descriptionEn ?? "")
                  : (sector?.descriptionEn ?? "")}
              </p>
            </div>

            {/* Items */}
            {items.length > 0 && (
              <div className="mb-12">
                <h2 className="text-lg font-black uppercase tracking-tight mb-4">
                  {t("Policy Commitments", "Ahadi za Sera")}
                </h2>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <ManifestoItemCard key={item.id ?? i} item={item} lang={lang} />
                  ))}
                </div>
              </div>
            )}

            {/* Policy submission form */}
            <div className="border border-border p-6 shadow-sm">
              <h2 className="text-lg font-black uppercase tracking-tight mb-2">
                {t("Submit a Policy Idea", "Wasilisha Wazo la Sera")}
              </h2>
              <p className="text-muted-foreground text-sm mb-6">
                {t(
                  "Have a policy suggestion for this sector? We want to hear from you.",
                  "Una wazo la sera kwa sekta hii? Tunataka kusikia kutoka kwako."
                )}
              </p>

              {isSuccess ? (
                <div className="bg-primary/10 border border-primary/20 p-6 text-center">
                  <p className="font-black text-primary text-lg mb-1">
                    {t("Thank you!", "Asante!")}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t("Your suggestion has been received.", "Pendekezo lako limepokelewa.")}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div>
                    <Label htmlFor="title">{t("Title *", "Kichwa *")}</Label>
                    <Input
                      id="title"
                      placeholder={t("Brief title for your idea", "Kichwa kifupi cha wazo lako")}
                      {...register("title")}
                      className={cn("mt-1", errors.title && "border-red-500")}
                    />
                    {errors.title && (
                      <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="content">{t("Your Policy Idea *", "Wazo Lako la Sera *")}</Label>
                    <Textarea
                      id="content"
                      rows={4}
                      placeholder={t("Describe your policy idea in detail...", "Eleza wazo lako la sera kwa undani...")}
                      {...register("content")}
                      className={cn("mt-1", errors.content && "border-red-500")}
                    />
                    {errors.content && (
                      <p className="text-red-500 text-xs mt-1">{errors.content.message}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="anonymous"
                      {...register("anonymous")}
                      className="h-4 w-4 accent-primary"
                    />
                    <Label htmlFor="anonymous" className="cursor-pointer">
                      {t("Submit anonymously", "Tuma bila jina")}
                    </Label>
                  </div>

                  {!isAnonymous && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="submitterName">{t("Your Name", "Jina Lako")}</Label>
                        <Input
                          id="submitterName"
                          placeholder={t("Full name", "Jina kamili")}
                          {...register("submitterName")}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="submitterEmail">{t("Your Email", "Barua Pepe Yako")}</Label>
                        <Input
                          id="submitterEmail"
                          type="email"
                          placeholder="email@example.com"
                          {...register("submitterEmail")}
                          className={cn("mt-1", errors.submitterEmail && "border-red-500")}
                        />
                        {errors.submitterEmail && (
                          <p className="text-red-500 text-xs mt-1">{errors.submitterEmail.message}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="bg-primary text-white hover:bg-primary/90 px-6 py-3 font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
                  >
                    {submitting ? t("Submitting...", "Inatuma...") : t("Submit Idea", "Tuma Wazo")}
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </PublicPortalLayout>
  );
}
