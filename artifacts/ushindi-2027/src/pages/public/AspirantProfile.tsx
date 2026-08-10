import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ChevronLeft, ChevronRight, MapPin, Vote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { customFetch } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const POSITIONS = [
  { value: "parliamentary", labelEn: "Member of Parliament",       labelSw: "Mbunge" },
  { value: "gubernatorial", labelEn: "Governor",                   labelSw: "Gavana" },
  { value: "senatorial",    labelEn: "Senator",                    labelSw: "Seneta" },
  { value: "women_rep",     labelEn: "Women Representative",       labelSw: "Mwakilishi wa Wanawake" },
  { value: "mca",           labelEn: "Member of County Assembly",  labelSw: "MCA" },
];

function positionLabel(value: string, lang: string) {
  const p = POSITIONS.find((x) => x.value === value);
  if (!p) return value;
  return lang === "sw" ? p.labelSw : p.labelEn;
}

interface Aspirant {
  id: string;
  fullName: string;
  position: string;
  countyName: string | null;
  constituency: string | null;
  ward: string | null;
  partyAffiliation: string | null;
  isIndependent: boolean;
  statementOfIntent: string | null;
  createdAt: string;
}

/**
 * Injects / updates Open Graph + Twitter Card meta tags.
 * Cleans up on unmount so other pages aren't affected.
 */
function useOgMeta(aspirant: Aspirant | null | undefined, lang: string) {
  useEffect(() => {
    if (!aspirant) return;

    const pos = positionLabel(aspirant.position, lang);
    const location = [aspirant.constituency, aspirant.countyName].filter(Boolean).join(", ");
    const title = `${aspirant.fullName} — ${pos}${location ? ` · ${location}` : ""}`;
    const description = aspirant.statementOfIntent
      ? aspirant.statementOfIntent.slice(0, 200)
      : `Approved aspirant for ${pos} under the Linda Mwananchi movement.`;
    const url = window.location.href;

    const prev: Record<string, string | null> = {};

    function setMeta(property: string, content: string, isName = false) {
      const attr = isName ? "name" : "property";
      let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, property);
        document.head.appendChild(el);
        prev[property] = null; // mark as newly created
      } else {
        if (!(property in prev)) prev[property] = el.getAttribute("content");
      }
      el.setAttribute("content", content);
    }

    // Set document title
    const prevTitle = document.title;
    document.title = title;

    setMeta("og:type", "profile");
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:url", url);
    setMeta("twitter:card", "summary", true);
    setMeta("twitter:title", title, true);
    setMeta("twitter:description", description, true);

    return () => {
      document.title = prevTitle;
      for (const [property, original] of Object.entries(prev)) {
        // Try both property and name attributes
        const el =
          document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ??
          document.querySelector<HTMLMetaElement>(`meta[name="${property}"]`);
        if (!el) continue;
        if (original === null) {
          el.remove();
        } else {
          el.setAttribute("content", original);
        }
      }
    };
  }, [aspirant, lang]);
}

export default function AspirantProfile() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();

  const { data: aspirant, isLoading, isError } = useQuery<Aspirant>({
    queryKey: ["/api/public/aspirants", id],
    queryFn: () =>
      customFetch<Aspirant>(`${BASE}/api/public/aspirants/${id}`, {
        responseType: "json",
      }),
    enabled: !!id,
    retry: (failureCount, error: any) => {
      // Don't retry 404s — the profile doesn't exist or isn't approved
      if (error?.status === 404) return false;
      return failureCount < 1;
    },
  });

  useOgMeta(aspirant, lang);

  return (
    <PublicPortalLayout>
      {/* Back nav */}
      <div className="border-b border-border bg-muted/20 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/aspirants-directory"
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            {t("Aspirant Directory", "Orodha ya Wagombea")}
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="max-w-3xl mx-auto px-4 py-14 space-y-5">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full mt-6" />
        </div>
      ) : isError || !aspirant ? (
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <Vote className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <h1 className="text-2xl font-black uppercase tracking-tight mb-2">
            {t("Aspirant Not Found", "Mgombea Haonekani")}
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            {t(
              "This aspirant profile does not exist or has not been approved.",
              "Wasifu huu haujulikani au bado haukuidhinishwa."
            )}
          </p>
          <Link
            href="/aspirants-directory"
            className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2.5 font-black text-sm tracking-widest uppercase hover:bg-primary/90 transition-colors"
          >
            {t("View All Aspirants", "Angalia Wagombea Wote")}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          {/* Hero */}
          <section className="bg-black text-white py-12 px-4">
            <div className="max-w-3xl mx-auto">
              <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
                {t("Aspirant Profile", "Wasifu wa Mgombea")}
              </p>
              <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase leading-tight mb-4">
                {aspirant.fullName}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="font-mono text-xs border-white/30 text-white">
                  {positionLabel(aspirant.position, lang)}
                </Badge>
                {aspirant.isIndependent ? (
                  <span className="text-xs font-bold bg-white/10 px-2 py-0.5 text-white/80">
                    {t("Independent", "Mgombea Huru")}
                  </span>
                ) : aspirant.partyAffiliation ? (
                  <span className="text-xs font-bold bg-white/10 px-2 py-0.5 text-white/80">
                    {aspirant.partyAffiliation}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          {/* Profile body */}
          <section className="py-10 px-4">
            <div className="max-w-3xl mx-auto space-y-8">
              {/* Location */}
              {(aspirant.countyName || aspirant.constituency || aspirant.ward) && (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
                    {t("Location", "Eneo")}
                  </p>
                  <dl className="divide-y divide-border border border-border">
                    {aspirant.countyName && (
                      <div className="flex gap-4 px-4 py-3 items-center">
                        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                        <dt className="font-bold text-sm w-28 shrink-0">{t("County", "Kaunti")}</dt>
                        <dd className="text-sm">{aspirant.countyName}</dd>
                      </div>
                    )}
                    {aspirant.constituency && (
                      <div className="flex gap-4 px-4 py-3 items-center">
                        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                        <dt className="font-bold text-sm w-28 shrink-0">{t("Constituency", "Bunge")}</dt>
                        <dd className="text-sm">{aspirant.constituency}</dd>
                      </div>
                    )}
                    {aspirant.ward && (
                      <div className="flex gap-4 px-4 py-3 items-center">
                        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                        <dt className="font-bold text-sm w-28 shrink-0">{t("Ward", "Kata")}</dt>
                        <dd className="text-sm">{aspirant.ward}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Statement of intent */}
              {aspirant.statementOfIntent && (
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
                    {t("Statement of Intent", "Taarifa ya Nia")}
                  </p>
                  <blockquote className="border-l-4 border-primary pl-5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {aspirant.statementOfIntent}
                  </blockquote>
                </div>
              )}

              {/* Share section */}
              <div className="border border-border p-5">
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
                  {t("Share This Profile", "Shiriki Wasifu Huu")}
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  {t(
                    "Copy the link below to share this aspirant's profile on WhatsApp or social media.",
                    "Nakili kiungo hapa chini kushiriki wasifu huu kwenye WhatsApp au mitandao ya kijamii."
                  )}
                </p>
                {(() => {
                  // The share URL points to the server-rendered HTML page so social
                  // crawlers (WhatsApp, Facebook, X) receive proper Open Graph tags.
                  // Human visitors are redirected from that page to the SPA immediately.
                  const shareUrl = `${window.location.origin}${BASE}/api/public/aspirants/${aspirant.id}/page`;
                  return (
                    <div className="flex items-stretch gap-2">
                      <input
                        readOnly
                        value={shareUrl}
                        className="flex-1 border border-input px-3 py-2 text-xs font-mono bg-muted focus:outline-none truncate"
                      />
                      <button
                        onClick={() => void navigator.clipboard.writeText(shareUrl)}
                        className="px-4 py-2 bg-primary text-white text-xs font-black tracking-widest uppercase hover:bg-primary/90 transition-colors shrink-0"
                      >
                        {t("Copy", "Nakili")}
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="bg-primary/5 border-t border-primary/10 py-10 px-4 text-center">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
              {t("Thinking of running?", "Unafikiria kugombea?")}
            </p>
            <h2 className="text-2xl font-black uppercase tracking-tight mb-3">
              {t("DECLARE YOUR INTEREST", "TANGAZA NIA YAKO")}
            </h2>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <Link
                href="/aspirants-directory"
                className="inline-flex items-center gap-2 border border-primary text-primary hover:bg-primary/5 px-6 py-2.5 font-black text-sm tracking-widest uppercase transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                {t("All Aspirants", "Wagombea Wote")}
              </Link>
              <a
                href="/aspirant-register"
                className="inline-flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-6 py-2.5 font-black text-sm tracking-widest uppercase transition-colors"
              >
                {t("Register Now", "Jisajili Sasa")}
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>
          </section>
        </>
      )}
    </PublicPortalLayout>
  );
}
