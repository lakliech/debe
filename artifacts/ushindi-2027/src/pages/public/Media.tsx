import { Link } from "wouter";
import { Download, Mail, Phone, Image, FileText, Layers } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";

const mediaDownloads = [
  {
    icon: Layers,
    titleEn: "Campaign Logos",
    titleSw: "Nembo za Kampeni",
    descEn: "High-resolution PNG, SVG, and PDF versions of the Linda Mwananchi campaign logo.",
    descSw: "Matoleo ya ubora wa juu ya nembo ya kampeni ya Linda Mwananchi.",
    format: "ZIP, 12MB",
  },
  {
    icon: Image,
    titleEn: "Press Photos",
    titleSw: "Picha za Habari",
    descEn: "Official campaign photography for media use. High-resolution portraits and event photos.",
    descSw: "Upigaji picha rasmi wa kampeni kwa matumizi ya vyombo vya habari.",
    format: "ZIP, 84MB",
  },
  {
    icon: FileText,
    titleEn: "Manifesto PDF",
    titleSw: "Ilani PDF",
    descEn: "The full Linda Mwananchi 2027 Manifesto — print-ready PDF for distribution.",
    descSw: "Ilani kamili ya Linda Mwananchi 2027 — PDF tayari kwa uchapishaji.",
    format: "PDF, 8MB",
  },
];

export default function Media() {
  const { t } = useLanguage();

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Press & Media", "Habari na Vyombo vya Habari")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("MEDIA RESOURCES", "RASILIMALI ZA HABARI")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t(
              "Everything you need to cover the Linda Mwananchi 2027 campaign. Download assets, access contacts, and request credentials.",
              "Kila kitu unachohitaji kufunika kampeni ya Linda Mwananchi 2027. Pakua rasilimali, pata mawasiliano, na omba vitambulisho."
            )}
          </p>
        </div>
      </section>

      {/* Press contacts */}
      <section className="py-12 px-4 bg-white border-b border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-6">
            {t("Press Contacts", "Mawasiliano ya Habari")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="border border-border p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">
                {t("Media Enquiries", "Maswali ya Habari")}
              </p>
              <div className="mt-3 space-y-2">
                <a href="mailto:media@lindamwananchi.ke" className="flex items-center gap-2 text-primary font-bold text-sm hover:underline">
                  <Mail className="h-4 w-4" />
                  media@lindamwananchi.ke
                </a>
                <a href="tel:+254700000000" className="flex items-center gap-2 text-foreground font-medium text-sm hover:text-primary transition-colors">
                  <Phone className="h-4 w-4" />
                  +254 700 000 000
                </a>
              </div>
              <p className="text-muted-foreground text-xs mt-4">
                {t("Available Monday–Saturday, 8am–6pm EAT", "Inapatikana Jumatatu–Jumamosi, 8asubuhi–6jioni EAT")}
              </p>
            </div>

            <div className="border border-border p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">
                {t("Campaign Headquarters", "Makao Makuu ya Kampeni")}
              </p>
              <div className="mt-3">
                <p className="font-bold text-sm">Linda Mwananchi 2027 Campaign</p>
                <p className="text-muted-foreground text-sm">Upper Hill, Nairobi, Kenya</p>
                <p className="text-muted-foreground text-sm">P.O. Box 00100-00200 Nairobi</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Download resources */}
      <section className="py-12 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-6">
            {t("Download Resources", "Pakua Rasilimali")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {mediaDownloads.map((item) => (
              <div key={item.titleEn} className="border border-border p-6 shadow-sm bg-white flex flex-col gap-4">
                <div className="w-12 h-12 bg-primary flex items-center justify-center">
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase tracking-tight">
                    {t(item.titleEn, item.titleSw)}
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
                    {t(item.descEn, item.descSw)}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground mt-2">{item.format}</p>
                </div>
                <button
                  onClick={() => alert("Download coming soon")}
                  className="mt-auto flex items-center gap-2 bg-black text-white hover:bg-black/80 px-4 py-2 font-bold text-xs tracking-wide transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {t("Download", "Pakua")}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Request credential */}
      <section className="py-12 px-4 bg-black text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-black uppercase tracking-tight mb-4">
            {t("Request a Media Credential", "Omba Kitambulisho cha Habari")}
          </h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            {t(
              "Planning to cover a campaign rally or event? Request official press access.",
              "Unapanga kufunika mkutano mkubwa au tukio la kampeni? Omba ufikiaji rasmi wa habari."
            )}
          </p>
          <Link
            href="/contact"
            className="inline-block bg-primary text-white hover:bg-primary/90 px-8 py-3 font-bold text-sm tracking-widest uppercase transition-colors"
          >
            {t("Contact Us", "Wasiliana Nasi")}
          </Link>
        </div>
      </section>
    </PublicPortalLayout>
  );
}
