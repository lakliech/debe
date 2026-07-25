import { useState } from "react";
import { Link } from "wouter";
import { Newspaper } from "lucide-react";
import { format } from "date-fns";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useListPublicNews } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "", labelEn: "All", labelSw: "Zote" },
  { value: "press_release", labelEn: "Press Release", labelSw: "Taarifa ya Habari" },
  { value: "opinion", labelEn: "Opinion", labelSw: "Maoni" },
  { value: "campaign", labelEn: "Campaign", labelSw: "Kampeni" },
  { value: "policy", labelEn: "Policy", labelSw: "Sera" },
  { value: "event", labelEn: "Event", labelSw: "Tukio" },
];

const CATEGORY_COLORS: Record<string, string> = {
  press_release: "bg-blue-100 text-blue-800",
  opinion: "bg-purple-100 text-purple-800",
  campaign: "bg-primary/10 text-primary",
  policy: "bg-green-100 text-green-800",
  event: "bg-orange-100 text-orange-800",
  default: "bg-gray-100 text-gray-700",
};

export default function News() {
  const { lang, t } = useLanguage();
  const [category, setCategory] = useState("");

  const { data: articles, isLoading, isError, refetch } = useListPublicNews(
    category ? { category } : undefined
  );

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Campaign Updates", "Masasisho ya Kampeni")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("LATEST NEWS", "HABARI ZA HIVI KARIBUNI")}
          </h1>
        </div>
      </section>

      <section className="py-10 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Category tabs */}
          <div className="mb-8 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={cn(
                  "px-4 py-2 text-sm font-bold border transition-colors",
                  category === cat.value
                    ? "bg-black text-white border-black"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                )}
              >
                {lang === "sw" ? cat.labelSw : cat.labelEn}
              </button>
            ))}
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="border border-border shadow-sm">
                  <Skeleton className="h-44 w-full" />
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">{t("Could not load articles.", "Haiwezekani kupakia makala.")}</p>
              <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && (!articles || articles.length === 0) && (
            <div className="text-center py-20">
              <Newspaper className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">{t("No articles found.", "Hakuna makala zilizopatikana.")}</p>
            </div>
          )}

          {/* Articles grid */}
          {!isLoading && articles && articles.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {articles.map((article) => {
                const catColor = CATEGORY_COLORS[article.category ?? ""] ?? CATEGORY_COLORS.default;
                const publishedDate = article.publishedAt ? new Date(article.publishedAt) : null;
                return (
                  <Link
                    key={article.slug}
                    href={`/news/${article.slug}`}
                    className="border border-border shadow-sm hover:shadow-md transition-shadow block group"
                  >
                    {/* Image / gradient */}
                    <div className="h-44 relative overflow-hidden">
                      {article.imageUrl ? (
                        <img
                          src={article.imageUrl}
                          alt={article.titleEn ?? ""}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary to-blue-700 flex items-center justify-center">
                          <Newspaper className="w-8 h-8 text-white/60" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      {article.category && (
                        <span className={cn("text-xs font-bold px-2 py-0.5 uppercase tracking-wider", catColor)}>
                          {article.category.replace("_", " ")}
                        </span>
                      )}
                      <h3 className="font-black text-sm uppercase tracking-tight mt-2 mb-2 group-hover:text-primary transition-colors leading-tight">
                        {lang === "sw" ? (article.titleSw ?? article.titleEn) : article.titleEn}
                      </h3>
                      {article.excerptEn && (
                        <p className="text-muted-foreground text-xs leading-relaxed line-clamp-2">
                          {lang === "sw" ? (article.excerptSw ?? article.excerptEn) : article.excerptEn}
                        </p>
                      )}
                      {publishedDate && (
                        <p className="text-muted-foreground text-xs mt-3 font-medium">
                          {format(publishedDate, "d MMM yyyy")}
                        </p>
                      )}
                    </div>
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
