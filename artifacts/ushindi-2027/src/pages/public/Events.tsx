import { useState } from "react";
import { Calendar, MapPin, Users } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { useListPublicEvents } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { KENYA_COUNTIES } from "./CountyPriorities";
import { cn } from "@/lib/utils";

const EVENT_TYPE_COLORS: Record<string, string> = {
  rally: "bg-primary text-white",
  townhall: "bg-blue-100 text-blue-800",
  debate: "bg-purple-100 text-purple-800",
  workshop: "bg-green-100 text-green-800",
  default: "bg-gray-100 text-gray-700",
};

function getTypeColor(type?: string | null): string {
  if (!type) return EVENT_TYPE_COLORS.default;
  return EVENT_TYPE_COLORS[type.toLowerCase()] ?? EVENT_TYPE_COLORS.default;
}

export default function Events() {
  const { t } = useLanguage();
  const [countyId, setCountyId] = useState<string>("");

  const { data: events, isLoading, isError, refetch } = useListPublicEvents(
    countyId ? { countyId } : undefined
  );

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("On the Ground", "Ardhini")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("UPCOMING EVENTS", "MATUKIO YANAYOKUJA")}
          </h1>
          <p className="text-gray-400 mt-4 max-w-xl">
            {t("Join us at a rally, town hall, or community meeting near you.", "Jiunge nasi katika mkutano wa hadhara, mjadala wa jamii, au mkutano wa karibu nawe.")}
          </p>
        </div>
      </section>

      <section className="py-10 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          {/* Filter */}
          <div className="mb-8 flex items-center gap-4">
            <label className="text-sm font-bold text-foreground">{t("Filter by County:", "Chuja kwa Kaunti:")}</label>
            <select
              value={countyId}
              onChange={(e) => setCountyId(e.target.value)}
              className="border border-border px-3 py-2 text-sm font-medium bg-white focus:outline-none focus:border-primary min-w-[180px]"
            >
              <option value="">{t("All Counties", "Kaunti Zote")}</option>
              {KENYA_COUNTIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="border border-border p-6 shadow-sm space-y-3">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">{t("Could not load events.", "Haiwezekani kupakia matukio.")}</p>
              <button onClick={() => refetch()} className="bg-primary text-white px-6 py-2 font-bold text-sm hover:bg-primary/90">
                {t("Retry", "Jaribu tena")}
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && (!events || events.length === 0) && (
            <div className="text-center py-20">
              <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-black text-xl uppercase mb-2">{t("No Events Scheduled", "Hakuna Matukio Yaliyopangwa")}</h3>
              <p className="text-muted-foreground">
                {t("Check back soon for upcoming campaign events in your area.", "Angalia tena hivi karibuni kwa matukio ya kampeni yanayokuja katika eneo lako.")}
              </p>
            </div>
          )}

          {/* Events grid */}
          {!isLoading && events && events.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event) => {
                // eventDate is stored as "YYYY-MM-DD" text; parseISO handles it safely.
                const parsedDate = event.eventDate
                  ? parseISO(event.eventDate as string)
                  : null;
                const dateOk = parsedDate !== null && isValid(parsedDate);
                return (
                  <div key={event.id} className="border border-border shadow-sm hover:shadow-md transition-shadow flex flex-col">
                    {/* Date badge */}
                    <div className="bg-black text-white px-6 py-4 flex items-center gap-4">
                      {dateOk && parsedDate ? (
                        <div className="text-center">
                          <div className="text-4xl font-black leading-none text-primary">
                            {format(parsedDate, "d")}
                          </div>
                          <div className="text-xs font-bold tracking-widest uppercase text-gray-400">
                            {format(parsedDate, "MMM yyyy")}
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-sm font-medium">{t("Date TBC", "Tarehe Bado")}</div>
                      )}
                      <div className="flex-1">
                        {event.eventType && (
                          <span className={cn("text-xs font-bold px-2 py-0.5 uppercase tracking-wider", getTypeColor(event.eventType))}>
                            {(event.eventType as string).replace(/_/g, " ")}
                          </span>
                        )}
                        {event.startTime && (
                          <p className="text-xs text-gray-400 mt-1">
                            {event.startTime as string}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col gap-2">
                      <h3 className="font-black text-sm uppercase tracking-tight leading-tight">
                        {event.title ?? t("Campaign Event", "Tukio la Kampeni")}
                      </h3>
                      {event.venue && (
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span>{event.venue}</span>
                        </div>
                      )}
                      {event.expectedAttendance != null && (
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          <span>{t("Expected:", "Inatarajiwa:")} {event.expectedAttendance.toLocaleString()}</span>
                        </div>
                      )}
                      {event.description && (
                        <p className="text-muted-foreground text-xs leading-relaxed line-clamp-2 mt-1">
                          {event.description}
                        </p>
                      )}
                    </div>
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
