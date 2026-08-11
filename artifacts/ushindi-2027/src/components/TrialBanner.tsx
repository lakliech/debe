import { useState, useEffect } from "react";
import { X, AlertTriangle, Sparkles, Clock, CreditCard, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useCheckout, type SubscriptionSummary } from "@/hooks/useCheckout";

type BannerState = "trial-fresh" | "trial-warn" | "trial-urgent" | "trial-critical" | "payment-issue" | "free-tier";

function getBannerState(data: SubscriptionSummary): BannerState | null {
  // Healthy paid subscription — no banner
  if (!data.isTrial && data.subscriptionStatus === "active") return null;

  // Payment issues
  if (data.subscriptionStatus === "past_due" || data.subscriptionStatus === "unpaid") {
    return "payment-issue";
  }

  // Trial states
  if (data.isTrial) {
    const daysLeft = data.trialDaysLeft ?? 0;
    if (daysLeft <= 1) return "trial-critical";
    if (daysLeft <= 3) return "trial-urgent";
    if (daysLeft <= 7) return "trial-warn";
    return "trial-fresh";
  }

  // Free tier (trial exhausted, no subscription)
  if (data.plan === "free" && data.trialUsed) {
    return "free-tier";
  }

  return null;
}

function getStateKey(state: BannerState): string {
  return `trial-banner-dismissed-${state}`;
}

export default function TrialBanner() {
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const {
    subscription: data,
    canPurchase,
    canManageSubscription,
    startCheckout,
    openPortal,
    isPending,
  } = useCheckout();
  const isError = !data;

  // Load dismissed states from sessionStorage
  useEffect(() => {
    const stored: Record<string, boolean> = {};
    ["trial-fresh", "trial-warn", "trial-urgent", "trial-critical", "payment-issue", "free-tier"].forEach((key) => {
      if (sessionStorage.getItem(getStateKey(key as BannerState)) === "true") {
        stored[key] = true;
      }
    });
    setDismissed(stored);
  }, []);

  if (isError || !data) return null;

  const state = getBannerState(data);
  if (!state) return null;
  if (dismissed[state]) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(getStateKey(state), "true");
    setDismissed((prev) => ({ ...prev, [state]: true }));
  };

  const daysLeft = data.trialDaysLeft ?? 0;

  // What the CTA actually does. A past-due card is fixed on the Stripe portal;
  // every other state is fixed by subscribing. Null means the caller has no
  // billing rights (or the deployment has no Stripe), so the banner falls back
  // to a link into the plan tab rather than a button that would fail.
  const action: { run: () => void } | null =
    state === "payment-issue"
      ? canManageSubscription
        ? { run: openPortal }
        : null
      : canPurchase
        ? { run: () => startCheckout("pro") }
        : null;

  // Banner configurations
  const configs: Record<BannerState, { icon: React.ElementType; bg: string; border: string; text: string; iconColor: string; message: string; cta: string }> = {
    "trial-fresh": {
      icon: Sparkles,
      bg: "bg-primary/5",
      border: "border-primary/20",
      text: "text-primary",
      iconColor: "text-primary",
      message: `${daysLeft} days left in your free trial. Explore all features risk-free.`,
      cta: "View Plans",
    },
    "trial-warn": {
      icon: Clock,
      bg: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-900",
      iconColor: "text-amber-600",
      message: `Your trial ends in ${daysLeft} days. Upgrade to keep full access.`,
      cta: "Upgrade Now",
    },
    "trial-urgent": {
      icon: AlertTriangle,
      bg: "bg-orange-50",
      border: "border-orange-300",
      text: "text-orange-900",
      iconColor: "text-orange-600",
      message: `Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left! Upgrade now to avoid interruption.`,
      cta: "Upgrade Now",
    },
    "trial-critical": {
      icon: AlertTriangle,
      bg: "bg-red-50",
      border: "border-red-300",
      text: "text-red-900",
      iconColor: "text-red-600",
      message: daysLeft === 0
        ? "Your trial has ended. Upgrade to restore access."
        : "Trial ends today! Upgrade immediately to continue.",
      cta: "Upgrade Now",
    },
    "payment-issue": {
      icon: CreditCard,
      bg: "bg-red-50",
      border: "border-red-300",
      text: "text-red-900",
      iconColor: "text-red-600",
      // The grace window is what makes this survivable mid-campaign: access is
      // not cut the moment a card fails, so say so rather than implying the
      // lights are already off.
      message: "Payment failed. Update your payment method within 7 days to keep full access.",
      cta: "Update Payment",
    },
    "free-tier": {
      icon: Sparkles,
      bg: "bg-muted/50",
      border: "border-border",
      text: "text-muted-foreground",
      iconColor: "text-muted-foreground",
      message: "You're on the free plan. Upgrade for advanced features and priority support.",
      cta: "View Plans",
    },
  };

  const config = configs[state];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3 border-b transition-all animate-in slide-in-from-top-2 duration-500",
        config.bg,
        config.border
      )}
      data-testid={`banner-${state}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("h-5 w-5 shrink-0", config.iconColor)} />
        <p className={cn("text-sm font-semibold", config.text)}>
          {config.message}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/*
          A failed payment is fixed on Stripe's own portal (new card), and an
          expiring trial is fixed by paying — both are one hosted page away, so
          the CTA goes straight there for admins who can act. Everyone else
          keeps the link to the plan tab, which explains the state without
          offering a button that would 403.
        */}
        {action ? (
          <button
            onClick={action.run}
            disabled={isPending}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider hover:underline disabled:opacity-50",
              config.text,
            )}
            data-testid="button-upgrade"
          >
            {config.cta}
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </button>
        ) : (
          <Link href="/settings?tab=plan" className={cn("text-xs font-black uppercase tracking-wider hover:underline", config.text)} data-testid="link-upgrade">
            {config.cta}
          </Link>
        )}
        <button
          onClick={handleDismiss}
          className={cn("p-1 rounded-sm hover:bg-black/5 transition-colors", config.text)}
          aria-label="Dismiss"
          data-testid="button-dismiss-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
