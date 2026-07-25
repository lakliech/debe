import { Link } from "wouter";
import { MapPin } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";

export const KENYA_COUNTIES: { code: string; name: string }[] = [
  { code: "001", name: "Mombasa" },
  { code: "002", name: "Kwale" },
  { code: "003", name: "Kilifi" },
  { code: "004", name: "Tana River" },
  { code: "005", name: "Lamu" },
  { code: "006", name: "Taita-Taveta" },
  { code: "007", name: "Garissa" },
  { code: "008", name: "Wajir" },
  { code: "009", name: "Mandera" },
  { code: "010", name: "Marsabit" },
  { code: "011", name: "Isiolo" },
  { code: "012", name: "Meru" },
  { code: "013", name: "Tharaka-Nithi" },
  { code: "014", name: "Embu" },
  { code: "015", name: "Kitui" },
  { code: "016", name: "Machakos" },
  { code: "017", name: "Makueni" },
  { code: "018", name: "Nyandarua" },
  { code: "019", name: "Nyeri" },
  { code: "020", name: "Kirinyaga" },
  { code: "021", name: "Murang'a" },
  { code: "022", name: "Kiambu" },
  { code: "023", name: "Turkana" },
  { code: "024", name: "West Pokot" },
  { code: "025", name: "Samburu" },
  { code: "026", name: "Trans-Nzoia" },
  { code: "027", name: "Uasin Gishu" },
  { code: "028", name: "Elgeyo-Marakwet" },
  { code: "029", name: "Nandi" },
  { code: "030", name: "Baringo" },
  { code: "031", name: "Laikipia" },
  { code: "032", name: "Nakuru" },
  { code: "033", name: "Narok" },
  { code: "034", name: "Kajiado" },
  { code: "035", name: "Kericho" },
  { code: "036", name: "Bomet" },
  { code: "037", name: "Kakamega" },
  { code: "038", name: "Vihiga" },
  { code: "039", name: "Bungoma" },
  { code: "040", name: "Busia" },
  { code: "041", name: "Siaya" },
  { code: "042", name: "Kisumu" },
  { code: "043", name: "Homa Bay" },
  { code: "044", name: "Migori" },
  { code: "045", name: "Kisii" },
  { code: "046", name: "Nyamira" },
  { code: "047", name: "Nairobi" },
];

export default function CountyPriorities() {
  const { t } = useLanguage();

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Across Kenya", "Kote Kenya")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("COUNTY PRIORITIES", "VIPAUMBELE VYA KAUNTI")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t(
              "Select your county to see the specific development priorities and policy commitments for your area.",
              "Chagua kaunti yako kuona vipaumbele vya maendeleo na ahadi za sera kwa eneo lako."
            )}
          </p>
        </div>
      </section>

      {/* Counties grid */}
      <section className="py-12 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex items-center gap-2 text-muted-foreground text-sm">
            <MapPin className="h-4 w-4" />
            <span>{t("47 Counties", "Kaunti 47")}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {KENYA_COUNTIES.map((county) => (
              <Link
                key={county.code}
                href={`/county-priorities/${county.code}`}
                className="border border-border p-4 shadow-sm hover:border-primary hover:shadow-md transition-all group block"
              >
                <div className="text-xs font-black tracking-widest text-muted-foreground mb-1 group-hover:text-primary transition-colors">
                  {county.code}
                </div>
                <div className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                  {county.name}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </PublicPortalLayout>
  );
}
