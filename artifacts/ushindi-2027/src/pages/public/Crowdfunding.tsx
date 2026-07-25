import { useState } from "react";
import { ChevronRight, Smartphone, Building2, Heart } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const IMPACT_STATS = [
  { value: "142", labelEn: "Rallies Funded", labelSw: "Mikutano Iliyofadhiliwa" },
  { value: "47", labelEn: "Counties Reached", labelSw: "Kaunti Zilizofikiwa" },
  { value: "32K+", labelEn: "Volunteers Supported", labelSw: "Wajitoeleo Waliosaidiwa" },
];

const SUGGESTED_AMOUNTS = [100, 500, 1000, 5000, 10000];

const MPESA_STEPS = [
  { stepEn: "Go to M-Pesa on your phone", stepSw: "Nenda kwa M-Pesa kwenye simu yako" },
  { stepEn: "Select \"Lipa Na M-Pesa\"", stepSw: "Chagua \"Lipa Na M-Pesa\"" },
  { stepEn: "Select \"Pay Bill\"", stepSw: "Chagua \"Pay Bill\"" },
  { stepEn: "Enter Business Number: 3033049", stepSw: "Ingiza Nambari ya Biashara: 3033049" },
  { stepEn: "Enter Account Number: CAMPAIGN", stepSw: "Ingiza Nambari ya Akaunti: CAMPAIGN" },
  { stepEn: "Enter the amount you wish to contribute", stepSw: "Ingiza kiasi unachotaka kuchangia" },
  { stepEn: "Enter your M-Pesa PIN and confirm", stepSw: "Ingiza PIN yako ya M-Pesa na uthibitishe" },
  { stepEn: "You will receive a confirmation SMS", stepSw: "Utapokea SMS ya uthibitisho" },
];

export default function Crowdfunding() {
  const { t } = useLanguage();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-20 px-4 text-center">
        <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-4">
          {t("Power the Movement", "Nguvu ya Harakati")}
        </p>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter uppercase mb-6">
          {t("FUND THE CAMPAIGN", "FADHILI KAMPENI")}
        </h1>
        <p className="text-gray-400 max-w-xl mx-auto text-lg leading-relaxed">
          {t(
            "Every shilling you give powers a rally, trains a volunteer, or reaches a voter who needs to hear our message.",
            "Kila shilingi unayotoa inafadhili mkutano, inafunza mjitolee, au inafika kwa mpiga kura anayehitaji kusikia ujumbe wetu."
          )}
        </p>
      </section>

      {/* Impact stats */}
      <section className="bg-primary py-10 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-6 text-white text-center">
          {IMPACT_STATS.map((stat) => (
            <div key={stat.value}>
              <div className="text-4xl font-black">{stat.value}</div>
              <div className="text-xs font-bold uppercase tracking-wider text-white/80 mt-1">
                {t(stat.labelEn, stat.labelSw)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* M-Pesa instructions */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Paybill card */}
            <div>
              <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-6">
                {t("Lipa Na M-Pesa", "Lipa Na M-Pesa")}
              </h2>
              <div className="border-4 border-black p-8 relative bg-white">
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary" />
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-[#4CAF50] text-white text-xs font-black px-3 py-1.5">
                    M-PESA
                  </div>
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    {t("Paybill Number", "Nambari ya Paybill")}
                  </p>
                  <p className="text-5xl font-black tracking-widest text-black mt-1">3033049</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    {t("Account Number", "Nambari ya Akaunti")}
                  </p>
                  <p className="text-2xl font-black tracking-widest text-primary mt-1">CAMPAIGN</p>
                </div>
              </div>

              {/* Suggested amounts */}
              <div className="mt-8">
                <p className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-4">
                  {t("Suggested Amounts (KSh)", "Kiasi Kinachopendekezwa (KSh)")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_AMOUNTS.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setSelectedAmount(amount === selectedAmount ? null : amount)}
                      className={cn(
                        "px-4 py-2 font-black text-sm border-2 transition-colors",
                        selectedAmount === amount
                          ? "bg-primary text-white border-primary"
                          : "border-black text-black hover:border-primary hover:text-primary"
                      )}
                    >
                      {amount.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step-by-step guide */}
            <div>
              <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-6">
                {t("How to Contribute", "Jinsi ya Kuchangia")}
              </h2>
              <div className="space-y-4">
                {MPESA_STEPS.map((step, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-8 h-8 bg-primary text-white flex items-center justify-center font-black text-sm shrink-0">
                      {i + 1}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed pt-1">
                      {t(step.stepEn, step.stepSw)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bank transfer */}
      <section className="py-12 px-4 bg-gray-50 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="h-6 w-6 text-primary" />
            <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary">
              {t("Bank Transfer", "Uhamisho wa Benki")}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[
              { labelEn: "Bank Name", labelSw: "Jina la Benki", value: "Equity Bank Kenya" },
              { labelEn: "Account Name", labelSw: "Jina la Akaunti", value: "Linda Mwananchi 2027 Campaign" },
              { labelEn: "Account Number", labelSw: "Nambari ya Akaunti", value: "0123456789012" },
              { labelEn: "Branch", labelSw: "Tawi", value: "Upper Hill, Nairobi" },
              { labelEn: "Swift Code", labelSw: "Msimbo wa Swift", value: "EQBLKENA" },
            ].map((item) => (
              <div key={item.labelEn} className="border border-border p-4 bg-white">
                <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(item.labelEn, item.labelSw)}</p>
                <p className="font-bold text-foreground mt-1">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="py-16 px-4 bg-black text-white text-center">
        <Heart className="w-8 h-8 text-primary mx-auto mb-6" />
        <blockquote className="text-2xl sm:text-3xl font-black italic max-w-2xl mx-auto leading-tight">
          "{t("Every shilling counts. Every Kenyan counts.", "Kila shilingi inahesabika. Kila Mkenya anahesabika.")}"
        </blockquote>
        <p className="text-gray-400 mt-4">— Linda Mwananchi</p>
      </section>
    </PublicPortalLayout>
  );
}
