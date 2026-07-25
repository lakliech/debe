import { Link } from "wouter";
import {
  GraduationCap, Heart, Leaf, Shield, Home, Zap, Droplets, Wifi, Scale,
  TrendingUp, Truck, Globe, Users, Baby, Landmark, Mountain, Wheat,
  Building2, Cpu, Flag,
} from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useListManifestoSectors } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  education: GraduationCap,
  health: Heart,
  environment: Leaf,
  security: Shield,
  housing: Home,
  energy: Zap,
  water: Droplets,
  digital: Wifi,
  justice: Scale,
  economy: TrendingUp,
  transport: Truck,
  trade: Globe,
  youth: Users,
  children: Baby,
  governance: Landmark,
  land: Mountain,
  agriculture: Wheat,
  infrastructure: Building2,
  technology: Cpu,
  default: Flag,
};

function getSectorIcon(category?: string | null): React.ElementType {
  if (!category) return iconMap.default;
  const key = category.toLowerCase();
  for (const [k, icon] of Object.entries(iconMap)) {
    if (key.includes(k)) return icon;
  }
  return iconMap.default;
}

export default function Manifesto() {
  const { lang, t } = useLanguage();
  const { data: sectors, isLoading, isError, refetch } = useListManifestoSectors();

  return (
    <PublicPortalLayout>
      {/* Hero strip */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("The Plan", "Mpango")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("THE MANIFESTO", "ILANI")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t(
              "A comprehensive blueprint for transforming Kenya. Twenty sectors. Thousands of commitments. One direction: forward.",
              "Mpango kamili wa kubadilisha Kenya. Sekta ishirini. Ahadi elfu nyingi. Mwelekeo mmoja: mbele."
            )}
          </p>
        </div>
      </section>

      {/* Sectors grid */}
      <section className="py-12 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="border border-border p-6 shadow-sm animate-pulse">
                  <Skeleton className="h-12 w-12 mb-4" />
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-20">
              <p className="text-muted-foreground mb-4">
                {t("Failed to load manifesto sectors.", "Imeshindwa kupakia sekta za ilani.")}
              </p>
              <button
                onClick={() => refetch()}
                className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90 transition-colors"
              >
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {!isLoading && !isError && (!sectors || sectors.length === 0) && (
            <div className="text-center py-20">
              <Flag className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground font-medium">
                {t("Our manifesto is being finalized.", "Ilani yetu inakamilishwa.")}
              </p>
            </div>
          )}

          {!isLoading && sectors && sectors.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {sectors.map((sector) => {
                const Icon = getSectorIcon(sector.titleEn);
                return (
                  <Link
                    key={sector.slug}
                    href={`/manifesto/${sector.slug}`}
                    className="border border-border p-6 shadow-sm hover:border-primary hover:shadow-md transition-all group block"
                  >
                    <div className="w-12 h-12 bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary transition-colors">
                      <Icon className="w-6 h-6 text-primary group-hover:text-white transition-colors" />
                    </div>
                    <h3 className="font-black text-base uppercase tracking-tight mb-2 group-hover:text-primary transition-colors">
                      {lang === "sw" ? (sector.titleSw ?? sector.titleEn) : sector.titleEn}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed line-clamp-3">
                      {lang === "sw"
                        ? (sector.descriptionSw ?? sector.descriptionEn ?? "")
                        : (sector.descriptionEn ?? "")}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary uppercase tracking-wider">
                      {t("Read More", "Soma Zaidi")}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
