/**
 * DemoLaunch — what `/?demo=1` renders.
 *
 * A prospective customer should not have to create an account to look at the
 * product, so this exchanges a short-lived ticket from the API for a real
 * session in the read-only demo campaign and drops them straight into the
 * Command Centre, where the guided tour starts itself.
 *
 * If the demo cannot be started the visitor is told plainly and offered the
 * two things that still work — registering, and signing in — rather than being
 * left on a spinner.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
// The legacy hook, not the signals one: this flow needs the classic
// signIn.create({ strategy: "ticket" }) + setActive pair.
import { useSignIn } from "@clerk/react/legacy";
import { Loader2, AlertTriangle } from "lucide-react";
import { useDemoTour } from "./DemoTourProvider";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const GENERIC_ERROR =
  "The live demo could not be started. Please try again shortly, or register a campaign.";

export default function DemoLaunch() {
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const [, navigate] = useLocation();
  const { startTour } = useDemoTour();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userLoaded || !signInLoaded || startedRef.current) return;
    startedRef.current = true;

    // Arriving through the demo link means "show me the product", so the tour
    // is started from the beginning even if this session has already seen it.
    // This goes through the context rather than storage: the provider holds
    // the live state, and writing to localStorage underneath it would simply
    // be overwritten. The overlay stays hidden until the visitor is actually
    // inside the demo campaign, so starting it before sign-in is safe.
    startTour();

    (async () => {
      try {
        // Already signed in (a returning demo visitor, or a real user who
        // followed the link): no new session needed.
        if (isSignedIn) {
          navigate("/dashboard", { replace: true });
          return;
        }

        const res = await fetch(`${BASE}/api/demo/session`, { credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || GENERIC_ERROR);
        if (!signIn || !setActive) throw new Error(GENERIC_ERROR);

        const attempt = await signIn.create({ strategy: "ticket", ticket: body.ticket });
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          throw new Error(GENERIC_ERROR);
        }

        await setActive({ session: attempt.createdSessionId });
        navigate("/dashboard", { replace: true });
      } catch (err: any) {
        setError(typeof err?.message === "string" && err.message ? err.message : GENERIC_ERROR);
      }
    })();
  }, [userLoaded, signInLoaded, isSignedIn, signIn, setActive, navigate, startTour]);

  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-6 text-center bg-background">
        <div className="flex items-center justify-center h-14 w-14 rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="space-y-2 max-w-md">
          <h1 className="text-xl font-black tracking-tight text-foreground">
            Demo unavailable
          </h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register/campaign"
            className="bg-primary text-primary-foreground font-black text-xs tracking-widest uppercase px-5 py-3 rounded-sm hover:bg-primary/90 transition-colors"
          >
            Register a campaign
          </Link>
          <Link
            href="/sign-in"
            className="border border-border font-bold text-xs tracking-widest uppercase px-5 py-3 rounded-sm hover:bg-muted/50 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <div className="space-y-1">
        <p className="font-black tracking-tight text-foreground">Preparing your live demo…</p>
        <p className="text-sm text-muted-foreground">
          Signing you into a read-only campaign — no account needed.
        </p>
      </div>
    </div>
  );
}
