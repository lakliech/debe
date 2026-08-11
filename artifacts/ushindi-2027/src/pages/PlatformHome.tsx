import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Show } from "@clerk/react";
import {
  Shield, Zap, Users, BarChart3, Lock, Clock, CheckCircle2,
  ArrowRight, Sparkles, Database, Radio, FileCheck, TrendingUp,
  AlertCircle, Globe, Smartphone, Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface Plan {
  tier: "free" | "pro" | "enterprise";
  label: string;
  priceMonthlyKes: number | null;
  description: string;
  features: string[];
  maxAgents: number | null;
  maxStations: number | null;
}

const ELECTION_LEVELS = [
  "Presidential",
  "Gubernatorial",
  "Senatorial",
  "Women Rep",
  "MP",
  "MCA",
  "Not sure yet",
];

function useScrollReveal() {
  const [revealed, setRevealed] = useState(new Set<string>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id) {
            setRevealed((prev) => new Set(prev).add(entry.target.id));
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -100px 0px" }
    );

    document.querySelectorAll("[data-reveal]").forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  return revealed;
}

export default function PlatformHome() {
  const { toast } = useToast();
  const revealed = useScrollReveal();

  const { data: plansData } = useQuery<{ plans: Plan[]; billingEnabled: boolean }>({
    queryKey: ["/api/billing/plans"],
    queryFn: () => apiFetch("/api/billing/plans"),
  });

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    organisation: "",
    electionLevel: "",
    message: "",
  });

  const enquiry = useMutation({
    mutationFn: (data: typeof formData) =>
      apiFetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({
        title: "Request received",
        description: "We'll be in touch within 24 hours.",
      });
      setFormData({
        fullName: "",
        email: "",
        organisation: "",
        electionLevel: "",
        message: "",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Submission failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    enquiry.mutate(formData);
  };

  const proPlan = plansData?.plans.find((p) => p.tier === "pro");

  return (
    <div className="min-h-[100dvh] bg-[hsl(160,70%,28%)] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[hsl(160,70%,28%)]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-[hsl(25,95%,55%)]" />
            <span className="text-xl font-black tracking-tight" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Debe
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm font-semibold text-white/80 hover:text-white transition-colors">
              Pricing
            </Link>
            <Show when="signed-out">
              <Link href="/sign-in">
                <Button variant="outline" size="sm" className="bg-transparent border-white/20 text-white hover:bg-white/10">
                  Sign In
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button size="sm" className="bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold">
                  Start Free Trial
                </Button>
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard">
                <Button size="sm" className="bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold">
                  Dashboard
                </Button>
              </Link>
            </Show>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px),
                              repeating-linear-gradient(90deg, transparent, transparent 2px, white 2px, white 3px)`,
            backgroundSize: "60px 60px",
          }} />
        </div>
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded-full text-xs font-bold uppercase tracking-wider mb-6">
              <Sparkles className="h-3 w-3" />
              Trusted Infrastructure
            </div>
            <h1 className="text-6xl font-black tracking-tight mb-6 leading-[1.05]" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Run your entire<br />
              election operation<br />
              <span className="text-[hsl(25,95%,55%)]">on one platform</span>
            </h1>
            <p className="text-xl text-white/80 mb-8 leading-relaxed max-w-xl">
              Polling agents in the field. Live tallying. Volunteer coordination. Campaign finance. The infrastructure Kenya's campaigns trust when results cannot fail.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/sign-up">
                <Button size="lg" className="bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold h-12 px-8 text-base">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 h-12 px-8 text-base font-semibold">
                  View Pricing
                </Button>
              </Link>
            </div>
            <p className="text-sm text-white/60 mt-6">
              Free trial • No credit card required • Live in 15 minutes
            </p>
            {/* Self-serve entry point: sign-up creates the account, this creates
                the campaign. Returning founders skip straight here. */}
            <p className="text-sm text-white/70 mt-3">
              Already have an account?{" "}
              <Link
                href="/register/campaign"
                className="font-bold text-[hsl(25,95%,60%)] underline underline-offset-4 hover:text-white transition-colors"
                data-testid="link-register-campaign"
              >
                Register your campaign
              </Link>
            </p>
          </div>
          <div className="relative">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-8 space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded flex items-center justify-center shrink-0">
                  <Radio className="h-6 w-6 text-[hsl(25,95%,55%)]" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Live result submission</h3>
                  <p className="text-white/70 text-sm">Field agents submit Form 34A photos and counts from polling stations in real time</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded flex items-center justify-center shrink-0">
                  <BarChart3 className="h-6 w-6 text-[hsl(25,95%,55%)]" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Instant tallying</h3>
                  <p className="text-white/70 text-sm">Aggregate results by constituency, county, or national level as submissions arrive</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded flex items-center justify-center shrink-0">
                  <Shield className="h-6 w-6 text-[hsl(25,95%,55%)]" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">Election-day reliability</h3>
                  <p className="text-white/70 text-sm">Built for high-stakes operations. Offline-first agents. Conflict detection. Audit trails.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="py-12 bg-black/20 border-y border-white/10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="text-4xl font-black mb-1 text-[hsl(25,95%,55%)]" style={{ fontFamily: "'Clash Display', sans-serif" }}>99.8%</div>
            <div className="text-sm text-white/70 font-semibold">Uptime SLA</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-black mb-1 text-[hsl(25,95%,55%)]" style={{ fontFamily: "'Clash Display', sans-serif" }}>&lt;2s</div>
            <div className="text-sm text-white/70 font-semibold">Result submission</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-black mb-1 text-[hsl(25,95%,55%)]" style={{ fontFamily: "'Clash Display', sans-serif" }}>24/7</div>
            <div className="text-sm text-white/70 font-semibold">Support on election day</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-black mb-1 text-[hsl(25,95%,55%)]" style={{ fontFamily: "'Clash Display', sans-serif" }}>ISO 27001</div>
            <div className="text-sm text-white/70 font-semibold">Security certified</div>
          </div>
        </div>
      </section>

      {/* Core features */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-black tracking-tight mb-4" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Everything you need.<br />Nothing you don't.
            </h2>
            <p className="text-xl text-white/70 max-w-2xl mx-auto">
              A complete election-day operations platform designed for the realities of Kenyan campaigns.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {[
              {
                id: "feat-1",
                icon: Radio,
                title: "Polling Operations",
                desc: "Station registry. Agent assignment. Form 34A submission. Coverage gap detection. Incident logging.",
              },
              {
                id: "feat-2",
                icon: BarChart3,
                title: "Live Tallying",
                desc: "Real-time aggregation by level. Discrepancy alerts. Result verification workflows. Public transparency portal.",
              },
              {
                id: "feat-3",
                icon: Users,
                title: "Volunteer & Supporter CRM",
                desc: "Registration portals. Training workflows. Coordinator dashboards. Bulk messaging.",
              },
              {
                id: "feat-4",
                icon: TrendingUp,
                title: "Campaign Finance",
                desc: "Contribution tracking. Budget management. Expenditure logging. Compliance reporting.",
              },
              {
                id: "feat-5",
                icon: Globe,
                title: "Public Campaign Portal",
                desc: "Manifesto. County priorities. Events calendar. News. Media library. Aspirant directory.",
              },
              {
                id: "feat-6",
                icon: Smartphone,
                title: "Agent Mobile App",
                desc: "Offline-first PWA. Biometric auth. Photo capture. Auto-sync when back online.",
              },
            ].map((feat, i) => {
              const Icon = feat.icon;
              const isRevealed = revealed.has(feat.id);
              return (
                <div
                  key={feat.id}
                  id={feat.id}
                  data-reveal
                  className={cn(
                    "bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-8 transition-all duration-700",
                    isRevealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                  )}
                  style={{ transitionDelay: `${i * 100}ms` }}
                >
                  <div className="w-14 h-14 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded-lg flex items-center justify-center mb-5">
                    <Icon className="h-7 w-7 text-[hsl(25,95%,55%)]" />
                  </div>
                  <h3 className="text-xl font-black mb-3">{feat.title}</h3>
                  <p className="text-white/70 leading-relaxed">{feat.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Why Debe */}
      <section className="py-24 px-6 bg-black/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-black tracking-tight mb-6" style={{ fontFamily: "'Clash Display', sans-serif" }}>
                Built for the moment<br />when everything matters
              </h2>
              <p className="text-lg text-white/80 mb-8 leading-relaxed">
                Election day is not the time to discover your platform can't handle the load. Debe is architected for reliability: offline-first agents, conflict-free result aggregation, real-time sync, and automatic failover.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Shield, text: "Multi-tenant isolation — your data never touches another campaign" },
                  { icon: Lock, text: "Role-based access control with audit trails" },
                  { icon: Database, text: "Automated backups every 6 hours" },
                  { icon: Clock, text: "99.8% uptime SLA with redundant infrastructure" },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <Icon className="h-5 w-5 text-[hsl(25,95%,55%)] shrink-0 mt-0.5" />
                      <span className="text-white/90">{item.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-[hsl(25,95%,55%)]/10 border-l-4 border-[hsl(25,95%,55%)] p-6 rounded">
                <div className="flex items-center gap-2 mb-3">
                  <Award className="h-5 w-5 text-[hsl(25,95%,55%)]" />
                  <span className="font-black text-sm uppercase tracking-wider">Election Day Support</span>
                </div>
                <p className="text-white/90 leading-relaxed">
                  Dedicated support team on standby 24/7 from 48 hours before polls open until final results are certified.
                </p>
              </div>
              <div className="bg-[hsl(25,95%,55%)]/10 border-l-4 border-[hsl(25,95%,55%)] p-6 rounded">
                <div className="flex items-center gap-2 mb-3">
                  <FileCheck className="h-5 w-5 text-[hsl(25,95%,55%)]" />
                  <span className="font-black text-sm uppercase tracking-wider">Compliance Ready</span>
                </div>
                <p className="text-white/90 leading-relaxed">
                  Built-in compliance workflows for IEBC reporting, campaign finance disclosure, and data protection regulations.
                </p>
              </div>
              <div className="bg-[hsl(25,95%,55%)]/10 border-l-4 border-[hsl(25,95%,55%)] p-6 rounded">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-5 w-5 text-[hsl(25,95%,55%)]" />
                  <span className="font-black text-sm uppercase tracking-wider">Rapid Deployment</span>
                </div>
                <p className="text-white/90 leading-relaxed">
                  Import your station registry, configure branding, and onboard agents in under 24 hours.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      {proPlan && (
        <section className="py-24 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl font-black tracking-tight mb-4" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Transparent pricing.<br />No surprises.
            </h2>
            <p className="text-lg text-white/70 mb-12">
              Free trial to test the platform. Flat monthly fee when you're ready to scale.
            </p>
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-12 max-w-md mx-auto">
              <div className="text-sm font-bold uppercase tracking-wider text-[hsl(25,95%,55%)] mb-2">Pro Plan</div>
              <div className="mb-6">
                <span className="text-5xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>
                  KES {proPlan.priceMonthlyKes?.toLocaleString() ?? "—"}
                </span>
                <span className="text-white/60 text-lg">/month</span>
              </div>
              <p className="text-white/70 mb-8">{proPlan.description}</p>
              <Link href="/pricing">
                <Button size="lg" className="w-full bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold h-12">
                  See Full Pricing
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Contact form */}
      <section id="contact" className="py-24 px-6 bg-black/20">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-black tracking-tight mb-4" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Ready to run your campaign<br />on Debe?
            </h2>
            <p className="text-lg text-white/70">
              Start a free trial or talk to our team about your election operation.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-8 space-y-6">
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="fullName" className="text-white font-semibold">Full Name *</Label>
                <Input
                  id="fullName"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  placeholder="Jane Wanjiku"
                />
              </div>
              <div>
                <Label htmlFor="email" className="text-white font-semibold">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  placeholder="jane@campaign.ke"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="organisation" className="text-white font-semibold">Campaign/Organisation *</Label>
                <Input
                  id="organisation"
                  required
                  value={formData.organisation}
                  onChange={(e) => setFormData({ ...formData, organisation: e.target.value })}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  placeholder="Wanjiku for Governor"
                />
              </div>
              <div>
                <Label htmlFor="electionLevel" className="text-white font-semibold">Election Level *</Label>
                <Select
                  required
                  value={formData.electionLevel}
                  onValueChange={(val) => setFormData({ ...formData, electionLevel: val })}
                >
                  <SelectTrigger id="electionLevel" className="bg-white/10 border-white/20 text-white">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {ELECTION_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="message" className="text-white font-semibold">Message (optional)</Label>
              <Textarea
                id="message"
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 resize-none"
                placeholder="Tell us about your campaign operation…"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={enquiry.isPending}
              className="w-full bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold h-12"
            >
              {enquiry.isPending ? "Sending…" : "Request Access"}
            </Button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-white/10 bg-black/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-6 w-6 text-[hsl(25,95%,55%)]" />
                <span className="text-xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>Debe</span>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">
                The election operations platform Kenyan campaigns trust when results cannot fail.
              </p>
            </div>
            <div>
              <div className="font-bold text-sm uppercase tracking-wider mb-4">Product</div>
              <div className="space-y-2 text-sm">
                <Link href="/pricing" className="block text-white/70 hover:text-white transition-colors">Pricing</Link>
                <a href="#contact" className="block text-white/70 hover:text-white transition-colors">Contact Sales</a>
              </div>
            </div>
            <div>
              <div className="font-bold text-sm uppercase tracking-wider mb-4">Platform</div>
              <div className="space-y-2 text-sm">
                <Link href="/sign-in" className="block text-white/70 hover:text-white transition-colors">Sign In</Link>
                <Link href="/register/campaign" className="block text-white/70 hover:text-white transition-colors">Register your campaign</Link>
              </div>
            </div>
            <div>
              <div className="font-bold text-sm uppercase tracking-wider mb-4">Legal</div>
              <div className="space-y-2 text-sm">
                <Link href="/privacy" className="block text-white/70 hover:text-white transition-colors">Privacy Policy</Link>
                <span className="block text-white/40">Terms of Service</span>
                <span className="block text-white/40">Data Protection</span>
              </div>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 text-center text-sm text-white/50">
            © {new Date().getFullYear()} Debe. Election operations platform for Kenyan campaigns.
          </div>
        </div>
      </footer>
    </div>
  );
}
