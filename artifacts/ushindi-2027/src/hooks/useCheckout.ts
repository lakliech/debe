/**
 * Billing actions shared by every upgrade surface in the command centre.
 *
 * The two hosted Stripe pages (Checkout and the Billing Portal) are reached the
 * same way everywhere: ask the API for a session URL, then send the browser to
 * it. Centralising that here keeps the banners, the settings tab and any future
 * prompt behaving identically — one click, no intermediate page.
 *
 * Two things decide whether a direct purchase button should be shown at all:
 *   - the deployment has Stripe configured (`billingEnabled`), and
 *   - the caller is a campaign admin (level <= 1).
 * Both are advisory for the UI only; the API enforces them independently, so a
 * surface that gets this wrong gets a 403/503 rather than an unauthorised sale.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useIdentity } from "@/hooks/useIdentity";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Level 1 is the most privileged tenant role — see @/lib/access. */
const BILLING_ADMIN_LEVEL = 1;

export type PaidTier = "pro" | "enterprise";

export interface SubscriptionSummary {
  plan: "free" | "pro" | "enterprise";
  planLabel: string;
  isTrial: boolean;
  trialDaysLeft: number | null;
  trialUsed: boolean;
  subscriptionStatus: string | null;
  hasActiveSubscription: boolean;
  billingEmail: string | null;
  billingEnabled: boolean;
}

/** Shared cache key so the banners and settings tab hit one request, not three. */
export const subscriptionQueryKey = ["/api/billing/subscription"] as const;

async function post(path: string, body?: unknown): Promise<{ url: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `Request failed (${res.status})`);
  if (!payload.url) throw new Error("Stripe did not return a page to open.");
  return payload;
}

export function useSubscription() {
  return useQuery<SubscriptionSummary>({
    queryKey: subscriptionQueryKey,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/billing/subscription`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useCheckout() {
  const { toast } = useToast();
  const { access } = useIdentity();
  const { data: subscription } = useSubscription();

  const checkout = useMutation({
    mutationFn: (tier: PaidTier) => post("/api/billing/checkout", { tier }),
    // A full navigation, not a router push: the destination is Stripe's own
    // hosted page.
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) =>
      toast({ title: "Could not start checkout", description: err.message, variant: "destructive" }),
  });

  const portal = useMutation({
    mutationFn: () => post("/api/billing/portal"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) =>
      toast({ title: "Billing portal unavailable", description: err.message, variant: "destructive" }),
  });

  const billingEnabled = subscription?.billingEnabled ?? false;
  const isBillingAdmin = access.isLoaded && access.level <= BILLING_ADMIN_LEVEL;

  return {
    subscription,
    billingEnabled,
    isBillingAdmin,
    /** Show a one-click purchase button only when it can actually succeed. */
    canPurchase: billingEnabled && isBillingAdmin,
    /** Portal needs an existing Stripe customer, which only a subscriber has. */
    canManageSubscription: billingEnabled && isBillingAdmin && !!subscription?.subscriptionStatus,
    startCheckout: (tier: PaidTier = "pro") => checkout.mutate(tier),
    openPortal: () => portal.mutate(),
    isPending: checkout.isPending || portal.isPending,
  };
}
