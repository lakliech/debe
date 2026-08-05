/**
 * Campaign scope fields — seat selector + cascading geography pickers.
 * Shared by the registration wizard and the Settings scope card.
 *
 * Mirrors the API rules (api-server/src/lib/campaignScope.ts):
 *   presidential → national (no pickers)
 *   gubernatorial / senator / women_rep → county
 *   mp → county (filter) → constituency
 *   mca → county (filter) → constituency (filter) → ward
 * Only the seat's own level is submitted as scope; parents are filters.
 */
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export interface ScopeSelection {
  seatType: string;
  countyId: string;
  constituencyId: string;
  wardId: string;
}

export const SEAT_OPTIONS = [
  { value: "presidential", label: "President", level: "National" },
  { value: "gubernatorial", label: "Governor", level: "County" },
  { value: "senator", label: "Senator", level: "County" },
  { value: "women_rep", label: "Woman Representative", level: "County" },
  { value: "mp", label: "Member of Parliament", level: "Constituency" },
  { value: "mca", label: "Member of County Assembly", level: "Ward" },
] as const;

/** Branding display label per seat (matches legacy electionLevel strings). */
export const SEAT_TO_LEVEL: Record<string, string> = {
  presidential: "Presidential",
  gubernatorial: "Governor",
  senator: "Senator",
  women_rep: "Woman Representative",
  mp: "Member of Parliament",
  mca: "Member of County Assembly",
};

const COUNTY_SEATS = ["gubernatorial", "senator", "women_rep"];

interface GeoOption {
  id: string;
  name: string;
}

/** True when the selection satisfies the seat's geography rule. */
export function scopeComplete(sel: ScopeSelection): boolean {
  if (!sel.seatType) return false;
  if (sel.seatType === "presidential") return true;
  if (COUNTY_SEATS.includes(sel.seatType)) return Boolean(sel.countyId);
  if (sel.seatType === "mp") return Boolean(sel.constituencyId);
  if (sel.seatType === "mca") return Boolean(sel.wardId);
  return false;
}

export function CampaignScopeFields({
  value,
  onChange,
}: {
  value: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
}) {
  const showCounty = value.seatType !== "" && value.seatType !== "presidential";
  const showConstituency = (value.seatType === "mp" || value.seatType === "mca") && Boolean(value.countyId);
  const showWard = value.seatType === "mca" && Boolean(value.constituencyId);

  // ?all=1 — scope SELECTION must offer the full map, bypassing the
  // tenant-scope filter the API applies to operational geography queries.
  const { data: counties } = useQuery<GeoOption[]>({
    queryKey: ["/api/geography/counties", "all"],
    queryFn: () => apiFetch("/api/geography/counties?all=1"),
    enabled: showCounty,
  });
  const { data: constituencies } = useQuery<GeoOption[]>({
    queryKey: ["/api/geography/constituencies", value.countyId, "all"],
    queryFn: () => apiFetch(`/api/geography/constituencies?countyId=${value.countyId}&all=1`),
    enabled: showConstituency,
  });
  const { data: wards } = useQuery<GeoOption[]>({
    queryKey: ["/api/geography/wards", value.constituencyId, "all"],
    queryFn: () => apiFetch(`/api/geography/wards?constituencyId=${value.constituencyId}&all=1`),
    enabled: showWard,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="scope-seat" className="font-bold">Seat Contested</Label>
        <Select
          value={value.seatType}
          onValueChange={(seatType) => onChange({ seatType, countyId: "", constituencyId: "", wardId: "" })}
        >
          <SelectTrigger id="scope-seat" data-testid="select-seat-type">
            <SelectValue placeholder="Select the seat" />
          </SelectTrigger>
          <SelectContent>
            {SEAT_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label} — {s.level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.seatType === "presidential" && (
        <p className="text-sm text-muted-foreground italic">National — covers all 47 counties.</p>
      )}

      {showCounty && (
        <div className="space-y-2">
          <Label htmlFor="scope-county" className="font-bold">
            County{COUNTY_SEATS.includes(value.seatType) ? "" : " (filter)"}
          </Label>
          <Select
            value={value.countyId}
            onValueChange={(countyId) => onChange({ ...value, countyId, constituencyId: "", wardId: "" })}
          >
            <SelectTrigger id="scope-county" data-testid="select-scope-county">
              <SelectValue placeholder="Select county" />
            </SelectTrigger>
            <SelectContent>
              {(counties ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showConstituency && (
        <div className="space-y-2">
          <Label htmlFor="scope-constituency" className="font-bold">
            Constituency{value.seatType === "mca" ? " (filter)" : ""}
          </Label>
          <Select
            value={value.constituencyId}
            onValueChange={(constituencyId) => onChange({ ...value, constituencyId, wardId: "" })}
          >
            <SelectTrigger id="scope-constituency" data-testid="select-scope-constituency">
              <SelectValue placeholder="Select constituency" />
            </SelectTrigger>
            <SelectContent>
              {(constituencies ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showWard && (
        <div className="space-y-2">
          <Label htmlFor="scope-ward" className="font-bold">Ward</Label>
          <Select
            value={value.wardId}
            onValueChange={(wardId) => onChange({ ...value, wardId })}
          >
            <SelectTrigger id="scope-ward" data-testid="select-scope-ward">
              <SelectValue placeholder="Select ward" />
            </SelectTrigger>
            <SelectContent>
              {(wards ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
