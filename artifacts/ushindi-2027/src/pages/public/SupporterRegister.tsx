import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Heart } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { registerSupporter } from "@workspace/api-client-react";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const POLICY_INTERESTS = [
  { value: "education", labelEn: "Education", labelSw: "Elimu" },
  { value: "healthcare", labelEn: "Healthcare", labelSw: "Afya" },
  { value: "economy", labelEn: "Economy", labelSw: "Uchumi" },
  { value: "security", labelEn: "Security", labelSw: "Usalama" },
  { value: "environment", labelEn: "Environment", labelSw: "Mazingira" },
  { value: "infrastructure", labelEn: "Infrastructure", labelSw: "Miundombinu" },
];

const schema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  countyCode: z.string().optional(),
  policyInterests: z.array(z.string()).optional(),
  consentMarketing: z.boolean().optional(),
  consentSms: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export default function SupporterRegister() {
  const { lang, t } = useLanguage();
  const { toast } = useToast();

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: (body: any) => registerSupporter(body),
    onError: () => {
      toast({ title: t("Error", "Hitilafu"), description: t("Could not register. Please try again.", "Haiwezekani kusajili. Tafadhali jaribu tena."), variant: "destructive" });
    },
  });

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { policyInterests: [], consentMarketing: false, consentSms: false },
  });

  const policyInterests = watch("policyInterests") ?? [];

  const onSubmit = (data: FormData) => {
    const countyName = KENYA_COUNTIES.find((c) => c.code === data.countyCode)?.name;
    mutate({
      fullName: data.fullName,
      phoneNumber: data.phone || undefined,
      email: data.email || undefined,
      countyCode: data.countyCode || undefined,
      countyName,
      policyInterests: data.policyInterests,
      consentMarketing: data.consentMarketing ?? false,
      consentSms: data.consentSms ?? false,
    });
  };

  if (isSuccess) {
    return (
      <PublicPortalLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-20 bg-white text-center">
          <div className="text-6xl mb-6">🙌</div>
          <CheckCircle2 className="w-16 h-16 text-primary mx-auto mb-4" />
          <h1 className="text-4xl font-black uppercase tracking-tight mb-4 text-primary">
            {t("THANK YOU FOR YOUR SUPPORT!", "ASANTE KWA MSAADA WAKO!")}
          </h1>
          <p className="text-muted-foreground max-w-md mb-6 leading-relaxed">
            {t(
              "You are now officially a supporter of the Linda Mwananchi 2027 campaign.",
              "Sasa wewe ni msaidizi rasmi wa kampeni ya Linda Mwananchi 2027."
            )}
          </p>
          <div className="border border-border p-6 text-left max-w-md w-full space-y-3">
            <h3 className="font-black text-sm uppercase tracking-tight">{t("Next Steps:", "Hatua Zinazofuata:")}</h3>
            {[
              t("Watch your phone for campaign updates and news", "Angalia simu yako kwa masasisho na habari za kampeni"),
              t("Follow us on social media @LindaMwananchi2027", "Tufuate kwenye mitandao ya kijamii @LindaMwananchi2027"),
              t("Invite 3 friends to join the movement", "Alika marafiki 3 kujiunga na harakati"),
              t("Attend a rally or town hall near you", "Hudhuria mkutano mkubwa au mdogo karibu nawe"),
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 bg-primary text-white flex items-center justify-center font-black text-xs shrink-0">{i + 1}</div>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </PublicPortalLayout>
    );
  }

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Make Your Voice Count", "Fanya Sauti Yako Isikike")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("BE A SUPPORTER", "KUWA MSAIDIZI")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t(
              "Register your support for Linda Mwananchi 2027. Stay informed, get involved, and help us build a better Kenya.",
              "Sajili msaada wako kwa Linda Mwananchi 2027. Baki na habari, shiriki, na utusaidie kujenga Kenya bora."
            )}
          </p>
        </div>
      </section>

      <section className="py-12 px-4 bg-white">
        <div className="max-w-lg mx-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Personal info */}
            <div>
              <Label htmlFor="fullName">{t("Full Name *", "Jina Kamili *")}</Label>
              <Input
                id="fullName"
                {...register("fullName")}
                placeholder={t("Your full name", "Jina lako kamili")}
                className={cn("mt-1", errors.fullName && "border-red-500")}
              />
              {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone">{t("Phone Number", "Nambari ya Simu")}</Label>
                <Input id="phone" {...register("phone")} placeholder="+254 700 000 000" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="email">{t("Email Address", "Anwani ya Barua Pepe")}</Label>
                <Input id="email" type="email" {...register("email")} placeholder="email@example.com" className="mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="countyCode">{t("County", "Kaunti")}</Label>
              <select id="countyCode" {...register("countyCode")} className="mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background">
                <option value="">{t("Select county...", "Chagua kaunti...")}</option>
                {KENYA_COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>

            {/* Policy interests */}
            <div>
              <Label className="mb-2 block">{t("Policy Interests", "Maslahi ya Sera")}</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {POLICY_INTERESTS.map((pi) => {
                  const checked = policyInterests.includes(pi.value);
                  return (
                    <label key={pi.value} className={cn("flex items-center gap-2 border p-3 cursor-pointer transition-colors", checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
                      <input
                        type="checkbox"
                        value={pi.value}
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setValue("policyInterests", [...policyInterests, pi.value]);
                          } else {
                            setValue("policyInterests", policyInterests.filter((v) => v !== pi.value));
                          }
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm font-medium">{lang === "sw" ? pi.labelSw : pi.labelEn}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Consent */}
            <div className="space-y-3 border border-border bg-gray-50 p-4">
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t("Communication Preferences", "Mapendeleo ya Mawasiliano")}</p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" {...register("consentMarketing")} className="mt-0.5 h-4 w-4 accent-primary" />
                <span className="text-sm text-foreground">
                  {t(
                    "I agree to receive campaign updates, news, and marketing communications via email.",
                    "Nakubali kupokea masasisho ya kampeni, habari, na mawasiliano ya uuzaji kupitia barua pepe."
                  )}
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" {...register("consentSms")} className="mt-0.5 h-4 w-4 accent-primary" />
                <span className="text-sm text-foreground">
                  {t(
                    "I agree to receive SMS updates and alerts from the Linda Mwananchi 2027 campaign.",
                    "Nakubali kupokea masasisho ya SMS na arifa kutoka kwa kampeni ya Linda Mwananchi 2027."
                  )}
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-4 font-black text-sm tracking-widest uppercase transition-colors disabled:opacity-50"
            >
              <Heart className="h-4 w-4" />
              {isPending ? t("Registering...", "Inasajili...") : t("I Support Linda Mwananchi", "Naunga Mkono Linda Mwananchi")}
            </button>
          </form>
        </div>
      </section>
    </PublicPortalLayout>
  );
}
