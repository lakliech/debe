import { HelpCircle } from "lucide-react";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useListFaqItems } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function Faq() {
  const { lang, t } = useLanguage();
  const { data: faqs, isLoading, isError, refetch } = useListFaqItems();

  // Group by category
  const grouped: Record<string, typeof faqs> = {};
  if (faqs) {
    for (const item of faqs) {
      const cat = item.category ?? "General";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(item);
    }
  }
  const categories = Object.keys(grouped);

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Got Questions?", "Una Maswali?")}
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase">
            {t("FREQUENTLY ASKED QUESTIONS", "MASWALI YANAYOULIZWA MARA KWA MARA")}
          </h1>
        </div>
      </section>

      <section className="py-10 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          {/* Loading */}
          {isLoading && (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="border border-border p-4">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">{t("Could not load FAQs.", "Haiwezekani kupakia maswali.")}</p>
              <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && faqs && faqs.length === 0 && (
            <div className="text-center py-20">
              <HelpCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">{t("No FAQs available yet.", "Hakuna maswali bado.")}</p>
            </div>
          )}

          {/* FAQ accordion grouped by category */}
          {!isLoading && categories.length > 0 && (
            <div className="space-y-8">
              {categories.map((cat) => (
                <div key={cat}>
                  <h2 className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-4">{cat}</h2>
                  <Accordion type="single" collapsible className="space-y-2">
                    {(grouped[cat] ?? []).map((faq, i) => (
                      <AccordionItem
                        key={faq.id ?? i}
                        value={`${cat}-${i}`}
                        className="border border-border shadow-sm"
                      >
                        <AccordionTrigger className="px-4 py-3 text-sm font-bold text-left hover:no-underline">
                          {lang === "sw" ? (faq.questionSw ?? faq.questionEn) : faq.questionEn}
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                          {lang === "sw" ? (faq.answerSw ?? faq.answerEn) : faq.answerEn}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </PublicPortalLayout>
  );
}
