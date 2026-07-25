import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, CheckCircle2, Share2 } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { registerVolunteer } from "@workspace/api-client-react";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ROLES = ["Ward Agent", "Polling Agent", "Social Media Volunteer", "Driver", "Translator", "Other"];
const AVAILABILITY = ["Full-time", "Weekends", "Evenings"];
const SKILLS = ["Driving", "Language Translation", "Social Media", "Legal", "Medical", "Technology", "Teaching", "Other"];

const step1Schema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().min(9, "Valid phone number required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

const step2Schema = z.object({
  countyCode: z.string().min(1, "Please select a county"),
  constituency: z.string().optional(),
  ward: z.string().optional(),
  preferredRole: z.string().min(1, "Please select a role"),
  availability: z.string().min(1, "Please select availability"),
});

const step3Schema = z.object({
  skills: z.array(z.string()).min(1, "Select at least one skill"),
  consent: z.literal(true, { errorMap: () => ({ message: "You must consent to continue" }) }),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;

type AllData = Step1Data & Step2Data & Step3Data;

export default function VolunteerRegister() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<AllData>>({});

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: (body: any) => registerVolunteer(body),
    onSuccess: () => {
      // handled by isSuccess
    },
    onError: () => {
      toast({ title: t("Error", "Hitilafu"), description: t("Could not register. Please try again.", "Haiwezekani kusajili. Tafadhali jaribu tena."), variant: "destructive" });
    },
  });

  const step1Form = useForm<Step1Data>({ resolver: zodResolver(step1Schema), defaultValues: { fullName: formData.fullName ?? "", phone: formData.phone ?? "", email: formData.email ?? "" } });
  const step2Form = useForm<Step2Data>({ resolver: zodResolver(step2Schema), defaultValues: { countyCode: formData.countyCode ?? "", constituency: formData.constituency ?? "", ward: formData.ward ?? "", preferredRole: formData.preferredRole ?? "", availability: formData.availability ?? "" } });
  const step3Form = useForm<Step3Data>({ resolver: zodResolver(step3Schema), defaultValues: { skills: formData.skills ?? [], consent: undefined as any } });

  const handleStep1 = (data: Step1Data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setStep(2);
  };
  const handleStep2 = (data: Step2Data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setStep(3);
  };
  const handleStep3 = (data: Step3Data) => {
    const final = { ...formData, ...data };
    const countyName = KENYA_COUNTIES.find((c) => c.code === final.countyCode)?.name;
    mutate({
      fullName: final.fullName!,
      phone: final.phone!,
      email: final.email || undefined,
      countyCode: final.countyCode,
      countyName,
      constituency: final.constituency,
      ward: final.ward,
      preferredRole: final.preferredRole,
      availability: final.availability,
      skills: final.skills,
      consentMarketing: true,
    });
  };

  const STEP_LABELS = [
    t("Personal Info", "Taarifa za Kibinafsi"),
    t("Location & Role", "Eneo na Jukumu"),
    t("Skills & Consent", "Ujuzi na Idhini"),
  ];

  if (isSuccess) {
    return (
      <PublicPortalLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-20 bg-white text-center">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-4xl font-black uppercase tracking-tight mb-4 text-primary">
            {t("WELCOME TO THE TEAM!", "KARIBU KWENYE TIMU!")}
          </h1>
          <p className="text-muted-foreground max-w-md mb-8">
            {t(
              "You have officially joined the Linda Mwananchi 2027 campaign. Your county coordinator will be in touch soon.",
              "Umejiunga rasmi na kampeni ya Linda Mwananchi 2027. Mratibu wa kaunti yako atawasiliana nawe hivi karibuni."
            )}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent("I just joined the Linda Mwananchi 2027 campaign! Join me: lindamwananchi.ke/volunteer-register")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-[#25D366] text-white px-6 py-3 font-bold text-sm hover:opacity-90 transition-opacity"
            >
              <Share2 className="h-4 w-4" />
              {t("Share on WhatsApp", "Shiriki kwenye WhatsApp")}
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("I just joined the Linda Mwananchi 2027 campaign! #Linda2027 lindamwananchi.ke")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-black text-white px-6 py-3 font-bold text-sm hover:bg-black/80 transition-colors"
            >
              <Share2 className="h-4 w-4" />
              {t("Share on X", "Shiriki kwenye X")}
            </a>
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
            {t("Make a Difference", "Fanya Tofauti")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("JOIN THE MOVEMENT", "JIUNGE NA HARAKATI")}
          </h1>
        </div>
      </section>

      <section className="py-12 px-4 bg-white">
        <div className="max-w-lg mx-auto">
          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  "w-8 h-8 flex items-center justify-center font-black text-sm shrink-0",
                  step > i + 1 ? "bg-primary text-white" : step === i + 1 ? "bg-black text-white" : "bg-gray-200 text-gray-500"
                )}>
                  {step > i + 1 ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn("text-xs font-bold hidden sm:block", step === i + 1 ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
                {i < 2 && <div className={cn("flex-1 h-0.5", step > i + 1 ? "bg-primary" : "bg-gray-200")} />}
              </div>
            ))}
          </div>

          {/* Step 1 */}
          {step === 1 && (
            <form onSubmit={step1Form.handleSubmit(handleStep1)} className="space-y-4">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Personal Information", "Taarifa za Kibinafsi")}</h2>
              <div>
                <Label htmlFor="fullName">{t("Full Name *", "Jina Kamili *")}</Label>
                <Input id="fullName" {...step1Form.register("fullName")} placeholder={t("Your full name", "Jina lako kamili")} className={cn("mt-1", step1Form.formState.errors.fullName && "border-red-500")} />
                {step1Form.formState.errors.fullName && <p className="text-red-500 text-xs mt-1">{step1Form.formState.errors.fullName.message}</p>}
              </div>
              <div>
                <Label htmlFor="phone">{t("Phone Number *", "Nambari ya Simu *")}</Label>
                <Input id="phone" {...step1Form.register("phone")} placeholder="+254 700 000 000" className={cn("mt-1", step1Form.formState.errors.phone && "border-red-500")} />
                {step1Form.formState.errors.phone && <p className="text-red-500 text-xs mt-1">{step1Form.formState.errors.phone.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">{t("Email (optional)", "Barua Pepe (si lazima)")}</Label>
                <Input id="email" type="email" {...step1Form.register("email")} placeholder="email@example.com" className="mt-1" />
              </div>
              <button type="submit" className="w-full flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-widest uppercase transition-colors group">
                {t("Next: Location & Role", "Inayofuata: Eneo na Jukumu")}
                <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <form onSubmit={step2Form.handleSubmit(handleStep2)} className="space-y-4">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Location & Role", "Eneo na Jukumu")}</h2>
              <div>
                <Label htmlFor="countyCode">{t("County *", "Kaunti *")}</Label>
                <select id="countyCode" {...step2Form.register("countyCode")} className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background", step2Form.formState.errors.countyCode && "border-red-500")}>
                  <option value="">{t("Select county...", "Chagua kaunti...")}</option>
                  {KENYA_COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                {step2Form.formState.errors.countyCode && <p className="text-red-500 text-xs mt-1">{step2Form.formState.errors.countyCode.message}</p>}
              </div>
              <div>
                <Label htmlFor="constituency">{t("Constituency (optional)", "Bunge (si lazima)")}</Label>
                <Input id="constituency" {...step2Form.register("constituency")} placeholder={t("Your constituency", "Bunge lako")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ward">{t("Ward (optional)", "Kata (si lazima)")}</Label>
                <Input id="ward" {...step2Form.register("ward")} placeholder={t("Your ward", "Kata yako")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="preferredRole">{t("Preferred Role *", "Jukumu Linalopendelewa *")}</Label>
                <select id="preferredRole" {...step2Form.register("preferredRole")} className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background", step2Form.formState.errors.preferredRole && "border-red-500")}>
                  <option value="">{t("Select role...", "Chagua jukumu...")}</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {step2Form.formState.errors.preferredRole && <p className="text-red-500 text-xs mt-1">{step2Form.formState.errors.preferredRole.message}</p>}
              </div>
              <div>
                <Label htmlFor="availability">{t("Availability *", "Upatikanaji *")}</Label>
                <select id="availability" {...step2Form.register("availability")} className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background", step2Form.formState.errors.availability && "border-red-500")}>
                  <option value="">{t("Select availability...", "Chagua upatikanaji...")}</option>
                  {AVAILABILITY.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {step2Form.formState.errors.availability && <p className="text-red-500 text-xs mt-1">{step2Form.formState.errors.availability.message}</p>}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className="flex-1 border border-border py-3 font-bold text-sm hover:bg-muted transition-colors">
                  {t("Back", "Rudi")}
                </button>
                <button type="submit" className="flex-1 flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-wide uppercase transition-colors group">
                  {t("Next: Skills", "Inayofuata: Ujuzi")}
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </form>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <form onSubmit={step3Form.handleSubmit(handleStep3)} className="space-y-5">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Skills & Consent", "Ujuzi na Idhini")}</h2>
              <div>
                <Label className="mb-2 block">{t("Skills *", "Ujuzi *")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SKILLS.map((skill) => {
                    const checked = (step3Form.watch("skills") ?? []).includes(skill);
                    return (
                      <label key={skill} className={cn("flex items-center gap-2 border p-3 cursor-pointer transition-colors", checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
                        <input
                          type="checkbox"
                          value={skill}
                          checked={checked}
                          onChange={(e) => {
                            const current = step3Form.getValues("skills") ?? [];
                            if (e.target.checked) {
                              step3Form.setValue("skills", [...current, skill]);
                            } else {
                              step3Form.setValue("skills", current.filter((s) => s !== skill));
                            }
                          }}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="text-sm font-medium">{skill}</span>
                      </label>
                    );
                  })}
                </div>
                {step3Form.formState.errors.skills && (
                  <p className="text-red-500 text-xs mt-1">{step3Form.formState.errors.skills.message}</p>
                )}
              </div>

              <div className={cn("border p-4", step3Form.formState.errors.consent ? "border-red-500 bg-red-50" : "border-border bg-gray-50")}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...step3Form.register("consent")}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="text-sm text-foreground leading-relaxed">
                    <span className="font-bold">{t("Consent *: ", "Idhini *: ")}</span>
                    {t(
                      "I consent to being contacted by the Linda Mwananchi campaign for volunteer activities, updates, and coordination purposes.",
                      "Ninakubali kuwasiliana na kampeni ya Linda Mwananchi kwa shughuli za ujitolee, masasisho, na madhumuni ya uratibu."
                    )}
                  </span>
                </label>
                {step3Form.formState.errors.consent && (
                  <p className="text-red-500 text-xs mt-2">{step3Form.formState.errors.consent.message}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className="flex-1 border border-border py-3 font-bold text-sm hover:bg-muted transition-colors">
                  {t("Back", "Rudi")}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-wide uppercase transition-colors disabled:opacity-50"
                >
                  {isPending ? t("Joining...", "Inajiunga...") : t("Join the Movement!", "Jiunge na Harakati!")}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
