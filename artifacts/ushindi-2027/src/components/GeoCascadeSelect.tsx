import { useEffect, useMemo, useState } from "react";
import {
  useListCounties,
  useListConstituencies,
  useListWards,
  useListPollingStations,
  getListConstituenciesQueryKey,
  getListWardsQueryKey,
  getListPollingStationsQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export type GeoLevel = "county" | "constituency" | "ward" | "station";

const ORDER: readonly GeoLevel[] = ["county", "constituency", "ward", "station"];

const SELECT_CLS =
  "border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:border-primary font-medium w-full";

interface Option {
  id: string;
  label: string;
}

function toOptions(rows: any[] | undefined, withCode = false): Option[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    label: withCode && r.code ? `${r.name} (${r.code})` : (r.name ?? r.code ?? r.id),
  }));
}

/**
 * Cascading geography dropdowns — county → constituency → ward → polling
 * station — replacing any free-text "enter an ID" input. All lists are
 * already clamped to the campaign's geographic scope by the server, so a
 * county-scoped campaign sees exactly one county (auto-selected).
 *
 * `onChange` fires with the selected id at `level` (or "" when cleared).
 * `optional` adds a "None" choice and disables single-option auto-pick.
 */
export function GeoCascadeSelect({
  level,
  value,
  onChange,
  optional = false,
  className,
}: {
  level: GeoLevel;
  value: string;
  onChange: (id: string) => void;
  optional?: boolean;
  className?: string;
}) {
  const depth = ORDER.indexOf(level);
  const [countyId, setCountyId] = useState("");
  const [constituencyId, setConstituencyId] = useState("");
  const [wardId, setWardId] = useState("");

  // When the parent clears the value (form reset, scope switch), clear the cascade.
  useEffect(() => {
    if (!value) {
      setCountyId("");
      setConstituencyId("");
      setWardId("");
    }
  }, [value]);

  // Counties always load (unparameterised, scope-clamped server-side).
  const countiesQ = useListCounties();
  const counties = useMemo(() => toOptions(countiesQ.data as any[] | undefined, true), [countiesQ.data]);

  // Auto-pick when the campaign scope leaves exactly one option (non-optional only).
  useEffect(() => {
    if (!optional && !countyId && counties.length === 1) {
      setCountyId(counties[0].id);
      if (level === "county") onChange(counties[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counties, countyId, optional, level]);

  const consParams = depth >= 1 && countyId ? { countyId } : undefined;
  const consQ = useListConstituencies(consParams, {
    query: { queryKey: getListConstituenciesQueryKey(consParams), enabled: !!consParams },
  });
  const constituencies = useMemo(
    () => (consParams ? toOptions(consQ.data as any[] | undefined) : []),
    [consQ.data, consParams],
  );
  useEffect(() => {
    if (!optional && !constituencyId && constituencies.length === 1) {
      setConstituencyId(constituencies[0].id);
      if (level === "constituency") onChange(constituencies[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constituencies, constituencyId, optional, level]);

  // Strict cascade: wards only load after a constituency is chosen — querying
  // wards by county can return hundreds of rows and breaks the flow.
  const wardParams = depth >= 2 && constituencyId ? { constituencyId } : undefined;
  const wardQ = useListWards(wardParams, {
    query: { queryKey: getListWardsQueryKey(wardParams), enabled: !!wardParams },
  });
  const wards = useMemo(
    () => (wardParams ? toOptions(wardQ.data as any[] | undefined) : []),
    [wardQ.data, wardParams],
  );
  useEffect(() => {
    if (!optional && !wardId && wards.length === 1) {
      setWardId(wards[0].id);
      if (level === "ward") onChange(wards[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wards, wardId, optional, level]);

  // Stations are only listed once a ward is chosen — a constituency can hold
  // hundreds of stations, which would make an unusable dropdown.
  const stationParams = depth >= 3 && wardId ? { wardId } : undefined;
  const stationQ = useListPollingStations(stationParams, {
    query: { queryKey: getListPollingStationsQueryKey(stationParams), enabled: !!stationParams },
  });
  const stations = useMemo(
    () => (stationParams ? toOptions(stationQ.data as any[] | undefined, true) : []),
    [stationQ.data, stationParams],
  );

  const pick = (lvl: GeoLevel, id: string) => {
    if (lvl === "county") {
      setCountyId(id);
      setConstituencyId("");
      setWardId("");
    } else if (lvl === "constituency") {
      setConstituencyId(id);
      setWardId("");
    } else if (lvl === "ward") {
      setWardId(id);
    }
    // Any selection at or above the target level settles the value; a parent
    // change clears a previously chosen deeper value.
    onChange(ORDER.indexOf(lvl) === depth ? id : "");
  };

  const renderSelect = (
    lvl: GeoLevel,
    options: Option[],
    selected: string,
    isLoading: boolean,
    disabled: boolean,
  ) => {
    const isFinal = ORDER.indexOf(lvl) === depth;
    const placeholder =
      disabled && lvl === "ward" && !constituencyId
        ? "Select a constituency first…"
        : disabled && lvl === "station" && !wardId
          ? "Select a ward first…"
          : isLoading
            ? "Loading…"
            : `Select ${lvl === "station" ? "polling station" : lvl}…`;
    return (
      <select
        key={lvl}
        value={selected}
        disabled={disabled || isLoading}
        onChange={(e) => pick(lvl, e.target.value)}
        className={cn(SELECT_CLS, (disabled || isLoading) && "opacity-60")}
      >
        <option value="">{optional && isFinal ? "— None —" : placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {renderSelect("county", counties, countyId, countiesQ.isLoading, false)}
      {depth >= 1 &&
        renderSelect("constituency", constituencies, constituencyId, !!consParams && consQ.isLoading, !countyId)}
      {depth >= 2 &&
        renderSelect("ward", wards, wardId, !!wardParams && wardQ.isLoading, !constituencyId)}
      {depth >= 3 &&
        renderSelect("station", stations, value, !!stationParams && stationQ.isLoading, !wardId)}
    </div>
  );
}
