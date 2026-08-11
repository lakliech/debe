import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Show, useUser } from "@clerk/react";
import {
  CheckCircle2, ArrowRight, Shield, Zap, Loader2, AlertCircle, Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
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

interface PlansResponse {
  plans: Plan[];
  billingEnabled: boolean;
}

interface SubscriptionResponse {
  plan: string;
  storedPlan: string | null;
  planLabel: string;
  isTrial: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  subscriptionStatus: string | null;
  hasActiveSubscription: boolean;
  billingEmail: string | null;
  billingEnabled: boolean;
  limits: {
    maxAgents: number | null;
    maxStations: number | null;
  };
  catalogue: any;
}

export default function Pricing() {
  const { toast } = useToast();
  const { user } = useUser();
  const [, setLocation] = useLocation();

  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"free" | "pro" | "enterprise" | null>(null);
  const [billingEmail, setBillingEmail] = useState("");

  const { data: plansData, isLoading: plansLoading } = useQuery<PlansResponse>({
    queryKey: ["/api/billing/plans"],
    queryFn: () => apiFetch("/api/billing/plans"),
  });

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionResponse>({
    queryKey: ["/api/billing/subscription"],
    queryFn: () => apiFetch("/api/billing/subscription"),
    enabled: !!user,
  });

  const checkout = useMutation({
    mutationFn: ({ tier, email }: { tier: string; email: string }) =>
      apiFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, billingEmail: email }),
      }),
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({
        title: "Checkout failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const portal = useMutation({
    mutationFn: () =>
      apiFetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({
        title: "Portal access failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleUpgrade = (tier: "free" | "pro" | "enterprise") => {
    if (!user) {
      setLocation("/sign-up");
      return;
    }

    if (tier === "enterprise") {
      window.location.href = "#contact";
      return;
    }

    setSelectedTier(tier);
    setBillingEmail(subscription?.billingEmail || user.primaryEmailAddress?.emailAddress || "");
    setCheckoutDialogOpen(true);
  };

  const handleCheckout = () => {
    if (!selectedTier || !billingEmail.trim()) return;
    checkout.mutate({ tier: selectedTier, email: billingEmail });
  };

  const plans = plansData?.plans ?? [];
  const billingEnabled = plansData?.billingEnabled ?? false;
  const currentPlan = subscription?.plan;
  const isTrial = subscription?.isTrial ?? false;
  const trialDaysLeft = subscription?.trialDaysLeft ?? null;

  return (
    <div className="min-h-[100dvh] bg-[hsl(160,70%,28%)] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[hsl(160,70%,28%)]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/platform-home" className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-[hsl(25,95%,55%)]" />
            <span className="text-xl font-black tracking-tight" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Debe
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/platform-home" className="text-sm font-semibold text-white/80 hover:text-white transition-colors">
              Home
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
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-6xl font-black tracking-tight mb-6" style={{ fontFamily: "'Clash Display', sans-serif" }}>
            Pricing that scales<br />
            <span className="text-[hsl(25,95%,55%)]">with your campaign</span>
          </h1>
          <p className="text-xl text-white/70 max-w-2xl mx-auto">
            Start free. Scale when you're ready. No surprises, no hidden fees.
          </p>
        </div>
      </section>

      {/* Current plan banner (signed-in users) */}
      {user && !subLoading && subscription && (
        <section className="px-6 pb-12">
          <div className="max-w-5xl mx-auto">
            <Alert className="bg-[hsl(25,95%,55%)]/20 border-[hsl(25,95%,55%)]/40 text-white">
              <Crown className="h-5 w-5 text-[hsl(25,95%,55%)]" />
              <AlertDescription className="font-semibold">
                You're currently on the <span className="font-black">{subscription.planLabel}</span> plan.
                {isTrial && trialDaysLeft !== null && (
                  <span className="ml-1">
                    ({trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left in trial)
                  </span>
                )}
                {subscription.hasActiveSubscription && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => portal.mutate()}
                    disabled={portal.isPending}
                    className="ml-4 text-white underline underline-offset-2 p-0 h-auto font-bold"
                  >
                    {portal.isPending ? "Loading…" : "Manage subscription"}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          </div>
        </section>
      )}

      {/* Plans grid */}
      <section className="px-6 pb-24">
        <div className="max-w-7xl mx-auto">
          {plansLoading ? (
            <div className="grid lg:grid-cols-3 gap-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[600px] rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-8">
              {plans.map((plan) => {
                const isCurrent = currentPlan === plan.tier;
                const isRecommended = plan.tier === "pro";

                return (
                  <div
                    key={plan.tier}
                    className={cn(
                      "bg-white/5 backdrop-blur-sm border rounded-lg p-8 flex flex-col relative",
                      isRecommended
                        ? "border-[hsl(25,95%,55%)] shadow-lg shadow-[hsl(25,95%,55%)]/20 scale-105"
                        : "border-white/10"
                    )}
                  >
                    {isRecommended && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-[hsl(25,95%,55%)] text-white text-xs font-black uppercase tracking-wider rounded-full">
                        Recommended
                      </div>
                    )}

                    <div className="mb-8">
                      <div className="text-sm font-bold uppercase tracking-wider text-white/70 mb-2">
                        {plan.label}
                      </div>
                      <div className="mb-4">
                        {plan.priceMonthlyKes === null ? (
                          <div className="text-4xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>
                            Custom
                          </div>
                        ) : plan.priceMonthlyKes === 0 ? (
                          <div className="text-4xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>
                            Free
                          </div>
                        ) : (
                          <>
                            <span className="text-4xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>
                              KES {plan.priceMonthlyKes.toLocaleString()}
                            </span>
                            <span className="text-white/60 text-lg">/month</span>
                          </>
                        )}
                      </div>
                      <p className="text-white/70 text-sm leading-relaxed">{plan.description}</p>
                    </div>

                    <div className="mb-8 space-y-3 flex-1">
                      {plan.features.map((feat, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 text-[hsl(25,95%,55%)] shrink-0 mt-0.5" />
                          <span className="text-white/90 text-sm">{feat}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {isCurrent ? (
                        <Button
                          variant="outline"
                          size="lg"
                          disabled
                          className="w-full bg-white/10 border-white/20 text-white font-semibold"
                        >
                          Current Plan
                        </Button>
                      ) : plan.tier === "free" ? (
                        // Free needs no sales conversation and no checkout —
                        // signing up IS the upgrade path. A signed-in campaign
                        // on a paid tier has to talk to us before dropping
                        // features, so route them to contact instead.
                        user ? (
                          <a href="#contact">
                            <Button
                              size="lg"
                              className="w-full bg-white/10 hover:bg-white/20 text-white font-bold border border-white/20"
                            >
                              Contact Us to Downgrade
                            </Button>
                          </a>
                        ) : (
                          <Button
                            size="lg"
                            onClick={() => setLocation("/sign-up")}
                            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold border border-white/20"
                            data-testid="button-get-started-free"
                          >
                            Get Started Free
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        )
                      ) : plan.tier === "enterprise" ? (
                        <a href="#contact">
                          <Button
                            size="lg"
                            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold border border-white/20"
                          >
                            Contact Sales
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </a>
                      ) : !billingEnabled ? (
                        <a href="#contact">
                          <Button
                            size="lg"
                            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold border border-white/20"
                          >
                            Contact Us to Upgrade
                          </Button>
                        </a>
                      ) : (
                        <Button
                          size="lg"
                          onClick={() => handleUpgrade(plan.tier)}
                          className={cn(
                            "w-full font-bold",
                            isRecommended
                              ? "bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)]"
                              : "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                          )}
                        >
                          {user ? "Upgrade Now" : "Start Free Trial"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      )}

                      {plan.maxAgents !== null && plan.maxStations !== null && (
                        <div className="text-xs text-white/50 text-center pt-2">
                          Up to {plan.maxAgents} agents · {plan.maxStations} stations
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Trust section */}
      <section className="py-16 px-6 bg-black/20 border-y border-white/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-black tracking-tight text-center mb-12" style={{ fontFamily: "'Clash Display', sans-serif" }}>
            Built for reliability. Priced for campaigns.
          </h2>
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-14 h-14 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Shield className="h-7 w-7 text-[hsl(25,95%,55%)]" />
              </div>
              <h3 className="font-bold text-lg mb-2">99.8% Uptime SLA</h3>
              <p className="text-white/70 text-sm">
                Redundant infrastructure ensures your platform stays online when it matters most.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Zap className="h-7 w-7 text-[hsl(25,95%,55%)]" />
              </div>
              <h3 className="font-bold text-lg mb-2">24/7 Election Day Support</h3>
              <p className="text-white/70 text-sm">
                Dedicated team on standby from 48 hours before polls open until results are certified.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-[hsl(25,95%,55%)]/20 border border-[hsl(25,95%,55%)]/40 rounded-lg flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-7 w-7 text-[hsl(25,95%,55%)]" />
              </div>
              <h3 className="font-bold text-lg mb-2">No Hidden Fees</h3>
              <p className="text-white/70 text-sm">
                Flat monthly fee. No per-agent charges, no overage fees, no surprise invoices.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-black tracking-tight text-center mb-12" style={{ fontFamily: "'Clash Display', sans-serif" }}>
            Frequently asked questions
          </h2>
          <div className="space-y-6">
            {[
              {
                q: "How does the free trial work?",
                a: "Start with full platform access for 14 days. No credit card required. Test polling operations, import your station registry, and onboard agents. Upgrade to Pro when you're ready to scale.",
              },
              {
                q: "What happens if I exceed my plan limits?",
                a: "We'll notify you when you're approaching limits. You can upgrade to a higher tier at any time — no downtime, no data migration required.",
              },
              {
                q: "Can I switch plans mid-campaign?",
                a: "Yes. Upgrade or downgrade anytime. Changes take effect immediately. Billing is prorated automatically.",
              },
              {
                q: "What's included in election-day support?",
                a: "Dedicated support team available 24/7 via phone, WhatsApp, and email from 48 hours before polls open until final results are certified. Pro and Enterprise plans only.",
              },
              {
                q: "Is my campaign data secure?",
                a: "Yes. Multi-tenant isolation, encrypted at rest and in transit, automated backups every 6 hours, ISO 27001 certified infrastructure, and full audit trails.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. No lock-in contracts. Cancel before your next billing cycle and you won't be charged. Your data remains accessible for 30 days after cancellation.",
              },
            ].map((faq, i) => (
              <div key={i} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-6">
                <h3 className="font-bold text-lg mb-2">{faq.q}</h3>
                <p className="text-white/70 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="py-24 px-6 bg-black/20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-black tracking-tight mb-6" style={{ fontFamily: "'Clash Display', sans-serif" }}>
            Ready to get started?
          </h2>
          <p className="text-xl text-white/70 mb-8">
            Start your free trial today or talk to our team about your campaign operation.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Show when="signed-out">
              <Link href="/sign-up">
                <Button size="lg" className="bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold h-12 px-8">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard">
                <Button size="lg" className="bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold h-12 px-8">
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </Show>
            <Link href="/platform-home#contact">
              <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 h-12 px-8 font-semibold">
                Contact Sales
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-white/10 bg-black/30">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-4 gap-8 mb-8">
            <div>
              <Link href="/platform-home" className="flex items-center gap-2 mb-4">
                <Shield className="h-6 w-6 text-[hsl(25,95%,55%)]" />
                <span className="text-xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>Debe</span>
              </Link>
              <p className="text-sm text-white/60 leading-relaxed">
                The election operations platform Kenyan campaigns trust when results cannot fail.
              </p>
            </div>
            <div>
              <div className="font-bold text-sm uppercase tracking-wider mb-4">Product</div>
              <div className="space-y-2 text-sm">
                <Link href="/pricing" className="block text-white/70 hover:text-white transition-colors">Pricing</Link>
                <Link href="/platform-home#contact" className="block text-white/70 hover:text-white transition-colors">Contact Sales</Link>
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
                <span className="block text-white/40">Privacy Policy</span>
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

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="bg-[hsl(160,70%,28%)] border-white/20 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black" style={{ fontFamily: "'Clash Display', sans-serif" }}>
              Confirm Upgrade
            </DialogTitle>
            <DialogDescription className="text-white/70">
              You're upgrading to the <span className="font-bold">{selectedTier === "pro" ? "Pro" : "Free"}</span> plan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="billing-email" className="text-white font-semibold">Billing Email</Label>
              <Input
                id="billing-email"
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                placeholder="billing@campaign.ke"
              />
              <p className="text-xs text-white/60 mt-1">Invoices and receipts will be sent here.</p>
            </div>

            {checkout.isError && (
              <Alert className="bg-red-500/20 border-red-500/40 text-white">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {(checkout.error as Error).message}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setCheckoutDialogOpen(false)}
                className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20"
                disabled={checkout.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCheckout}
                className="flex-1 bg-[hsl(25,95%,55%)] text-white hover:bg-[hsl(25,95%,50%)] font-bold"
                disabled={checkout.isPending || !billingEmail.trim()}
              >
                {checkout.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    Continue to Checkout
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
