/**
 * NoActiveOrgPrompt — intercept shown to a multi-campaign consultant who
 * has signed in but not yet selected which campaign to work in.
 *
 * Condition: signed-in user belongs to 2+ campaigns, none active yet.
 * Single-org users never see this — the server auto-selects their only campaign.
 * Platform operators are excluded — they use the PlatformCampaignSwitcher instead.
 */

import { useState } from "react";
import { Building2, Check, ChevronRight, LogOut } from "lucide-react";
import { useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { useIdentity, type ActiveTenant } from "@/hooks/useIdentity";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NoActiveOrgPromptProps {
  /** The campaigns the caller belongs to — must have length >= 2. */
  campaigns: ActiveTenant[];
}

export function NoActiveOrgPrompt({ campaigns }: NoActiveOrgPromptProps) {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState<string | null>(null); // tenantId being activated

  const handleSelect = async (tenantId: string) => {
    if (busy) return;
    setBusy(tenantId);
    try {
      const res = await fetch(`${BASE}/api/users/me/active-campaign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        // Hard reload so every query is re-scoped to the selected campaign.
        window.location.assign(`${BASE}/dashboard`);
      } else {
        setBusy(null);
      }
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Icon */}
        <div className="flex items-center justify-center h-14 w-14 rounded-full bg-primary/10 text-primary mx-auto">
          <Building2 className="h-7 w-7" />
        </div>

        {/* Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Select a campaign to continue
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            You belong to multiple campaigns. Choose which one you want to work
            in — you can switch at any time from the top bar.
          </p>
        </div>

        {/* Campaign list */}
        <div className="border border-border rounded-sm divide-y divide-border bg-card shadow-sm overflow-hidden">
          {campaigns.map((c) => (
            <button
              key={c.id}
              disabled={busy !== null}
              onClick={() => handleSelect(c.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors disabled:opacity-60 group"
            >
              {/* Campaign avatar / initial */}
              <div className="flex-shrink-0 h-9 w-9 rounded-sm bg-primary/10 text-primary flex items-center justify-center font-bold text-sm uppercase select-none">
                {c.name.charAt(0)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-foreground truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground truncate">{c.slug}</div>
              </div>

              {/* Spinner while activating this one */}
              {busy === c.id ? (
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground transition-colors" />
              )}
            </button>
          ))}
        </div>

        {/* Sign-out escape hatch */}
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs gap-2 rounded-sm"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Drop-in gate: renders the prompt when the signed-in user belongs to
 * multiple campaigns but has not entered one yet; otherwise renders children.
 *
 * Usage (inside AppLayout, after identity has loaded):
 *   <MultiOrgGate>{children}</MultiOrgGate>
 */
export function MultiOrgGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, isPlatformOperator, activeTenant, campaigns } = useIdentity();

  // Not ready yet — let the parent decide what to render (e.g. nothing, spinner).
  if (!isLoaded || !isSignedIn) return <>{children}</>;

  // Platform operators use a different mechanism (PlatformCampaignSwitcher).
  if (isPlatformOperator) return <>{children}</>;

  // Single-org users: the server auto-activates their only membership.
  // Multi-org users who have already selected a campaign: normal flow.
  if (campaigns.length <= 1 || activeTenant) return <>{children}</>;

  // Multi-org, no active campaign → intercept.
  return <NoActiveOrgPrompt campaigns={campaigns} />;
}
