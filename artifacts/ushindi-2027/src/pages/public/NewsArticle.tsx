import { Link, useParams } from "wouter";
import { ChevronRight, Newspaper, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useGetPublicNewsArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  press_release: "bg-blue-100 text-blue-800",
  opinion: "bg-purple-100 text-purple-800",
  campaign: "bg-primary/10 text-primary",
  policy: "bg-green-100 text-green-800",
  event: "bg-orange-100 text-orange-800",
  default: "bg-gray-100 text-gray-700",
};

export default function NewsArticle() {
  const params = useParams();
  const slug = params.slug ?? "";
  const { lang, t } = useLanguage();

  const { data: article, isLoading, isError, refetch } = useGetPublicNewsArticle(slug);

  const publishedDate = article?.publishedAt ? new Date(article.publishedAt) : null;
  const catColor = CATEGORY_COLORS[article?.category ?? ""] ?? CATEGORY_COLORS.default;

  return (
    <PublicPortalLayout>
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/news" className="hover:text-primary transition-colors font-medium flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("Back to News", "Rudi kwa Habari")}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-bold text-foreground truncate max-w-xs">
            {isLoading ? "..." : (lang === "sw" ? (article?.titleSw ?? article?.titleEn ?? slug) : (article?.titleEn ?? slug))}
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="animate-pulse space-y-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-64 w-full" />
            <div className="space-y-2 mt-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-20">
            <Newspaper className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">{t("Could not load this article.", "Haiwezekani kupakia makala hii.")}</p>
            <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
              {t("Retry", "Jaribu tena")}
            </button>
          </div>
        )}

        {/* Article */}
        {!isLoading && article && (
          <article>
            {article.category && (
              <span className={cn("text-xs font-bold px-2 py-0.5 uppercase tracking-wider", catColor)}>
                {article.category.replace("_", " ")}
              </span>
            )}

            <h1 className="text-3xl sm:text-4xl font-black tracking-tight uppercase mt-4 mb-4 leading-tight">
              {lang === "sw" ? (article.titleSw ?? article.titleEn) : article.titleEn}
            </h1>

            {publishedDate && (
              <p className="text-muted-foreground text-sm font-medium mb-6">
                {format(publishedDate, "EEEE, d MMMM yyyy")}
              </p>
            )}

            {/* Featured image */}
            <div className="mb-8 aspect-video relative overflow-hidden">
              {article.imageUrl ? (
                <img
                  src={article.imageUrl}
                  alt={article.titleEn ?? ""}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary to-blue-700 flex items-center justify-center">
                  <Newspaper className="w-12 h-12 text-white/60" />
                </div>
              )}
            </div>

            {/* Article body */}
            <div className="prose prose-sm max-w-none text-foreground">
              {article.excerptEn && (
                <p className="text-lg font-medium text-muted-foreground mb-6 leading-relaxed border-l-4 border-primary pl-4">
                  {lang === "sw" ? (article.excerptSw ?? article.excerptEn) : article.excerptEn}
                </p>
              )}
              {article.bodyEn && (
                <div className="text-foreground leading-relaxed whitespace-pre-wrap text-sm">
                  {lang === "sw" ? (article.bodySw ?? article.bodyEn) : article.bodyEn}
                </div>
              )}
            </div>

            {/* Related articles placeholder */}
            <div className="mt-12 pt-8 border-t border-border">
              <h2 className="text-lg font-black uppercase tracking-tight mb-4">
                {t("Related Articles", "Makala Zinazohusiana")}
              </h2>
              <Link href="/news" className="inline-flex items-center gap-2 text-primary font-bold text-sm hover:underline">
                <ChevronRight className="h-4 w-4" />
                {t("View all news", "Tazama habari zote")}
              </Link>
            </div>
          </article>
        )}
      </div>
    </PublicPortalLayout>
  );
}
