import { Shield, CheckCircle2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { createDataRequest } from "@workspace/api-client-react";
import { DATA_REQUEST_TYPES, dataRequestTypeSchema } from "@workspace/api-zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Dropdown options — values must match DATA_REQUEST_TYPES exactly.
 * This is the single place to add display labels; the allowed values
 * themselves live in @workspace/api-zod so API and form stay in sync.
 */
const REQUEST_TYPE_LABELS: Record<(typeof DATA_REQUEST_TYPES)[number], { en: string; sw: string }> = {
  access:     { en: "Access — Request a copy of your personal data",  sw: "Ufikiaji — Omba nakala ya data yako ya kibinafsi" },
  correction: { en: "Correction — Correct inaccurate or incomplete data", sw: "Urekebishaji — Rekebisha data isiyo sahihi au kamili" },
  deletion:   { en: "Deletion — Request deletion of your data",       sw: "Ufutaji — Omba ufutaji wa data yako" },
  objection:  { en: "Objection — Object to processing of your data",  sw: "Pingamizi — Pinga usindikaji wa data yako" },
};

/**
 * Form schema — requestType is validated against the API enum, not just
 * checked for non-empty, so DOM manipulation or future option drift is
 * caught before the request reaches the server.
 */
const schema = z.object({
  requestType: dataRequestTypeSchema,
  fullName:    z.string().min(2, "Full name is required"),
  email:       z.string().email("Valid email required"),
  phone:       z.string().optional(),
  description: z.string().min(10, "Please describe your request in more detail"),
});
type FormData = z.infer<typeof schema>;

export default function DataRequest() {
  const { t } = useLanguage();
  const { toast } = useToast();

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: (body: any) => createDataRequest(body),
    onSuccess: () => {
      toast({ title: t("Request Submitted", "Ombi Limetumwa"), description: t("We will respond within 30 days.", "Tutajibu ndani ya siku 30.") });
    },
    onError: () => {
      toast({ title: t("Error", "Hitilafu"), description: t("Could not submit your request. Please try again.", "Haiwezekani kutuma ombi lako. Tafadhali jaribu tena."), variant: "destructive" });
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => {
    mutate({
      requestType: data.requestType,
      fullName: data.fullName,
      email: data.email,
      phoneNumber: data.phone || undefined,
      description: data.description,
    });
  };

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="h-8 w-8 text-primary" />
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary">
              {t("Your Rights Matter", "Haki Zako Zinahusika")}
            </p>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase">
            {t("DATA SUBJECT REQUEST", "OMBI LA MHUSIKA WA DATA")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t(
              "Exercise your rights under the Kenya Data Protection Act 2019. We are committed to processing your request within 30 days.",
              "Tumia haki zako chini ya Sheria ya Ulinzi wa Data ya Kenya 2019. Tumejitolea kuchakata ombi lako ndani ya siku 30."
            )}
          </p>
        </div>
      </section>

      <section className="py-12 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          {/* Rights info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-10">
            {[
              { labelEn: "Right to Access", labelSw: "Haki ya Kupata" },
              { labelEn: "Right to Rectification", labelSw: "Haki ya Kurekebisha" },
              { labelEn: "Right to Erasure", labelSw: "Haki ya Kufutwa" },
              { labelEn: "Right to Portability", labelSw: "Haki ya Kubeba" },
              { labelEn: "Right to Object", labelSw: "Haki ya Kupinga" },
              { labelEn: "30-Day Response", labelSw: "Jibu la Siku 30" },
            ].map((right) => (
              <div key={right.labelEn} className="border border-border p-3 text-center">
                <Shield className="w-5 h-5 text-primary mx-auto mb-1.5" />
                <p className="text-xs font-bold">{t(right.labelEn, right.labelSw)}</p>
              </div>
            ))}
          </div>

          {isSuccess ? (
            <div className="border border-green-200 bg-green-50 p-10 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h2 className="font-black text-xl uppercase text-green-800 mb-3">
                {t("Request Logged Successfully", "Ombi Limerekodiwa Kikamilifu")}
              </h2>
              <p className="text-green-700 text-sm max-w-md mx-auto">
                {t(
                  "Your request has been logged. We will respond within 30 days as required by law under the Kenya Data Protection Act 2019.",
                  "Ombi lako limerekodiwa. Tutajibu ndani ya siku 30 kama inavyohitajika kisheria chini ya Sheria ya Ulinzi wa Data ya Kenya 2019."
                )}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <Label htmlFor="requestType">{t("Request Type *", "Aina ya Ombi *")}</Label>
                <select
                  id="requestType"
                  {...register("requestType")}
                  className={cn(
                    "mt-1 w-full border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary",
                    errors.requestType && "border-red-500"
                  )}
                >
                  <option value="">{t("Select request type...", "Chagua aina ya ombi...")}</option>
                  {DATA_REQUEST_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(REQUEST_TYPE_LABELS[value].en, REQUEST_TYPE_LABELS[value].sw)}
                    </option>
                  ))}
                </select>
                {errors.requestType && <p className="text-red-500 text-xs mt-1">{errors.requestType.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fullName">{t("Full Name *", "Jina Kamili *")}</Label>
                  <Input
                    id="fullName"
                    {...register("fullName")}
                    placeholder={t("Your legal name", "Jina lako la kisheria")}
                    className={cn("mt-1", errors.fullName && "border-red-500")}
                  />
                  {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName.message}</p>}
                </div>
                <div>
                  <Label htmlFor="email">{t("Email Address *", "Anwani ya Barua Pepe *")}</Label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email")}
                    placeholder="email@example.com"
                    className={cn("mt-1", errors.email && "border-red-500")}
                  />
                  {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                </div>
              </div>

              <div>
                <Label htmlFor="phone">{t("Phone Number (optional)", "Nambari ya Simu (si lazima)")}</Label>
                <Input id="phone" {...register("phone")} placeholder="+254 700 000 000" className="mt-1" />
              </div>

              <div>
                <Label htmlFor="description">{t("Request Description *", "Maelezo ya Ombi *")}</Label>
                <Textarea
                  id="description"
                  rows={5}
                  {...register("description")}
                  placeholder={t(
                    "Describe your request in detail. Include any reference numbers, dates, or specific data you are referring to.",
                    "Eleza ombi lako kwa undani. Jumuisha nambari za kumbukumbu, tarehe, au data maalum unazorejelea."
                  )}
                  className={cn("mt-1", errors.description && "border-red-500")}
                />
                {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
              </div>

              <div className="border border-border bg-gray-50 p-4 text-xs text-muted-foreground">
                <Shield className="h-4 w-4 text-primary inline mr-2" />
                {t(
                  "Your request will be handled in accordance with the Kenya Data Protection Act 2019. We may need to verify your identity before processing.",
                  "Ombi lako litashughulikiwa kwa mujibu wa Sheria ya Ulinzi wa Data ya Kenya 2019. Huenda tuhitajike kuthibitisha utambulisho wako kabla ya kuchakata."
                )}
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-8 py-3 font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
              >
                <Shield className="h-4 w-4" />
                {isPending ? t("Submitting...", "Inatuma...") : t("Submit Data Request", "Tuma Ombi la Data")}
              </button>
            </form>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
