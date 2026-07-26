import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, CheckCircle2, Vote } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const POSITIONS = [
  { value: "parliamentary",  label: "Member of Parliament (MP)",          scope: "constituency" },
  { value: "gubernatorial",  label: "Governor",                           scope: "county" },
  { value: "senatorial",     label: "Senator",                            scope: "county" },
  { value: "women_rep",      label: "Women Representative",               scope: "county" },
  { value: "mca",            label: "Member of County Assembly (MCA)",    scope: "ward" },
];

// ── Step schemas ──────────────────────────────────────────────────────────────
const step1Schema = z.object({
  fullName:   z.string().min(2, "Full name is required"),
  phoneNumber: z.string().min(9, "Valid phone number required"),
  email:      z.string().email("Invalid email").optional().or(z.literal("")),
  nationalId: z.string().min(5, "National ID / Passport is required"),
});

const step2Schema = z.object({
  position:    z.string().min(1, "Please select a position"),
  countyCode:  z.string().min(1, "Please select a county"),
  constituency: z.string().optional(),
  ward:        z.string().optional(),
});

const step3Schema = z.object({
  partyAffiliation:  z.string().optional(),
  isIndependent:     z.boolean().default(false),
  statementOfIntent: z.string().min(20, "Please provide a statement of at least 20 characters"),
  consent: z.literal(true, { errorMap: () => ({ message: "You must consent to proceed" }) }),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;
type AllData = Step1Data & Step2Data & Step3Data;

// ── Component ─────────────────────────────────────────────────────────────────
export default function AspirantRegister() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<AllData>>({});

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch(`${BASE}/api/public/aspirants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Registration failed");
      }
      return res.json();
    },
    onError: (err: any) => {
      toast({
        title: t("Error", "Hitilafu"),
        description: err.message || t("Could not register. Please try again.", "Haiwezekani kusajili. Tafadhali jaribu tena."),
        variant: "destructive",
      });
    },
  });

  const step1Form = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: { fullName: formData.fullName ?? "", phoneNumber: formData.phoneNumber ?? "", email: formData.email ?? "", nationalId: formData.nationalId ?? "" },
  });
  const step2Form = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: { position: formData.position ?? "", countyCode: formData.countyCode ?? "", constituency: formData.constituency ?? "", ward: formData.ward ?? "" },
  });
  const step3Form = useForm<Step3Data>({
    resolver: zodResolver(step3Schema),
    defaultValues: { partyAffiliation: formData.partyAffiliation ?? "", isIndependent: formData.isIndependent ?? false, statementOfIntent: formData.statementOfIntent ?? "", consent: undefined as any },
  });

  const selectedPosition = step2Form.watch("position");
  const positionMeta = POSITIONS.find((p) => p.value === selectedPosition);
  const isIndependent = step3Form.watch("isIndependent");

  const handleStep1 = (data: Step1Data) => { setFormData((p) => ({ ...p, ...data })); setStep(2); };
  const handleStep2 = (data: Step2Data) => { setFormData((p) => ({ ...p, ...data })); setStep(3); };
  const handleStep3 = (data: Step3Data) => {
    const final = { ...formData, ...data };
    const county = KENYA_COUNTIES.find((c) => c.code === final.countyCode);
    mutate({
      fullName:          final.fullName,
      phoneNumber:       final.phoneNumber,
      email:             final.email || undefined,
      nationalId:        final.nationalId,
      position:          final.position,
      countyCode:        final.countyCode,
      countyName:        county?.name,
      constituency:      final.constituency || undefined,
      ward:              final.ward || undefined,
      partyAffiliation:  data.isIndependent ? undefined : (data.partyAffiliation || undefined),
      isIndependent:     data.isIndependent,
      statementOfIntent: data.statementOfIntent,
      consentGiven:      true,
    });
  };

  const STEP_LABELS = [
    t("Personal Info",       "Taarifa za Kibinafsi"),
    t("Seat & Location",     "Kiti na Eneo"),
    t("Statement & Consent", "Taarifa na Idhini"),
  ];

  // ── Success ───────────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <PublicPortalLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-20 bg-white text-center">
          <div className="w-16 h-16 bg-primary flex items-center justify-center mb-6">
            <Vote className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-black uppercase tracking-tight mb-4 text-primary">
            {t("DECLARATION RECEIVED", "TAMKO LIMEPOKELEWA")}
          </h1>
          <p className="text-muted-foreground max-w-md mb-8">
            {t(
              "Thank you for declaring your interest. The Linda Mwananchi 2027 team will review your application and be in touch.",
              "Asante kwa kutangaza nia yako. Timu ya Linda Mwananchi 2027 itakagua ombi lako na kuwasiliana nawe."
            )}
          </p>
          <a href="/" className="bg-primary text-white px-8 py-3 font-black tracking-widest uppercase hover:bg-primary/90 transition-colors">
            {t("Back to Home", "Rudi Nyumbani")}
          </a>
        </div>
      </PublicPortalLayout>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("2027 Elections", "Uchaguzi 2027")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("DECLARE YOUR INTEREST", "TANGAZA NIA YAKO")}
          </h1>
          <p className="text-gray-400 mt-3 max-w-lg">
            {t(
              "Running for elective office in 2027? Register your candidacy interest with the Linda Mwananchi movement.",
              "Unataka kugombea kiti cha kisiasa 2027? Sajili nia yako ya ugombezi na harakati ya Linda Mwananchi."
            )}
          </p>
        </div>
      </section>

      <section className="py-12 px-4 bg-white">
        <div className="max-w-lg mx-auto">
          {/* Progress */}
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

          {/* ── Step 1: Personal Info ── */}
          {step === 1 && (
            <form onSubmit={step1Form.handleSubmit(handleStep1)} className="space-y-4">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Personal Information", "Taarifa za Kibinafsi")}</h2>
              <div>
                <Label htmlFor="fullName">{t("Full Name *", "Jina Kamili *")}</Label>
                <Input id="fullName" {...step1Form.register("fullName")} placeholder={t("Your full legal name", "Jina lako kamili la kisheria")} className={cn("mt-1", step1Form.formState.errors.fullName && "border-red-500")} />
                {step1Form.formState.errors.fullName && <p className="text-red-500 text-xs mt-1">{step1Form.formState.errors.fullName.message}</p>}
              </div>
              <div>
                <Label htmlFor="phoneNumber">{t("Phone Number *", "Nambari ya Simu *")}</Label>
                <Input id="phoneNumber" {...step1Form.register("phoneNumber")} placeholder="+254 700 000 000" className={cn("mt-1", step1Form.formState.errors.phoneNumber && "border-red-500")} />
                {step1Form.formState.errors.phoneNumber && <p className="text-red-500 text-xs mt-1">{step1Form.formState.errors.phoneNumber.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">{t("Email (optional)", "Barua Pepe (si lazima)")}</Label>
                <Input id="email" type="email" {...step1Form.register("email")} placeholder="email@example.com" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="nationalId">{t("National ID / Passport *", "Kitambulisho / Pasipoti *")}</Label>
                <Input id="nationalId" {...step1Form.register("nationalId")} placeholder={t("Your ID number", "Nambari yako ya kitambulisho")} className={cn("mt-1", step1Form.formState.errors.nationalId && "border-red-500")} />
                {step1Form.formState.errors.nationalId && <p className="text-red-500 text-xs mt-1">{step1Form.formState.errors.nationalId.message}</p>}
              </div>
              <button type="submit" className="w-full flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-widest uppercase transition-colors group">
                {t("Next: Seat & Location", "Inayofuata: Kiti na Eneo")}
                <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          )}

          {/* ── Step 2: Seat & Location ── */}
          {step === 2 && (
            <form onSubmit={step2Form.handleSubmit(handleStep2)} className="space-y-4">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Seat & Location", "Kiti na Eneo")}</h2>
              <div>
                <Label htmlFor="position">{t("Position Sought *", "Kiti Kinachotafutwa *")}</Label>
                <select id="position" {...step2Form.register("position")} className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background", step2Form.formState.errors.position && "border-red-500")}>
                  <option value="">{t("Select position...", "Chagua kiti...")}</option>
                  {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {step2Form.formState.errors.position && <p className="text-red-500 text-xs mt-1">{step2Form.formState.errors.position.message}</p>}
              </div>
              <div>
                <Label htmlFor="countyCode">{t("County *", "Kaunti *")}</Label>
                <select id="countyCode" {...step2Form.register("countyCode")} className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background", step2Form.formState.errors.countyCode && "border-red-500")}>
                  <option value="">{t("Select county...", "Chagua kaunti...")}</option>
                  {KENYA_COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                {step2Form.formState.errors.countyCode && <p className="text-red-500 text-xs mt-1">{step2Form.formState.errors.countyCode.message}</p>}
              </div>
              {(positionMeta?.scope === "constituency" || positionMeta?.scope === "ward") && (
                <div>
                  <Label htmlFor="constituency">{t("Constituency *", "Bunge la Kaunti *")}</Label>
                  <Input id="constituency" {...step2Form.register("constituency")} placeholder={t("Your constituency name", "Jina la bunge lako")} className="mt-1" />
                </div>
              )}
              {positionMeta?.scope === "ward" && (
                <div>
                  <Label htmlFor="ward">{t("Ward *", "Kata *")}</Label>
                  <Input id="ward" {...step2Form.register("ward")} placeholder={t("Your ward name", "Jina la kata yako")} className="mt-1" />
                </div>
              )}
              {positionMeta && (
                <div className="bg-primary/5 border border-primary/20 px-4 py-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">{positionMeta.label}</strong> —{" "}
                  {positionMeta.scope === "county"
                    ? t("County-wide seat.", "Kiti cha kaunti nzima.")
                    : positionMeta.scope === "constituency"
                    ? t("Represents a constituency.", "Inawakilisha bunge la kaunti.")
                    : t("Represents a ward.", "Inawakilisha kata.")}
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className="flex-1 border border-border py-3 font-bold text-sm hover:bg-muted transition-colors">{t("Back", "Rudi")}</button>
                <button type="submit" className="flex-1 flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-wide uppercase transition-colors group">
                  {t("Next: Statement", "Inayofuata: Taarifa")}
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </form>
          )}

          {/* ── Step 3: Statement & Consent ── */}
          {step === 3 && (
            <form onSubmit={step3Form.handleSubmit(handleStep3)} className="space-y-5">
              <h2 className="font-black text-lg uppercase tracking-tight">{t("Statement & Consent", "Taarifa na Idhini")}</h2>

              {/* Party / Independent toggle */}
              <div className="space-y-2">
                <Label>{t("Political Affiliation", "Uhusiano wa Kisiasa")}</Label>
                <div className="flex gap-3">
                  {[
                    { label: t("Party Candidate", "Mgombea wa Chama"), val: false },
                    { label: t("Independent",     "Mgombea Huru"),     val: true  },
                  ].map(({ label, val }) => (
                    <label key={String(val)} className={cn("flex-1 flex items-center justify-center border py-3 cursor-pointer text-sm font-bold transition-colors",
                      isIndependent === val ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50")}>
                      <input type="radio" className="sr-only" checked={isIndependent === val} onChange={() => step3Form.setValue("isIndependent", val)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {!isIndependent && (
                <div>
                  <Label htmlFor="partyAffiliation">{t("Party Name (optional)", "Jina la Chama (si lazima)")}</Label>
                  <Input id="partyAffiliation" {...step3Form.register("partyAffiliation")} placeholder={t("e.g. United Democratic Alliance", "mf. Umoja wa Kidemokrasia")} className="mt-1" />
                </div>
              )}

              <div>
                <Label htmlFor="statementOfIntent">{t("Statement of Intent *", "Taarifa ya Nia *")}</Label>
                <textarea
                  id="statementOfIntent"
                  {...step3Form.register("statementOfIntent")}
                  rows={5}
                  placeholder={t(
                    "Briefly describe why you are seeking this elective position and what you will do for your constituents...",
                    "Elezea kwa ufupi kwa nini unatafuta kiti hiki na utafanya nini kwa wapiga kura wako..."
                  )}
                  className={cn("mt-1 w-full border border-input px-3 py-2 text-sm focus:outline-none focus:border-primary bg-background resize-none", step3Form.formState.errors.statementOfIntent && "border-red-500")}
                />
                {step3Form.formState.errors.statementOfIntent && <p className="text-red-500 text-xs mt-1">{step3Form.formState.errors.statementOfIntent.message}</p>}
                <p className="text-xs text-muted-foreground mt-1">{step3Form.watch("statementOfIntent")?.length ?? 0} {t("characters", "herufi")}</p>
              </div>

              {/* Consent */}
              <label className={cn("flex items-start gap-3 border p-4 cursor-pointer transition-colors",
                step3Form.watch("consent") ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                step3Form.formState.errors.consent && "border-red-500")}>
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary shrink-0"
                  checked={step3Form.watch("consent") === true}
                  onChange={(e) => step3Form.setValue("consent", e.target.checked as true)}
                />
                <span className="text-sm text-muted-foreground leading-relaxed">
                  {t(
                    "I consent to the Linda Mwananchi 2027 campaign storing and processing my information for aspirant vetting and coordination purposes.",
                    "Ninatoa idhini kwa kampeni ya Linda Mwananchi 2027 kuhifadhi na kuchakata taarifa zangu kwa madhumuni ya uchunguzi na uratibu wa wagombea."
                  )}
                </span>
              </label>
              {step3Form.formState.errors.consent && <p className="text-red-500 text-xs mt-1">{step3Form.formState.errors.consent.message}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className="flex-1 border border-border py-3 font-bold text-sm hover:bg-muted transition-colors">{t("Back", "Rudi")}</button>
                <button type="submit" disabled={isPending} className="flex-1 flex items-center justify-center gap-2 bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-wide uppercase transition-colors disabled:opacity-60">
                  {isPending ? t("Submitting...", "Inawasilisha...") : t("Submit Declaration", "Wasilisha Tamko")}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
