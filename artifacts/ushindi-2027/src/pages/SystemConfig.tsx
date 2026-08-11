import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSystemConfig,
  useUpdateSystemConfig,
  getGetSystemConfigQueryKey,
} from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Save, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SystemConfig({ embedded = false }: { embedded?: boolean }) {
  const { data: config, isLoading } = useGetSystemConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [threshold, setThreshold] = useState<string>("");

  // Sync local input once the config loads
  useEffect(() => {
    if (config?.minCoverageThresholdPct != null) {
      setThreshold(String(config.minCoverageThresholdPct));
    }
  }, [config?.minCoverageThresholdPct]);

  const updateConfig = useUpdateSystemConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSystemConfigQueryKey() });
        toast({ title: "Configuration saved", description: "Minimum coverage threshold updated." });
      },
      onError: (err: any) => {
        toast({
          title: "Save failed",
          description: err?.error ?? "Could not save configuration. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const parsedThreshold = Number(threshold);
  const thresholdValid = Number.isInteger(parsedThreshold) && parsedThreshold >= 0 && parsedThreshold <= 100;
  const thresholdDirty = config?.minCoverageThresholdPct != null && thresholdValid
    ? parsedThreshold !== config.minCoverageThresholdPct
    : thresholdValid;

  function handleSave() {
    if (!thresholdValid) return;
    updateConfig.mutate({ data: { minCoverageThresholdPct: parsedThreshold } });
  }

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      {!embedded && (
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">System Configuration</h1>
          <p className="text-muted-foreground mt-1">Global settings affecting all users.</p>
        </div>
      )}

      <div className="grid gap-6">
        <Card className="border-accent border-2">
          <CardHeader className="pb-3 bg-accent/5">
            <CardTitle className="text-accent flex items-center gap-2">
              <AlertCircle className="w-5 h-5" /> Danger Zone
            </CardTitle>
            <CardDescription>Critical operations that immediately affect system availability.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Maintenance Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Lock out all non-administrator users.
                </p>
              </div>
              <Switch checked={config?.maintenanceMode} />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Open Registration</Label>
                <p className="text-sm text-muted-foreground">
                  Allow public sign-ups for volunteer roles.
                </p>
              </div>
              <Switch checked={config?.registrationOpen} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" /> Ground Coverage
            </CardTitle>
            <CardDescription>
              Alert thresholds for polling-station agent coverage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-6">
              <div className="space-y-0.5">
                <Label htmlFor="min-coverage" className="text-base font-bold">Minimum Coverage Threshold</Label>
                <p className="text-sm text-muted-foreground">
                  Constituencies where the share of polling stations with an assigned agent falls
                  below this percentage trigger a warning on the coordinator dashboard.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  id="min-coverage"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-24 text-right font-mono"
                />
                <span className="text-sm font-bold text-muted-foreground">%</span>
              </div>
            </div>
            {!thresholdValid && threshold !== "" && (
              <p className="text-sm text-red-600 font-medium">Enter a whole number between 0 and 100.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Policies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Force 2FA</Label>
                <p className="text-sm text-muted-foreground">
                  Require two-factor authentication for Level 5+ roles.
                </p>
              </div>
              <Switch checked={config?.twoFactorRequired} />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-bold">Session Timeout</Label>
                <p className="text-sm text-muted-foreground">
                  Current: {config?.sessionTimeoutMinutes || 30} minutes
                </p>
              </div>
              <Button variant="outline" size="sm">Modify</Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!thresholdValid || !thresholdDirty || updateConfig.isPending}
            className="bg-primary hover:bg-primary/90 flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> {updateConfig.isPending ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
