import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Vote, Search, ChevronLeft, ChevronRight, X, MapPin, Users } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const POSITIONS = [
  { value: "parliamentary", labelEn: "Member of Parliament",       labelSw: "Mbunge" },
  { value: "gubernatorial", labelEn: "Governor",                   labelSw: "Gavana" },
  { value: "senatorial",    labelEn: "Senator",                    labelSw: "Seneta" },
  { value: "women_rep",     labelEn: "Women Representative",       labelSw: "Mwakilishi wa Wanawake" },
  { value: "mca",           labelEn: "Member of County Assembly",  labelSw: "MCA" },
];

const PAGE_SIZE = 24;

function positionLabel(value: string, lang: string) {
  const p = POSITIONS.find((x) => x.value === value);
  if (!p) return value;
  return lang === "sw" ? p.labelSw : p.labelEn;
}

function CardSkeleton() {
  return (
    <div className="border border-border p-5 space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-8 w-24 mt-2" />
    </div>
  );
}

export default function AspirantsDirectory() {
  const { t, lang } = useLanguage();
  const [position, setPosition] = useState("");
  const [county, setCounty]     = useState("");
  const [search, setSearch]     = useState("");
  const [page, setPage]         = useState(1);
  const [selected, setSelected] = useState<any>(null);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (position) params.set("position", position);
  if (county)   params.set("county", county);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/public/aspirants", position, county, page],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/public/aspirants?${params}`);
      if (!res.ok) throw new Error("Failed to load aspirants");
      return res.json() as Promise<{ data: any[]; total: number; page: number; limit: number }>;
    },
  });

  const allAspirants = data?.data ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / PAGE_SIZE);

  // Client-side name filter (fast, avoids extra API param)
  const aspirants = search.trim()
    ? allAspirants.filter((a) => a.fullName.toLowerCase().includes(search.toLowerCase()))
    : allAspirants;

  const clearFilters = () => { setPosition(""); setCounty(""); setSearch(""); setPage(1); };
  const hasFilters   = position || county || search.trim();

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("2027 Elections", "Uchaguzi 2027")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("ASPIRANT DIRECTORY", "ORODHA YA WAGOMBEA")}
          </h1>
          <p className="text-gray-400 mt-3 max-w-lg">
            {t(
              "Meet the candidates who have declared interest in running for elective office under the Linda Mwananchi movement.",
              "Kutana na wagombea waliotangaza nia yao ya kugombea chini ya harakati ya Linda Mwananchi."
            )}
          </p>
          {total > 0 && (
            <div className="mt-5 inline-flex items-center gap-2 bg-primary/10 border border-primary/30 px-4 py-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold text-primary">
                {total.toLocaleString()} {t("approved aspirants", "wagombea walioidhinishwa")}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Filters */}
      <section className="border-b border-border bg-muted/30 px-4 py-4 sticky top-16 z-30 backdrop-blur">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          {/* Name search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search by name...", "Tafuta kwa jina...")}
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Position filter */}
          <select
            value={position}
            onChange={(e) => { setPosition(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary h-9"
          >
            <option value="">{t("All Positions", "Vyote")}</option>
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {lang === "sw" ? p.labelSw : p.labelEn}
              </option>
            ))}
          </select>

          {/* County filter */}
          <select
            value={county}
            onChange={(e) => { setCounty(e.target.value); setPage(1); }}
            className="border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary h-9"
          >
            <option value="">{t("All Counties", "Kaunti Zote")}</option>
            {KENYA_COUNTIES.map((c) => (
              <option key={c.code} value={c.name}>{c.name}</option>
            ))}
          </select>

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors h-9 px-2"
            >
              <X className="h-3 w-3" />
              {t("Clear", "Futa")}
            </button>
          )}
        </div>
      </section>

      {/* Grid */}
      <section className="py-10 px-4">
        <div className="max-w-5xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : aspirants.length === 0 ? (
            <div className="py-20 text-center">
              <Vote className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="font-bold text-lg text-foreground mb-2">
                {t("No aspirants found", "Hakuna wagombea walioonekana")}
              </p>
              <p className="text-muted-foreground text-sm">
                {hasFilters
                  ? t("Try adjusting your filters.", "Jaribu kubadilisha vichujio vyako.")
                  : t("No approved aspirants yet. Check back soon.", "Bado hakuna wagombea walioidhinishwa. Angalia tena hivi karibuni.")}
              </p>
              {hasFilters && (
                <button onClick={clearFilters} className="mt-4 text-sm font-bold text-primary underline">
                  {t("Clear filters", "Futa vichujio")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {aspirants.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className="border border-border p-5 text-left hover:border-primary hover:shadow-md transition-all group bg-white"
                  >
                    {/* Position badge */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <Badge variant="outline" className="font-mono text-xs shrink-0">
                        {positionLabel(a.position, lang)}
                      </Badge>
                      {a.isIndependent ? (
                        <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5">
                          {t("Independent", "Huru")}
                        </span>
                      ) : a.partyAffiliation ? (
                        <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 truncate max-w-[120px]" title={a.partyAffiliation}>
                          {a.partyAffiliation}
                        </span>
                      ) : null}
                    </div>

                    {/* Name */}
                    <h3 className="font-black text-base uppercase tracking-tight text-foreground group-hover:text-primary transition-colors mb-2 line-clamp-2">
                      {a.fullName}
                    </h3>

                    {/* Location */}
                    {(a.countyName || a.constituency || a.ward) && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="line-clamp-1">
                          {[a.ward, a.constituency, a.countyName].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    )}

                    {/* Statement preview */}
                    {a.statementOfIntent && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {a.statementOfIntent}
                      </p>
                    )}

                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-primary uppercase tracking-wider group-hover:gap-2 transition-all">
                      {t("View Profile", "Angalia Wasifu")}
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {t("Showing", "Inaonyesha")} {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} {t("of", "ya")} {total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="font-bold">{page} / {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1.5 hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
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
        <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
          {t(
            "Join the list. Declare your candidacy interest for a 2027 elective seat under the Linda Mwananchi movement.",
            "Jiunge na orodha. Tangaza nia yako ya kugombea kiti cha 2027 chini ya harakati ya Linda Mwananchi."
          )}
        </p>
        <a
          href="/aspirant-register"
          className="inline-flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-8 py-3 font-black tracking-widest uppercase transition-colors"
        >
          {t("Register Now", "Jisajili Sasa")}
          <ChevronRight className="h-4 w-4" />
        </a>
      </section>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {t("Aspirant Profile", "Wasifu wa Mgombea")}
                  </span>
                  <span className="text-xl font-black uppercase tracking-tight">{selected.fullName}</span>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="outline" className="font-mono text-xs">
                      {positionLabel(selected.position, lang)}
                    </Badge>
                    {selected.isIndependent ? (
                      <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5">
                        {t("Independent", "Mgombea Huru")}
                      </span>
                    ) : selected.partyAffiliation ? (
                      <span className="text-xs font-bold bg-muted text-muted-foreground px-2 py-0.5">
                        {selected.partyAffiliation}
                      </span>
                    ) : null}
                  </div>
                </SheetTitle>
              </SheetHeader>

              {/* Location details */}
              {(selected.countyName || selected.constituency || selected.ward) && (
                <div className="mb-5">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
                    {t("Location", "Eneo")}
                  </p>
                  <dl className="space-y-1 text-sm">
                    {selected.countyName && (
                      <div className="flex gap-2">
                        <dt className="font-bold text-muted-foreground w-28 shrink-0">{t("County", "Kaunti")}</dt>
                        <dd>{selected.countyName}</dd>
                      </div>
                    )}
                    {selected.constituency && (
                      <div className="flex gap-2">
                        <dt className="font-bold text-muted-foreground w-28 shrink-0">{t("Constituency", "Bunge")}</dt>
                        <dd>{selected.constituency}</dd>
                      </div>
                    )}
                    {selected.ward && (
                      <div className="flex gap-2">
                        <dt className="font-bold text-muted-foreground w-28 shrink-0">{t("Ward", "Kata")}</dt>
                        <dd>{selected.ward}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Statement of intent */}
              {selected.statementOfIntent && (
                <div className="mb-6">
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
                    {t("Statement of Intent", "Taarifa ya Nia")}
                  </p>
                  <blockquote className="border-l-2 border-primary pl-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {selected.statementOfIntent}
                  </blockquote>
                </div>
              )}

              {/* CTA */}
              <div className="border-t border-border pt-5">
                <a
                  href="/aspirant-register"
                  className="block text-center bg-primary text-white hover:bg-primary/90 py-3 font-black text-sm tracking-widest uppercase transition-colors"
                >
                  {t("Declare Your Own Interest", "Tangaza Nia Yako")}
                </a>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PublicPortalLayout>
  );
}
