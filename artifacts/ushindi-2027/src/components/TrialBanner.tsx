import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, Sparkles, Clock, CreditCard } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

interface SubscriptionData {
  isTrial: boolean;
  trialDaysLeft: number;
  trialUsed: boolean;
  subscriptionStatus: string | null;
  plan: string;
}

type BannerState = "trial-fresh" | "trial-warn" | "trial-urgent" | "trial-critical" | "payment-issue" | "free-tier";

function getBannerState(data: SubscriptionData): BannerState | null {
  // Healthy paid subscription — no banner
  if (!data.isTrial && data.subscriptionStatus === "active") return null;

  // Payment issues
  if (data.subscriptionStatus === "past_due" || data.subscriptionStatus === "unpaid") {
    return "payment-issue";
  }

  // Trial states
  if (data.isTrial) {
    if (data.trialDaysLeft <= 0) return "trial-critical";
    if (data.trialDaysLeft === 1) return "trial-critical";
    if (data.trialDaysLeft <= 3) return "trial-urgent";
    if (data.trialDaysLeft <= 7) return "trial-warn";
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

  const { data, isError } = useQuery<SubscriptionData>({
    queryKey: ["/api/billing/subscription"],
    queryFn: () => apiFetch("/api/billing/subscription"),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

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

  // Banner configurations
  const configs: Record<BannerState, { icon: React.ElementType; bg: string; border: string; text: string; iconColor: string; message: string; cta: string }> = {
    "trial-fresh": {
      icon: Sparkles,
      bg: "bg-primary/5",
      border: "border-primary/20",
      text: "text-primary",
      iconColor: "text-primary",
      message: `${data.trialDaysLeft} days left in your free trial. Explore all features risk-free.`,
      cta: "View Plans",
    },
    "trial-warn": {
      icon: Clock,
      bg: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-900",
      iconColor: "text-amber-600",
      message: `Your trial ends in ${data.trialDaysLeft} days. Upgrade to keep full access.`,
      cta: "Upgrade Now",
    },
    "trial-urgent": {
      icon: AlertTriangle,
      bg: "bg-orange-50",
      border: "border-orange-300",
      text: "text-orange-900",
      iconColor: "text-orange-600",
      message: `Only ${data.trialDaysLeft} day${data.trialDaysLeft === 1 ? "" : "s"} left! Upgrade now to avoid interruption.`,
      cta: "Upgrade Now",
    },
    "trial-critical": {
      icon: AlertTriangle,
      bg: "bg-red-50",
      border: "border-red-300",
      text: "text-red-900",
      iconColor: "text-red-600",
      message: data.trialDaysLeft === 0
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
      message: "Payment failed. Update your payment method to restore access.",
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
        <Link href="/settings?tab=plan" className={cn("text-xs font-black uppercase tracking-wider hover:underline", config.text)} data-testid="link-upgrade">
          {config.cta}
        </Link>
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
