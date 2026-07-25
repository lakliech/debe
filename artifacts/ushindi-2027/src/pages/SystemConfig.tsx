import { useGetSystemConfig } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Save } from "lucide-react";

export default function SystemConfig() {
  const { data: config, isLoading } = useGetSystemConfig();

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">System Configuration</h1>
        <p className="text-muted-foreground mt-1">Global settings affecting all users.</p>
      </div>

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
          <Button className="bg-primary hover:bg-primary/90 flex items-center gap-2">
            <Save className="w-4 h-4" /> Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
