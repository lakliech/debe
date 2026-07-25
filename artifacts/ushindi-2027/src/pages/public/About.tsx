import { Link } from "wouter";
import { Scale, TrendingUp, Heart, ChevronRight, Award, BookOpen, Users, Flag } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";

const pillars = [
  {
    icon: Scale,
    titleEn: "Justice",
    titleSw: "Haki",
    descEn: "Equal access to legal protection for every Kenyan, regardless of tribe, class, or region. A justice system that serves the people, not the powerful.",
    descSw: "Ufikiaji sawa wa ulinzi wa kisheria kwa kila Mkenya, bila kujali kabila, darasa, au mkoa.",
  },
  {
    icon: TrendingUp,
    titleEn: "Prosperity",
    titleSw: "Ustawi",
    descEn: "An economy that creates real jobs, supports small businesses, and ensures that Kenya's wealth is shared equitably from Mombasa to Turkana.",
    descSw: "Uchumi unaozalisha kazi za kweli, unasaidia biashara ndogo, na kuhakikisha utajiri wa Kenya unashirikiwa kwa usawa.",
  },
  {
    icon: Heart,
    titleEn: "Unity",
    titleSw: "Umoja",
    descEn: "One Kenya. 47 counties. 47 million possibilities. We build bridges across communities, languages, and generations.",
    descSw: "Kenya moja. Kaunti 47. Uwezekano 47 milioni. Tunajenga madaraja kati ya jamii, lugha, na vizazi.",
  },
];

const milestones = [
  {
    year: "2005",
    titleEn: "Community Legal Aid",
    titleSw: "Msaada wa Kisheria wa Jamii",
    descEn: "Founded a free legal aid clinic in Nairobi's Mathare slum, representing over 2,000 residents in land rights cases.",
    descSw: "Alianzisha kliniki ya msaada wa kisheria bure katika mtaa wa Mathare, Nairobi.",
  },
  {
    year: "2013",
    titleEn: "County Governance Reform",
    titleSw: "Mageuzi ya Utawala wa Kaunti",
    descEn: "Led a coalition of civil society groups that successfully pushed for transparent county budget allocation, saving KSh 2.3 billion.",
    descSw: "Aliongoza muungano wa makundi ya jamii ya kiraia yaliyopigania ugawaji wa bajeti ya kaunti kwa uwazi.",
  },
  {
    year: "2019",
    titleEn: "Education Access Programme",
    titleSw: "Mpango wa Ufikiaji wa Elimu",
    descEn: "Partnered with 200+ schools in arid and semi-arid regions to deliver digital learning tools and sponsor 5,000 girls' education.",
    descSw: "Alishirikiana na shule 200+ katika maeneo ya ukame kutoa zana za kujifunza kidijitali.",
  },
  {
    year: "2024",
    titleEn: "Presidential Bid Announced",
    titleSw: "Ugombea wa Urais Umetangazwa",
    descEn: "Launched the Linda Mwananchi 2027 campaign on the promise: accountable governance, economic justice, and national unity.",
    descSw: "Alizindua kampeni ya Linda Mwananchi 2027 kwa ahadi ya: utawala unaohesabika, haki ya kiuchumi, na umoja wa kitaifa.",
  },
];

export default function About() {
  const { t } = useLanguage();

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-4">
            {t("THE CANDIDATE", "MGOMBEA")}
          </p>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tighter leading-tight mb-6">
            {t("Linda Mwananchi", "Linda Mwananchi")}
          </h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            {t(
              "A lawyer, a community organiser, and a relentless advocate for the ordinary Kenyan. Born in a single-room house in Kisumu, raised on the belief that every citizen deserves dignity and opportunity — not just those with connections.",
              "Wakili, mwandaaji wa jamii, na mtetezi asiye na kikomo kwa Mkenya wa kawaida. Alizaliwa katika nyumba ya chumba kimoja Kisumu, akilelewa kwa imani kwamba kila raia anastahili heshima na fursa."
            )}
          </p>
          <div className="mt-10 grid grid-cols-3 gap-6 max-w-lg">
            {[
              { value: "47", labelEn: "Counties", labelSw: "Kaunti" },
              { value: "20+", labelEn: "Years in Public Service", labelSw: "Miaka ya Huduma" },
              { value: "2M+", labelEn: "Lives Impacted", labelSw: "Maisha Yaliyobadilishwa" },
            ].map((stat) => (
              <div key={stat.value} className="text-center">
                <div className="text-3xl font-black text-primary">{stat.value}</div>
                <div className="text-xs text-gray-400 mt-1 font-medium">
                  {t(stat.labelEn, stat.labelSw)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vision pillars */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("The Vision", "Dira")}
          </p>
          <h2 className="text-3xl font-black tracking-tight text-black uppercase mb-12">
            {t("Three Pillars of Change", "Nguzo Tatu za Mabadiliko")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {pillars.map((pillar) => (
              <div key={pillar.titleEn} className="border border-border p-6 shadow-sm">
                <div className="w-12 h-12 bg-primary flex items-center justify-center mb-4">
                  <pillar.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-black uppercase tracking-tight mb-3">
                  {t(pillar.titleEn, pillar.titleSw)}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t(pillar.descEn, pillar.descSw)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Journey timeline */}
      <section className="py-16 px-4 bg-gray-50 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("The Journey", "Safari")}
          </p>
          <h2 className="text-3xl font-black tracking-tight text-black uppercase mb-12">
            {t("Milestones", "Hatua Muhimu")}
          </h2>
          <div className="relative">
            <div className="absolute left-12 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-10">
              {milestones.map((m, i) => (
                <div key={m.year} className="flex gap-8 relative">
                  <div className="w-24 shrink-0 text-right">
                    <span className="text-primary font-black text-lg">{m.year}</span>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[33px] top-1.5 w-4 h-4 bg-primary border-2 border-white rounded-full" />
                  </div>
                  <div className="flex-1 pb-4">
                    <h3 className="font-black text-base uppercase tracking-tight mb-2">
                      {t(m.titleEn, m.titleSw)}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {t(m.descEn, m.descSw)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 bg-black text-white text-center">
        <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-4">
          {t("Be Part of History", "Kuwa Sehemu ya Historia")}
        </p>
        <h2 className="text-4xl font-black tracking-tight mb-6">
          {t("Join the Movement", "Jiunge na Harakati")}
        </h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          {t(
            "This campaign belongs to every Kenyan who believes in a better future. Add your voice.",
            "Kampeni hii ni ya kila Mkenya anayeamini katika mustakabali bora. Ongeza sauti yako."
          )}
        </p>
        <Link
          href="/volunteer-register"
          className="inline-flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-8 py-4 font-black text-sm tracking-widest uppercase transition-colors group"
        >
          {t("Become a Volunteer", "Kuwa Mjitolee")}
          <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </Link>
      </section>
    </PublicPortalLayout>
  );
}
