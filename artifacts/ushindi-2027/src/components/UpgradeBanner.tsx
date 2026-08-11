/**
 * Usage-based upgrade prompt for the command centre.
 *
 * Distinct from TrialBanner, which speaks about *time* (your trial ends in
 * three days). This one speaks about *capacity*: a campaign on a capped plan
 * that is close to its agent limit will have a create refused with a 402 mid
 * recruitment drive, and the last week before election day is the worst moment
 * to discover that. Warning at 80% gives them room to act.
 *
 * Renders nothing on an uncapped plan, or when there is no campaign context.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUpRight, Loader2, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCheckout } from "@/hooks/useCheckout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Warn once usage passes this share of the cap. */
const WARN_AT = 0.8;

interface PlanUsage {
  plan: "free" | "pro" | "enterprise";
  planLabel: string;
  isTrial: boolean;
  agents: number;
  stations: number;
  maxAgents: number | null;
  maxStations: number | null;
}

/** Dismissal is per usage band, so crossing into "full" speaks up again. */
function dismissKey(usage: PlanUsage, atCap: boolean): string {
  return `upgrade-banner-dismissed-${usage.plan}-agents-${atCap ? "full" : "near"}`;
}

export default function UpgradeBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { canPurchase, startCheckout, isPending } = useCheckout();

  const { data } = useQuery<PlanUsage>({
    queryKey: ["/api/billing/usage"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/billing/usage`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const cap = data?.maxAgents ?? null;
  const atCap = !!data && cap !== null && data.agents >= cap;
  const key = data ? dismissKey(data, atCap) : null;

  useEffect(() => {
    if (!key) return;
    setDismissed(sessionStorage.getItem(key) === "true");
  }, [key]);

  if (!data || cap === null) return null;
  if (data.agents < Math.floor(cap * WARN_AT)) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    if (key) sessionStorage.setItem(key, "true");
    setDismissed(true);
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3 mb-6 border rounded-sm",
        atCap
          ? "bg-amber-50 border-amber-300 text-amber-950"
          : "bg-primary/5 border-primary/30 text-foreground",
      )}
      data-testid={`banner-agent-cap-${atCap ? "full" : "near"}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <TrendingUp
          className={cn("h-5 w-5 shrink-0", atCap ? "text-amber-600" : "text-primary")}
        />
        <p className="text-sm font-semibold">
          {atCap
            ? `You've used all ${cap} polling agents on the ${data.planLabel} plan — upgrade to Pro for unlimited agents.`
            : `${data.agents} of ${cap} polling agents used — upgrade to Pro for unlimited.`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canPurchase ? (
          // Straight to Stripe Checkout — the campaign is being told it is out
          // of agents, so anything between the warning and paying for headroom
          // is a step too many.
          <button
            onClick={() => startCheckout("pro")}
            disabled={isPending}
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider hover:underline disabled:opacity-50"
            data-testid="button-upgrade-plan"
          >
            {isPending ? (
              <>
                Opening checkout <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </>
            ) : (
              <>
                Upgrade to Pro <ArrowUpRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        ) : (
          // Not an admin, or this deployment has no Stripe configured — send
          // them somewhere that explains the plans instead of a dead button.
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider hover:underline"
            data-testid="link-upgrade-plan"
          >
            See plans <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <button
          onClick={handleDismiss}
          className="p-1 rounded-sm hover:bg-black/5 transition-colors"
          aria-label="Dismiss"
          data-testid="button-dismiss-upgrade-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
