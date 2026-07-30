import { useState } from "react";
import {
  useListCounties,
  useListConstituencies,
  useListWards,
  useListPollingStations,
  useGetGeographyStats,
  getListConstituenciesQueryKey,
  getListWardsQueryKey,
  getListPollingStationsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Search, Map, MapPin, Building, Vote, ChevronRight, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default function Geography() {
  const { data: stats } = useGetGeographyStats();
  const { data: counties, isLoading: countiesLoading } = useListCounties();

  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [selectedConstituency, setSelectedConstituency] = useState<string | null>(null);
  const [selectedWard, setSelectedWard] = useState<string | null>(null);

  const { data: constituencies, isLoading: constLoading } = useListConstituencies(
    { countyId: selectedCounty || "" },
    {
      query: {
        enabled: !!selectedCounty,
        queryKey: getListConstituenciesQueryKey({ countyId: selectedCounty || "" }),
      },
    },
  );

  const { data: wards, isLoading: wardsLoading } = useListWards(
    { constituencyId: selectedConstituency || "" },
    {
      query: {
        enabled: !!selectedConstituency,
        queryKey: getListWardsQueryKey({ constituencyId: selectedConstituency || "" }),
      },
    },
  );

  const { data: stations, isLoading: stationsLoading } = useListPollingStations(
    { wardId: selectedWard || "" },
    {
      query: {
        enabled: !!selectedWard,
        queryKey: getListPollingStationsQueryKey({ wardId: selectedWard || "" }),
      },
    },
  );

  const [search, setSearch] = useState("");

  const filteredCounties =
    counties?.filter(
      (c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toString().includes(search),
    ) ?? [];

  // Derived names for breadcrumb header labels
  const selectedCountyName = counties?.find((c) => c.id === selectedCounty)?.name ?? null;
  const selectedConstName = constituencies?.find((c) => c.id === selectedConstituency)?.name ?? null;
  const selectedWardName = wards?.find((w) => w.id === selectedWard)?.name ?? null;

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          National Geography
        </h1>
        <p className="text-muted-foreground mt-1">
          Browse administrative boundaries and polling stations.
        </p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Counties</p>
          <p className="text-2xl font-mono font-black mt-1">
            {stats?.countyCount ?? "—"}
          </p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Constituencies</p>
          <p className="text-2xl font-mono font-black mt-1">
            {stats?.constituencyCount ?? "—"}
          </p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Wards</p>
          <p className="text-2xl font-mono font-black mt-1">
            {stats?.wardCount ?? "—"}
          </p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Centres</p>
          <p className="text-2xl font-mono font-black mt-1">
            {stats?.pollingCentreCount ?? "—"}
          </p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Stations</p>
          <p className="text-2xl font-mono font-black mt-1">
            {stats?.pollingStationCount ?? "—"}
          </p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md bg-primary/5 border-primary/20">
          <p className="text-xs font-bold text-primary uppercase">Registered Voters</p>
          <p className="text-2xl font-mono font-black mt-1 text-primary">
            {stats?.totalRegisteredVoters != null
              ? stats.totalRegisteredVoters.toLocaleString()
              : "—"}
          </p>
        </div>
      </div>

      {/* Four-column drill-down explorer */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 min-h-0">

        {/* ── Column 1: Counties ─────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-bold flex items-center gap-2 mb-3">
              <Map className="w-4 h-4 text-primary" /> Counties
            </h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                placeholder="Search counties…"
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {countiesLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredCounties.map((county) => (
                  <button
                    key={county.id}
                    onClick={() => {
                      setSelectedCounty(county.id);
                      setSelectedConstituency(null);
                      setSelectedWard(null);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-sm text-sm font-medium transition-colors flex items-center justify-between group ${
                      selectedCounty === county.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div>
                      <span className="opacity-70 mr-2 font-mono text-xs">
                        {county.code.toString().padStart(3, "0")}
                      </span>
                      {county.name}
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 ${
                        selectedCounty === county.id
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-50"
                      }`}
                    />
                  </button>
                ))}
                {filteredCounties.length === 0 && !countiesLoading && (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No counties match "{search}"
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ── Column 2: Constituencies ────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30 min-h-[73px]">
            <h3 className="font-bold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-accent" /> Constituencies
            </h3>
            {selectedCountyName && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {selectedCountyName}
              </p>
            )}
            {!selectedCounty && (
              <p className="text-sm text-muted-foreground mt-1">Select a county first.</p>
            )}
          </div>
          <ScrollArea className="flex-1 bg-muted/10">
            {!selectedCounty ? (
              <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center text-sm">
                Awaiting county selection
              </div>
            ) : constLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {constituencies?.map((con) => (
                  <button
                    key={con.id}
                    onClick={() => {
                      setSelectedConstituency(con.id);
                      setSelectedWard(null);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-sm text-sm font-medium transition-colors flex items-center justify-between group border border-transparent ${
                      selectedConstituency === con.id
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-card hover:border-border shadow-sm"
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="opacity-70 mr-2 font-mono text-xs">{con.code}</span>
                      <span className="truncate">{con.name}</span>
                    </div>
                    <Badge
                      variant={selectedConstituency === con.id ? "secondary" : "outline"}
                      className="ml-2 flex-shrink-0"
                    >
                      {con.wardCount}w
                    </Badge>
                  </button>
                ))}
                {constituencies?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No constituencies found.
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ── Column 3: Wards ─────────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30 min-h-[73px]">
            <h3 className="font-bold flex items-center gap-2">
              <Building className="w-4 h-4 text-secondary" /> Wards
            </h3>
            {selectedConstName && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {selectedConstName}
              </p>
            )}
            {!selectedConstituency && (
              <p className="text-sm text-muted-foreground mt-1">
                Select a constituency first.
              </p>
            )}
          </div>
          <ScrollArea className="flex-1 bg-muted/20">
            {!selectedConstituency ? (
              <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center text-sm">
                Awaiting constituency selection
              </div>
            ) : wardsLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {wards?.map((ward) => (
                  <button
                    key={ward.id}
                    onClick={() => setSelectedWard(ward.id)}
                    className={`w-full text-left px-4 py-3 rounded-sm text-sm transition-colors flex items-center justify-between group border border-transparent ${
                      selectedWard === ward.id
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-card hover:border-border shadow-sm"
                    }`}
                  >
                    <div className="min-w-0">
                      <span
                        className={`mr-2 font-mono text-xs ${
                          selectedWard === ward.id
                            ? "opacity-80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {ward.code}
                      </span>
                      <span className="font-medium truncate">{ward.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {ward.registeredVoters != null && (
                        <span
                          className={`text-xs font-mono ${
                            selectedWard === ward.id
                              ? "opacity-80"
                              : "text-muted-foreground"
                          }`}
                        >
                          {ward.registeredVoters.toLocaleString()}
                        </span>
                      )}
                      <ChevronRight
                        className={`w-3.5 h-3.5 ${
                          selectedWard === ward.id
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-50"
                        }`}
                      />
                    </div>
                  </button>
                ))}
                {wards?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No wards found.
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ── Column 4: Polling Stations ──────────────────────────────────── */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30 min-h-[73px]">
            <h3 className="font-bold flex items-center gap-2">
              <Vote className="w-4 h-4 text-emerald-600" /> Polling Stations
            </h3>
            {selectedWardName ? (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {selectedWardName}
                {stations && (
                  <span className="ml-1.5 font-semibold text-foreground">
                    · {stations.length} station{stations.length !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">Select a ward first.</p>
            )}
          </div>
          <ScrollArea className="flex-1 bg-muted/10">
            {!selectedWard ? (
              <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center text-sm">
                Awaiting ward selection
              </div>
            ) : stationsLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {stations?.map((station) => (
                  <div
                    key={station.id}
                    className="px-4 py-3 rounded-sm text-sm bg-card border border-border shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-muted-foreground mr-2 font-mono text-xs">
                          {station.code}
                        </span>
                        <span className="font-medium">{station.name}</span>
                        {station.centreName && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {station.centreName}
                          </p>
                        )}
                      </div>
                      {station.registeredVoters != null && (
                        <div className="flex items-center gap-1 flex-shrink-0 text-muted-foreground">
                          <Users className="w-3 h-3" />
                          <span className="text-xs font-mono">
                            {station.registeredVoters.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {stations?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No polling stations found for this ward.
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
