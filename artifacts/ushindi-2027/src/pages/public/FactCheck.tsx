import { ExternalLink, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useListFactCheckItems } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Rating = "TRUE" | "FALSE" | "PARTIALLY_TRUE" | "MISLEADING" | string;

function getRatingStyle(rating?: Rating | null): { bg: string; text: string; icon: React.ElementType; label: string } {
  switch ((rating ?? "").toUpperCase()) {
    case "TRUE":
      return { bg: "bg-green-50 border-green-200", text: "text-green-700", icon: CheckCircle2, label: "TRUE" };
    case "FALSE":
      return { bg: "bg-red-50 border-red-200", text: "text-red-700", icon: XCircle, label: "FALSE" };
    case "PARTIALLY_TRUE":
    case "PARTIALLY TRUE":
      return { bg: "bg-yellow-50 border-yellow-200", text: "text-yellow-700", icon: AlertTriangle, label: "PARTIALLY TRUE" };
    case "MISLEADING":
      return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", icon: AlertTriangle, label: "MISLEADING" };
    default:
      return { bg: "bg-gray-50 border-gray-200", text: "text-gray-700", icon: HelpCircle, label: rating ?? "UNKNOWN" };
  }
}

export default function FactCheck() {
  const { lang, t } = useLanguage();
  const { data: items, isLoading, isError, refetch } = useListFactCheckItems();

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Accountability", "Uwajibikaji")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("FACT CHECK", "UKAGUZI WA UKWELI")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl italic">
            "{t("We hold ourselves and our opponents to the truth.", "Tunajiwajibisha sisi wenyewe na wapinzani wetu kwa ukweli.")}"
          </p>
        </div>
      </section>

      <section className="py-10 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          {/* Rating legend */}
          <div className="mb-8 flex flex-wrap gap-3">
            {[
              { rating: "TRUE", labelEn: "True", labelSw: "Kweli" },
              { rating: "FALSE", labelEn: "False", labelSw: "Uongo" },
              { rating: "PARTIALLY_TRUE", labelEn: "Partially True", labelSw: "Kweli kwa Kiasi" },
              { rating: "MISLEADING", labelEn: "Misleading", labelSw: "Upotoshaji" },
            ].map(({ rating, labelEn, labelSw }) => {
              const style = getRatingStyle(rating);
              const Icon = style.icon;
              return (
                <div key={rating} className={cn("flex items-center gap-1.5 px-3 py-1.5 border text-xs font-bold", style.bg, style.text)}>
                  <Icon className="h-3.5 w-3.5" />
                  {lang === "sw" ? labelSw : labelEn}
                </div>
              );
            })}
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border border-border p-6 shadow-sm space-y-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">{t("Could not load fact checks.", "Haiwezekani kupakia ukaguzi wa ukweli.")}</p>
              <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && (!items || items.length === 0) && (
            <div className="text-center py-20">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">{t("No fact checks published yet.", "Hakuna ukaguzi wa ukweli uliochapishwa bado.")}</p>
            </div>
          )}

          {/* Fact check cards */}
          {!isLoading && items && items.length > 0 && (
            <div className="space-y-4">
              {items.map((item, i) => {
                const style = getRatingStyle(item.rating);
                const Icon = style.icon;
                return (
                  <div key={item.id ?? i} className={cn("border p-6 shadow-sm", style.bg)}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className={cn("flex items-center gap-2 text-xs font-black uppercase tracking-wider px-2 py-1 border", style.bg, style.text)}>
                        <Icon className="h-4 w-4" />
                        {style.label}
                      </div>
                    </div>

                    <div className="mb-3">
                      <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-1">
                        {t("The Claim", "Dai")}
                      </p>
                      <p className="font-bold text-foreground leading-relaxed">
                        "{lang === "sw" ? (item.claimSw ?? item.claimEn) : item.claimEn}"
                      </p>
                    </div>

                    <div className="mb-4">
                      <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-1">
                        {t("The Verdict", "Hukumu")}
                      </p>
                      <p className="text-sm text-foreground leading-relaxed">
                        {lang === "sw" ? (item.verdictSw ?? item.verdictEn) : item.verdictEn}
                      </p>
                    </div>

                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("View Source", "Tazama Chanzo")}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
