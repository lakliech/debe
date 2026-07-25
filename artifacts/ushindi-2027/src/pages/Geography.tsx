import { useState } from "react";
import { useListCounties, useListConstituencies, useListWards, useGetGeographyStats, getListConstituenciesQueryKey, getListWardsQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Search, Map, MapPin, Building, Activity, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default function Geography() {
  const { data: stats } = useGetGeographyStats();
  const { data: counties, isLoading: countiesLoading } = useListCounties();
  
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [selectedConstituency, setSelectedConstituency] = useState<string | null>(null);
  
  const { data: constituencies, isLoading: constLoading } = useListConstituencies(
    { countyId: selectedCounty || "" },
    { query: { enabled: !!selectedCounty, queryKey: getListConstituenciesQueryKey({ countyId: selectedCounty || "" }) } }
  );
  
  const { data: wards, isLoading: wardsLoading } = useListWards(
    { constituencyId: selectedConstituency || "" },
    { query: { enabled: !!selectedConstituency, queryKey: getListWardsQueryKey({ constituencyId: selectedConstituency || "" }) } }
  );

  const [search, setSearch] = useState("");

  const filteredCounties = counties?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.code.toString().includes(search)
  ) || [];

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">National Geography</h1>
        <p className="text-muted-foreground mt-1">Browse administrative boundaries and registered voters.</p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Counties</p>
          <p className="text-2xl font-mono font-black mt-1">{stats?.countyCount || 47}</p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Constituencies</p>
          <p className="text-2xl font-mono font-black mt-1">{stats?.constituencyCount || 290}</p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Wards</p>
          <p className="text-2xl font-mono font-black mt-1">{stats?.wardCount || 1450}</p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md">
          <p className="text-xs font-bold text-muted-foreground uppercase">Centres</p>
          <p className="text-2xl font-mono font-black mt-1">{stats?.pollingCentreCount || 27329}</p>
        </div>
        <div className="bg-card border border-border p-4 rounded-md lg:col-span-2 bg-primary/5 border-primary/20">
          <p className="text-xs font-bold text-primary uppercase">Total Registered Voters</p>
          <p className="text-2xl font-mono font-black mt-1 text-primary">{(stats?.totalRegisteredVoters || 22120458).toLocaleString()}</p>
        </div>
      </div>

      {/* Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* Counties Column */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-bold flex items-center gap-2 mb-3"><Map className="w-4 h-4 text-primary" /> Counties</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <Input 
                placeholder="Search counties..." 
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {countiesLoading ? (
              <div className="p-4 space-y-2">
                {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredCounties.map(county => (
                  <button
                    key={county.id}
                    onClick={() => {
                      setSelectedCounty(county.id);
                      setSelectedConstituency(null);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-sm text-sm font-medium transition-colors flex items-center justify-between group ${
                      selectedCounty === county.id 
                        ? 'bg-primary text-primary-foreground' 
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div>
                      <span className="opacity-70 mr-2 font-mono text-xs">{county.code.toString().padStart(3, '0')}</span>
                      {county.name}
                    </div>
                    <ChevronRight className={`w-4 h-4 ${selectedCounty === county.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Constituencies Column */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30 h-[105px]">
            <h3 className="font-bold flex items-center gap-2"><MapPin className="w-4 h-4 text-accent" /> Constituencies</h3>
            {!selectedCounty && <p className="text-sm text-muted-foreground mt-2">Select a county first.</p>}
          </div>
          <ScrollArea className="flex-1 bg-muted/10">
            {!selectedCounty ? (
              <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center text-sm">
                Awaiting county selection
              </div>
            ) : constLoading ? (
              <div className="p-4 space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {constituencies?.map(con => (
                  <button
                    key={con.id}
                    onClick={() => setSelectedConstituency(con.id)}
                    className={`w-full text-left px-4 py-3 rounded-sm text-sm font-medium transition-colors flex items-center justify-between group border border-transparent ${
                      selectedConstituency === con.id 
                        ? 'bg-accent text-accent-foreground border-accent' 
                        : 'bg-card hover:border-border shadow-sm'
                    }`}
                  >
                    <div>
                      <span className="opacity-70 mr-2 font-mono text-xs">{con.code}</span>
                      {con.name}
                    </div>
                    <Badge variant={selectedConstituency === con.id ? "secondary" : "outline"}>
                      {con.wardCount} wards
                    </Badge>
                  </button>
                ))}
                {constituencies?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">No constituencies found.</div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Wards Column */}
        <div className="bg-card border border-border rounded-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/30 h-[105px]">
            <h3 className="font-bold flex items-center gap-2"><Building className="w-4 h-4 text-secondary" /> Wards</h3>
            {!selectedConstituency && <p className="text-sm text-muted-foreground mt-2">Select a constituency first.</p>}
          </div>
          <ScrollArea className="flex-1 bg-muted/20">
            {!selectedConstituency ? (
              <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center text-sm">
                Awaiting constituency selection
              </div>
            ) : wardsLoading ? (
              <div className="p-4 space-y-2">
                {[1,2,3,4].map(i => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {wards?.map(ward => (
                  <div
                    key={ward.id}
                    className="w-full text-left px-4 py-3 rounded-sm text-sm bg-card border border-border shadow-sm flex items-center justify-between"
                  >
                    <div className="font-medium">
                      <span className="text-muted-foreground mr-2 font-mono text-xs">{ward.code}</span>
                      {ward.name}
                    </div>
                    {ward.registeredVoters && (
                      <span className="text-xs font-mono font-bold text-muted-foreground">
                        {ward.registeredVoters.toLocaleString()} voters
                      </span>
                    )}
                  </div>
                ))}
                {wards?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">No wards found.</div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
