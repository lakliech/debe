import { useGetBranding, useUpdateBranding } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Save, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Branding() {
  const { data: branding, isLoading } = useGetBranding();
  const updateBranding = useUpdateBranding();
  const { toast } = useToast();

  const [form, setForm] = useState({
    campaignName: "Linda Mwananchi",
    candidateName: "Linda Mwananchi Campaign",
    primaryColor: "#1D9BF0",
    accentColor: "#000000",
    tagline: "It's Time. Be Part of the Change."
  });

  useEffect(() => {
    if (branding) {
      setForm({
        campaignName: branding.campaignName,
        candidateName: branding.candidateName,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor || "hsl(350, 80%, 45%)",
        tagline: branding.tagline,
      });
    }
  }, [branding]);

  const handleSave = () => {
    updateBranding.mutate({ data: form as any }, {
      onSuccess: () => {
        toast({ title: "Branding updated successfully." });
      }
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Branding & Identity</h1>
        <p className="text-muted-foreground mt-1">Configure public-facing and internal platform identity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="font-bold">Campaign Name</Label>
            <Input 
              value={form.campaignName} 
              onChange={e => setForm({...form, campaignName: e.target.value})}
              className="bg-background"
            />
          </div>
          
          <div className="space-y-2">
            <Label className="font-bold">Candidate Name</Label>
            <Input 
              value={form.candidateName} 
              onChange={e => setForm({...form, candidateName: e.target.value})}
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold">Tagline</Label>
            <Input 
              value={form.tagline} 
              onChange={e => setForm({...form, tagline: e.target.value})}
              className="bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-bold">Primary Color (HSL)</Label>
              <Input 
                value={form.primaryColor} 
                onChange={e => setForm({...form, primaryColor: e.target.value})}
                className="bg-background font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">Accent Color (HSL)</Label>
              <Input 
                value={form.accentColor} 
                onChange={e => setForm({...form, accentColor: e.target.value})}
                className="bg-background font-mono text-sm"
              />
            </div>
          </div>

          <Button 
            onClick={handleSave} 
            disabled={updateBranding.isPending}
            className="w-full bg-primary hover:bg-primary/90 flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> Save Identity
          </Button>
        </div>

        {/* Live Preview */}
        <div>
          <Label className="font-bold flex items-center gap-2 mb-2">
            <Eye className="w-4 h-4 text-muted-foreground" /> Live Preview
          </Label>
          <Card className="overflow-hidden border-2 shadow-sm">
            <div className="h-2 w-full bg-gradient-to-r from-[hsl(142,60%,20%)] via-[hsl(350,80%,45%)] to-[hsl(142,60%,20%)]" />
            <CardContent className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded bg-[hsl(142,60%,20%)] text-white mx-auto flex items-center justify-center font-black text-2xl shadow-sm">
                {form.campaignName.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">{form.campaignName}</h2>
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-1">
                  {form.candidateName}
                </p>
              </div>
              <p className="text-sm italic opacity-80 max-w-xs mx-auto">"{form.tagline}"</p>
              
              <div className="pt-4 flex gap-2 justify-center">
                <div className="w-6 h-6 rounded-full bg-[hsl(142,60%,20%)] shadow-sm" />
                <div className="w-6 h-6 rounded-full bg-[hsl(350,80%,45%)] shadow-sm" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
