import { useState, useEffect, useRef } from "react";
import { useUser, Show } from "@clerk/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Check, ChevronRight, AlertCircle, Sparkles, Flag, User, Calendar, Palette, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface RegisterStatus {
  hasCampaign: boolean;
  isGlobalAdmin: boolean;
  campaigns: Array<{ id: number; name: string; slug: string }>;
}

interface SlugCheck {
  slug: string;
  available: boolean;
  reason: string | null;
}

interface RegisterResponse {
  tenant: {
    id: number;
    name: string;
    slug: string;
    plan: string;
    trialEndsAt: string;
  };
  trialDays: number;
  message: string;
}

const ELECTION_LEVELS = [
  "Presidential",
  "Governor",
  "Senator",
  "Woman Representative",
  "Member of Parliament",
  "Member of County Assembly",
];

const PRESET_COLORS = [
  { name: "Kenya Red", value: "#CE1126" },
  { name: "Kenya Green", value: "#006B3F" },
  { name: "Electric Blue", value: "#1E88E5" },
  { name: "Sunset Orange", value: "#F57C00" },
  { name: "Royal Purple", value: "#6A1B9A" },
  { name: "Deep Teal", value: "#00695C" },
];

const STEPS = [
  { id: 1, title: "Campaign Details", icon: Flag },
  { id: 2, title: "Candidate & Election", icon: User },
  { id: 3, title: "Branding", icon: Palette },
  { id: 4, title: "Contact", icon: Mail },
];

export default function RegisterCampaign() {
  const { user, isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [campaignName, setCampaignName] = useState("");
  const [slug, setSlug] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [electionLevel, setElectionLevel] = useState("");
  const [electionYear, setElectionYear] = useState("2027");
  const [primaryColor, setPrimaryColor] = useState(PRESET_COLORS[2].value);
  const [tagline, setTagline] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<RegisterResponse | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Check if user already has a campaign. Only meaningful once Clerk has
  // resolved a signed-in session — otherwise this 401s, and retrying a 401
  // would keep the page pinned on its loading spinner instead of showing the
  // signed-out prompt below.
  const { data: status, isLoading: statusLoading } = useQuery<RegisterStatus>({
    queryKey: ["/api/register/status"],
    queryFn: () => apiFetch("/api/register/status"),
    enabled: Boolean(clerkLoaded && isSignedIn),
    retry: false,
  });

  // Slug availability check (debounced)
  const [slugToCheck, setSlugToCheck] = useState("");
  const { data: slugCheck } = useQuery<SlugCheck>({
    queryKey: ["/api/register/check-slug", slugToCheck],
    queryFn: () => apiFetch(`/api/register/check-slug?slug=${encodeURIComponent(slugToCheck)}`),
    enabled: slugToCheck.length > 0,
  });

  // Debounce slug check as user types campaign name
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const normalized = campaignName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (normalized) setSlugToCheck(normalized);
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [campaignName]);

  // Update slug field when server normalizes it
  useEffect(() => {
    if (slugCheck?.slug) setSlug(slugCheck.slug);
  }, [slugCheck?.slug]);

  // Auto-fill contact email from Clerk user
  useEffect(() => {
    if (user?.primaryEmailAddress?.emailAddress && !contactEmail) {
      setContactEmail(user.primaryEmailAddress.emailAddress);
    }
  }, [user, contactEmail]);

  // Submit mutation
  const register = useMutation({
    mutationFn: () =>
      apiFetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName,
          slug,
          candidateName: candidateName || undefined,
          electionLevel: electionLevel || undefined,
          electionYear: Number(electionYear),
          primaryColor,
          tagline: tagline || undefined,
          contactEmail: contactEmail || undefined,
        }),
      }),
    onSuccess: async (data: RegisterResponse) => {
      setSuccessData(data);
      setShowSuccess(true);
      // Membership is app-owned, so the session needs no reload — the next
      // request already resolves the new campaign. Hard navigate to re-scope.
      setTimeout(() => {
        window.location.assign(`${BASE}/dashboard`);
      }, 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!campaignName.trim()) {
      toast({ title: "Campaign name required", variant: "destructive" });
      return;
    }
    if (!slugCheck?.available) {
      toast({ title: "Web address unavailable", description: slugCheck?.reason || "Choose a different name", variant: "destructive" });
      return;
    }
    register.mutate();
  };

  const canProceed = (currentStep: number): boolean => {
    if (currentStep === 1) return campaignName.trim().length > 0 && slugCheck?.available === true;
    if (currentStep === 2) return true; // Optional fields
    if (currentStep === 3) return true; // Optional
    if (currentStep === 4) return true; // Optional
    return false;
  };

  // Wait on Clerk itself, then on the campaign lookup for signed-in users only.
  if (!clerkLoaded || (isSignedIn && statusLoading)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Success screen
  if (showSuccess && successData) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/5 via-background to-green-500/5 px-4">
        <div className="w-full max-w-lg bg-card border border-border rounded-sm shadow-lg p-8 text-center space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-500 flex items-center justify-center animate-in zoom-in duration-700">
            <Check className="h-9 w-9 text-white" strokeWidth={3} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-foreground mb-2">
              Campaign Created!
            </h1>
            <p className="text-muted-foreground text-sm">
              {successData.message}
            </p>
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-sm p-4">
            <p className="text-xs font-black uppercase tracking-wider text-primary mb-1">
              Your Trial
            </p>
            <p className="text-2xl font-black text-foreground">
              {successData.trialDays} Days Free
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Full access to all features until {new Date(successData.tenant.trialEndsAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Redirecting to Command Centre…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Show when="signed-out">
        <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <h1 className="text-xl font-black">Sign In Required</h1>
            <p className="text-sm text-muted-foreground">Please sign in to register your campaign.</p>
            <Button asChild>
              <a href={`${BASE}/sign-up`}>Sign Up</a>
            </Button>
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        {status?.hasCampaign ? (
          <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
            <div className="w-full max-w-md bg-card border border-border rounded-sm shadow-md p-8 text-center space-y-6">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Flag className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight mb-2">Campaign Active</h1>
                <p className="text-sm text-muted-foreground">
                  You already belong to a campaign workspace.
                </p>
              </div>
              {status.campaigns.length > 0 && (
                <div className="bg-muted/30 border border-border rounded-sm p-4 text-left">
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-2">
                    Your Campaigns
                  </p>
                  {status.campaigns.map((c) => (
                    <div key={c.id} className="text-sm font-semibold text-foreground">
                      {c.name}
                    </div>
                  ))}
                </div>
              )}
              <Button asChild className="w-full">
                <a href={`${BASE}/dashboard`}>Go to Command Centre</a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[100dvh] bg-gradient-to-br from-background via-primary/5 to-background">
            {/* Left panel — branding */}
            <div className="hidden lg:flex lg:w-2/5 bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-white p-12 flex-col justify-between relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnoiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLW9wYWNpdHk9IjAuMDUiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-20" />
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-sm px-4 py-2 mb-8">
                  <Sparkles className="h-5 w-5" />
                  <span className="font-black text-sm tracking-wider">USHINDI PLATFORM</span>
                </div>
                <h1 className="text-4xl font-black tracking-tight leading-tight mb-4">
                  Launch Your Campaign Command Centre
                </h1>
                <p className="text-white/80 text-lg leading-relaxed">
                  Join hundreds of candidates across Kenya running data-driven, digitally-enabled campaigns.
                  From volunteer coordination to election-day results, everything you need is here.
                </p>
              </div>
              <div className="relative z-10 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">14-Day Free Trial</p>
                    <p className="text-white/70 text-xs">Full platform access, no credit card required</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Instant Setup</p>
                    <p className="text-white/70 text-xs">Your workspace is ready in under 2 minutes</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Kenya-Specific Tools</p>
                    <p className="text-white/70 text-xs">Built for IEBC compliance and local workflows</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right panel — form wizard */}
            <div className="flex-1 flex items-center justify-center p-4 lg:p-12">
              <div className="w-full max-w-xl bg-card border border-border rounded-sm shadow-xl">
                {/* Progress steps */}
                <div className="border-b border-border bg-muted/20 px-6 py-5">
                  <div className="flex items-center justify-between">
                    {STEPS.map((s, idx) => {
                      const Icon = s.icon;
                      const isActive = step === s.id;
                      const isComplete = step > s.id;
                      return (
                        <div key={s.id} className="flex items-center">
                          <div className="flex flex-col items-center">
                            <div
                              className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center font-black text-sm transition-all duration-300",
                                isComplete && "bg-green-500 text-white",
                                isActive && "bg-primary text-primary-foreground scale-110",
                                !isActive && !isComplete && "bg-muted text-muted-foreground"
                              )}
                            >
                              {isComplete ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                            </div>
                            <p className={cn("text-[10px] font-bold mt-1.5 hidden sm:block", isActive ? "text-foreground" : "text-muted-foreground")}>
                              {s.title}
                            </p>
                          </div>
                          {idx < STEPS.length - 1 && (
                            <div className={cn("w-8 lg:w-16 h-0.5 mx-2 transition-colors", step > s.id ? "bg-green-500" : "bg-muted")} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Form content */}
                <div className="p-6 lg:p-8 space-y-6">
                  {step === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">Campaign Details</h2>
                        <p className="text-sm text-muted-foreground">
                          Choose a name for your campaign workspace. This will be visible to your team.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="campaignName" className="font-bold">
                          Campaign Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="campaignName"
                          placeholder="e.g. Mwananchi 2027 Campaign"
                          value={campaignName}
                          onChange={(e) => setCampaignName(e.target.value)}
                          className="text-base"
                          data-testid="input-campaign-name"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="font-bold">Web Address</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground shrink-0">ushindi.app/</span>
                          <Input
                            value={slug}
                            readOnly
                            className="text-base font-mono bg-muted/30"
                            placeholder="auto-generated"
                            data-testid="input-slug"
                          />
                        </div>
                        {slugToCheck && slugCheck && (
                          <div className={cn("flex items-center gap-2 text-xs font-semibold mt-2", slugCheck.available ? "text-green-600" : "text-destructive")}>
                            {slugCheck.available ? (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Available</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-3.5 w-3.5" />
                                <span>{slugCheck.reason || "Unavailable"}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">Candidate &amp; Election</h2>
                        <p className="text-sm text-muted-foreground">
                          Optional — you can configure this later in Branding settings.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="candidateName" className="font-bold">Candidate Name</Label>
                        <Input
                          id="candidateName"
                          placeholder="e.g. Linda Mwananchi"
                          value={candidateName}
                          onChange={(e) => setCandidateName(e.target.value)}
                          className="text-base"
                          data-testid="input-candidate-name"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="electionLevel" className="font-bold">Election Level</Label>
                          <Select value={electionLevel} onValueChange={setElectionLevel}>
                            <SelectTrigger id="electionLevel" data-testid="select-election-level">
                              <SelectValue placeholder="Select level" />
                            </SelectTrigger>
                            <SelectContent>
                              {ELECTION_LEVELS.map((lvl) => (
                                <SelectItem key={lvl} value={lvl}>
                                  {lvl}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="electionYear" className="font-bold">Election Year</Label>
                          <Input
                            id="electionYear"
                            type="number"
                            min="2024"
                            max="2030"
                            value={electionYear}
                            onChange={(e) => setElectionYear(e.target.value)}
                            className="text-base"
                            data-testid="input-election-year"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">Campaign Branding</h2>
                        <p className="text-sm text-muted-foreground">
                          Choose a primary color and tagline. You can refine this later.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="font-bold">Primary Color</Label>
                        <div className="grid grid-cols-3 gap-3">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => setPrimaryColor(c.value)}
                              className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-sm border-2 transition-all hover:scale-105",
                                primaryColor === c.value ? "border-foreground shadow-md" : "border-border"
                              )}
                              data-testid={`button-color-${c.name.toLowerCase().replace(/\s/g, "-")}`}
                            >
                              <div className="w-10 h-10 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: c.value }} />
                              <span className="text-xs font-semibold text-center">{c.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <Label htmlFor="customColor" className="text-xs font-bold">Custom:</Label>
                          <input
                            id="customColor"
                            type="color"
                            value={primaryColor}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="w-12 h-12 rounded-sm border border-border cursor-pointer"
                            data-testid="input-custom-color"
                          />
                          <span className="text-xs font-mono text-muted-foreground">{primaryColor}</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="tagline" className="font-bold">Campaign Tagline</Label>
                        <Textarea
                          id="tagline"
                          placeholder="e.g. For the People, By the People"
                          value={tagline}
                          onChange={(e) => setTagline(e.target.value)}
                          rows={2}
                          className="text-base resize-none"
                          data-testid="input-tagline"
                        />
                      </div>
                    </div>
                  )}

                  {step === 4 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">Contact Details</h2>
                        <p className="text-sm text-muted-foreground">
                          We'll use this email for important account notifications.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contactEmail" className="font-bold">Contact Email</Label>
                        <Input
                          id="contactEmail"
                          type="email"
                          placeholder="campaign@example.com"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          className="text-base"
                          data-testid="input-contact-email"
                        />
                        <p className="text-xs text-muted-foreground">
                          Defaults to your Clerk account email. You can change this later.
                        </p>
                      </div>

                      <div className="bg-primary/5 border border-primary/20 rounded-sm p-4 space-y-2">
                        <p className="text-xs font-black uppercase tracking-wider text-primary">Review Your Campaign</p>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Name:</span>
                            <span className="font-bold">{campaignName || "—"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Candidate:</span>
                            <span className="font-bold">{candidateName || "Not set"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Election:</span>
                            <span className="font-bold">{electionLevel ? `${electionLevel} ${electionYear}` : "Not set"}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Primary Color:</span>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: primaryColor }} />
                              <span className="font-mono text-xs">{primaryColor}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Navigation footer */}
                <div className="border-t border-border bg-muted/10 px-6 lg:px-8 py-4 flex items-center justify-between">
                  {step > 1 ? (
                    <Button
                      variant="outline"
                      onClick={() => setStep((s) => s - 1)}
                      disabled={register.isPending}
                      data-testid="button-back"
                    >
                      Back
                    </Button>
                  ) : (
                    <div />
                  )}

                  {step < 4 ? (
                    <Button
                      onClick={() => setStep((s) => s + 1)}
                      disabled={!canProceed(step)}
                      data-testid="button-next"
                    >
                      Continue
                      <ChevronRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={!canProceed(step) || register.isPending}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold"
                      data-testid="button-create-campaign"
                    >
                      {register.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          Create Campaign
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
