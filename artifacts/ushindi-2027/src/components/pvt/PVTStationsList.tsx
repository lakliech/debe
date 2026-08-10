/**
 * PVTStationsList — review the stations drawn into the latest PVT sample,
 * with per-station reporting status and a link into the quick report form.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ClipboardList, MapPin } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  quick_reported: "default",
  full_reported: "default",
  missing: "destructive",
};

export default function PVTStationsList() {
  const [, navigate] = useLocation();

  const { data: samples } = useQuery({
    queryKey: ["pvt-samples"],
    queryFn: () => fetch(`${BASE}/api/pvt/samples`, { credentials: "include" }).then((r) => r.json()),
  });
  const design = (samples as any[] | undefined)?.find((s) => s.status === "active")
    ?? (samples as any[] | undefined)?.[0];

  const { data: stations } = useQuery({
    queryKey: ["pvt-stations", design?.id],
    queryFn: () => fetch(`${BASE}/api/pvt/samples/${design!.id}/stations`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!design?.id,
  });

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-black tracking-tight uppercase flex items-center gap-2">
          <MapPin className="h-6 w-6 text-[#1D9BF0]" /> Sampled Stations
        </h1>
        {design && <Badge variant="outline">{design.stratumLevel} · target {design.targetSampleSize}</Badge>}
      </div>

      {!design ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No PVT sample yet — create one from Sample Setup.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {((stations as any[]) ?? []).map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <Badge variant={STATUS_VARIANT[s.reportStatus] ?? "secondary"} className="w-28 justify-center">
                  {s.reportStatus.replace("_", " ")}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{s.stratumName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.registeredVoters.toLocaleString()} voters · weight {s.designWeight.toFixed(1)}
                  </p>
                </div>
                {s.reportStatus === "pending" && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/pvt/report/${s.id}`)}>
                    <ClipboardList className="h-4 w-4 mr-1" /> Report
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {((stations as any[]) ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No stations in this sample.</p>
          )}
        </div>
      )}
    </div>
  );
}
