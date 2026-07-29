import { useGetBranding, useUpdateBranding } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Eye, Palette, Globe, Copy, Check, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ELECTION_LEVELS, POSITION_TITLE_BY_ELECTION, type ElectionLevel } from "@/lib/electionLevel";

interface BrandingForm {
  campaignName: string;
  candidateName: string;
  positionTitle: string;
  partyName: string;
  tagline: string;
  electionYear: number;
  electionLevel: ElectionLevel;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  mpesaPaybill: string;
  websiteUrl: string;
  socialTwitter: string;
  socialFacebook: string;
  socialInstagram: string;
}

const DEFAULTS: BrandingForm = {
  campaignName: "Your Campaign",
  candidateName: "Your Candidate",
  positionTitle: "Your Position",
  partyName: "Your Party",
  tagline: "Your Campaign Tagline",
  electionYear: new Date().getFullYear() + 1,
  electionLevel: "Presidential",
  primaryColor: "209 88% 50%",
  secondaryColor: "0 0% 8%",
  accentColor: "0 0% 8%",
  logoUrl: "",
  mpesaPaybill: "",
  websiteUrl: "",
  socialTwitter: "",
  socialFacebook: "",
  socialInstagram: "",
};

function ColorSwatch({ hsl }: { hsl: string }) {
  const isValid = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(hsl.trim());
  return (
    <div
      className="w-8 h-8 rounded border border-border shrink-0"
      style={isValid ? { backgroundColor: `hsl(${hsl})` } : { backgroundColor: "#e5e7eb" }}
      title={isValid ? `hsl(${hsl})` : "Enter as: H S% L% e.g. 209 88% 50%"}
    />
  );
}

// Derive the tenant slug from env (build-time) or hostname subdomain (runtime)
const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? "ushindi.app";
const RESERVED_PARTS = new Set(["www", "api", "app", "mail", "localhost"]);
function deriveSlug(): string | null {
  const envSlug = import.meta.env.VITE_TENANT_SLUG as string | undefined;
  if (envSlug) return envSlug;
  const parts = window.location.hostname.split(".");
  return parts.length >= 3 && !RESERVED_PARTS.has(parts[0]) ? parts[0] : null;
}

export default function Branding() {
  const { data: branding, isLoading } = useGetBranding();
  const updateBranding = useUpdateBranding();
  const { toast } = useToast();

  const [form, setForm] = useState<BrandingForm>(DEFAULTS);
  const [copied, setCopied] = useState(false);

  const tenantSlug = deriveSlug();
  const portalUrl = tenantSlug ? `https://${tenantSlug}.${PORTAL_DOMAIN}` : null;

  const copyPortalUrl = () => {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (branding) {
      setForm({
        campaignName: branding.campaignName ?? DEFAULTS.campaignName,
        candidateName: branding.candidateName ?? DEFAULTS.candidateName,
        positionTitle: (branding as any).positionTitle ?? DEFAULTS.positionTitle,
        partyName: (branding as any).partyName ?? DEFAULTS.partyName,
        tagline: branding.tagline ?? DEFAULTS.tagline,
        electionYear: branding.electionYear ?? DEFAULTS.electionYear,
        electionLevel: ((branding as any).electionLevel ?? DEFAULTS.electionLevel) as ElectionLevel,
        primaryColor: branding.primaryColor ?? DEFAULTS.primaryColor,
        secondaryColor: branding.secondaryColor ?? DEFAULTS.secondaryColor,
        accentColor: branding.accentColor ?? DEFAULTS.accentColor,
        logoUrl: branding.logoUrl ?? "",
        mpesaPaybill: (branding as any).mpesaPaybill ?? "",
        websiteUrl: branding.websiteUrl ?? "",
        socialTwitter: branding.socialTwitter ?? "",
        socialFacebook: branding.socialFacebook ?? "",
        socialInstagram: branding.socialInstagram ?? "",
      });
    }
  }, [branding]);

  const f = (key: keyof BrandingForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const handleSave = () => {
    updateBranding.mutate(
      {
        data: {
          campaignName: form.campaignName,
          candidateName: form.candidateName,
          positionTitle: form.positionTitle,
          partyName: form.partyName,
          tagline: form.tagline,
          electionYear: Number(form.electionYear),
          electionLevel: form.electionLevel,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          accentColor: form.accentColor || undefined,
          logoUrl: form.logoUrl || undefined,
          mpesaPaybill: form.mpesaPaybill || undefined,
          websiteUrl: form.websiteUrl || undefined,
          socialTwitter: form.socialTwitter || undefined,
          socialFacebook: form.socialFacebook || undefined,
          socialInstagram: form.socialInstagram || undefined,
        } as any,
      },
      {
        onSuccess: () => {
          toast({ title: "Branding saved — changes are live immediately." });
        },
        onError: (err: any) => {
          toast({ title: "Save failed", description: err?.message ?? "Unknown error", variant: "destructive" });
        },
      }
    );
  };

  const nameParts = form.candidateName.toUpperCase().split(" ");
  const logoLine1 = nameParts[0] ?? "";
  const logoLine2 = nameParts.slice(1).join(" ");

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading branding…</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Branding &amp; Identity</h1>
        <p className="text-muted-foreground mt-1">
          Configure every public-facing name, colour, and contact detail. Changes take effect immediately — no code deployment needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Left column: all form controls ── */}
        <div className="space-y-6">

          {/* Campaign identity */}
          <div className="space-y-4">
            <h2 className="text-sm font-black tracking-widest text-muted-foreground uppercase">Campaign Identity</h2>

            <div className="space-y-2">
              <Label className="font-semibold">Candidate Name</Label>
              <Input value={form.candidateName} onChange={f("candidateName")} placeholder="e.g. Jane Doe" />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Position / Office</Label>
              <Input value={form.positionTitle} onChange={f("positionTitle")} placeholder="e.g. Member of Parliament" />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Party Name</Label>
              <Input value={form.partyName} onChange={f("partyName")} placeholder="e.g. National Unity Party" />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Campaign Name</Label>
              <Input value={form.campaignName} onChange={f("campaignName")} placeholder="e.g. Jane for Westlands" />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Election Level</Label>
              <Select
                value={form.electionLevel}
                onValueChange={(val) => {
                  const level = val as ElectionLevel;
                  setForm({
                    ...form,
                    electionLevel: level,
                    positionTitle: POSITION_TITLE_BY_ELECTION[level],
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select election level" />
                </SelectTrigger>
                <SelectContent>
                  {ELECTION_LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sets the correct IEBC result form name and tally geography. Selecting a level auto-fills the Position field.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Campaign Tagline</Label>
              <Input value={form.tagline} onChange={f("tagline")} placeholder="e.g. A new Kenya for all" />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Election Year</Label>
              <Input
                type="number"
                value={form.electionYear}
                onChange={e => setForm({ ...form, electionYear: Number(e.target.value) })}
                min={2024}
                max={2040}
              />
            </div>
          </div>

          {/* Colours */}
          <div className="space-y-4">
            <h2 className="text-sm font-black tracking-widest text-muted-foreground uppercase">Colours</h2>
            <p className="text-xs text-muted-foreground">
              Enter HSL components without the <code>hsl()</code> wrapper, e.g. <strong>209 88% 50%</strong> for electric blue.
              These are applied instantly as CSS variables across the entire site.
            </p>

            <div className="space-y-2">
              <Label className="font-semibold">Primary Colour (HSL)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.primaryColor}
                  onChange={f("primaryColor")}
                  placeholder="209 88% 50%"
                  className="font-mono text-sm"
                />
                <ColorSwatch hsl={form.primaryColor} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Secondary Colour (HSL)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.secondaryColor}
                  onChange={f("secondaryColor")}
                  placeholder="0 0% 8%"
                  className="font-mono text-sm"
                />
                <ColorSwatch hsl={form.secondaryColor} />
              </div>
            </div>
          </div>

          {/* Logo & media */}
          <div className="space-y-4">
            <h2 className="text-sm font-black tracking-widest text-muted-foreground uppercase">Logo &amp; Media</h2>

            <div className="space-y-2">
              <Label className="font-semibold">Logo URL</Label>
              <Input
                value={form.logoUrl}
                onChange={f("logoUrl")}
                placeholder="https://cdn.example.com/logo.png"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the auto-generated text logo. Provide a public HTTPS URL for a custom image.
              </p>
            </div>
          </div>

          {/* Finance */}
          <div className="space-y-4">
            <h2 className="text-sm font-black tracking-widest text-muted-foreground uppercase">Finance &amp; Donations</h2>

            <div className="space-y-2">
              <Label className="font-semibold">M-Pesa Paybill Number</Label>
              <Input
                value={form.mpesaPaybill}
                onChange={f("mpesaPaybill")}
                placeholder="e.g. 3033049"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the public portal footer and crowdfunding page.
              </p>
            </div>
          </div>

          {/* Social / web */}
          <div className="space-y-4">
            <h2 className="text-sm font-black tracking-widest text-muted-foreground uppercase">Website &amp; Social</h2>

            <div className="space-y-2">
              <Label className="font-semibold">Website URL</Label>
              <Input value={form.websiteUrl} onChange={f("websiteUrl")} placeholder="https://example.ke" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="font-semibold text-xs">Twitter / X</Label>
                <Input value={form.socialTwitter} onChange={f("socialTwitter")} placeholder="@handle" className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="font-semibold text-xs">Facebook</Label>
                <Input value={form.socialFacebook} onChange={f("socialFacebook")} placeholder="page-slug" className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="font-semibold text-xs">Instagram</Label>
                <Input value={form.socialInstagram} onChange={f("socialInstagram")} placeholder="@handle" className="text-sm" />
              </div>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={updateBranding.isPending}
            className="w-full flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {updateBranding.isPending ? "Saving…" : "Save Branding"}
          </Button>
        </div>

        {/* ── Right column: live preview ── */}
        <div className="space-y-4">
          <Label className="font-bold flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" /> Live Preview
          </Label>

          {/* Public portal URL */}
          <div className="rounded-sm border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">Your Public Portal URL</p>
            </div>
            {portalUrl ? (
              <>
                <div className="flex items-center gap-2 bg-muted/40 rounded border border-border px-3 py-2">
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 font-mono text-xs text-primary underline underline-offset-2 truncate"
                  >
                    {portalUrl}
                  </a>
                  <button
                    onClick={copyPortalUrl}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy link"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <details className="group">
                  <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none">
                    <Info className="h-3 w-3 shrink-0" />
                    <span>How to set up a custom domain (CNAME)</span>
                    <span className="ml-auto text-[10px] group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <div className="mt-2 text-xs text-muted-foreground space-y-1.5 pl-4 border-l border-border">
                    <p>
                      Your portal is already live at{" "}
                      <span className="font-mono">{portalUrl}</span> — no further setup is needed.
                    </p>
                    <p>
                      To use a custom subdomain (e.g. <span className="font-mono">vote.example.ke</span>), add a{" "}
                      <strong>CNAME</strong> record in your DNS provider pointing to{" "}
                      <span className="font-mono font-semibold">{PORTAL_DOMAIN}</span>, then contact the platform operator
                      to register the custom domain.
                    </p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>In your DNS settings, create a CNAME record: <span className="font-mono">vote → {PORTAL_DOMAIN}</span></li>
                      <li>Allow up to 48 hours for DNS to propagate worldwide.</li>
                      <li>Ask the platform operator to add your custom domain to the allowlist.</li>
                    </ol>
                  </div>
                </details>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Slug not detected. Set the <span className="font-mono">VITE_TENANT_SLUG</span> environment variable or
                access the portal from its subdomain URL.
              </p>
            )}
          </div>

          {/* Public portal header preview */}
          <Card className="overflow-hidden border shadow-sm">
            <div className="text-[10px] font-black tracking-widest text-muted-foreground px-4 pt-3 pb-1 uppercase">
              Public Portal Header
            </div>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3 mb-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt={form.campaignName} className="h-8 object-contain" />
                ) : (
                  <div className="flex flex-col leading-none">
                    <div
                      className="text-white font-black text-xs px-2 py-0.5 tracking-wider"
                      style={{ backgroundColor: `hsl(${form.primaryColor})` }}
                    >
                      {logoLine1}
                    </div>
                    {logoLine2 && (
                      <div className="text-black font-black text-[9px] tracking-[0.2em] mt-0.5">
                        {logoLine2}
                      </div>
                    )}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{form.campaignName}</div>
              </div>
              <div className="text-xs italic opacity-70">"{form.tagline}"</div>
            </CardContent>
          </Card>

          {/* Admin sidebar preview */}
          <Card className="overflow-hidden border shadow-sm">
            <div className="text-[10px] font-black tracking-widest text-muted-foreground px-4 pt-3 pb-1 uppercase">
              Admin Sidebar Header
            </div>
            <CardContent className="p-0">
              <div
                className="flex items-center gap-3 px-4 h-12"
                style={{ backgroundColor: `hsl(${form.primaryColor})`, color: "white" }}
              >
                <div className="flex flex-col leading-none">
                  <div className="bg-white font-black text-[9px] px-1 py-0.5 tracking-wider"
                    style={{ color: `hsl(${form.primaryColor})` }}>
                    {logoLine1}
                  </div>
                  {logoLine2 && (
                    <div className="font-black text-[7px] tracking-[0.18em] mt-0.5 opacity-70">
                      {logoLine2}
                    </div>
                  )}
                </div>
                <span className="font-bold tracking-tight text-sm">COMMAND CENTRE</span>
              </div>
            </CardContent>
          </Card>

          {/* Colour palette */}
          <Card className="overflow-hidden border shadow-sm">
            <div className="text-[10px] font-black tracking-widest text-muted-foreground px-4 pt-3 pb-1 uppercase">
              Colour Palette
            </div>
            <CardContent className="p-4 flex gap-3 items-center">
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded" style={{ backgroundColor: `hsl(${form.primaryColor})` }} />
                <span className="text-[9px] font-mono text-muted-foreground">Primary</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 rounded" style={{ backgroundColor: `hsl(${form.secondaryColor})` }} />
                <span className="text-[9px] font-mono text-muted-foreground">Secondary</span>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xs font-semibold">{form.candidateName}</div>
                <div className="text-[10px] text-muted-foreground">{form.positionTitle}</div>
                <div className="text-[10px] text-muted-foreground">{form.partyName} · {form.electionYear}</div>
                {form.mpesaPaybill && (
                  <div className="text-[10px] font-mono mt-1">Paybill: {form.mpesaPaybill}</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Palette icon */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Palette className="w-3.5 h-3.5" />
            Colours apply site-wide the moment you save — no page reload needed.
          </div>
        </div>
      </div>
    </div>
  );
}
