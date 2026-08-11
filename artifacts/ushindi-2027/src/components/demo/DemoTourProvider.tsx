/**
 * DemoTourProvider — owns the guided tour's state and decides when it runs.
 *
 * Mounted once near the router so the tour survives page navigation: the
 * overlay is a sibling of the route tree, not part of any page.
 *
 * The tour only exists inside the demo campaign. A real customer's command
 * centre never renders it, which is why the gate is the active tenant's slug
 * rather than a build-time flag — one build serves every campaign.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useIdentity } from "@/hooks/useIdentity";
import GuidedTour from "./GuidedTour";
import DemoCompleteModal from "./DemoCompleteModal";
import { TOUR_STEPS, readTourState, writeTourState, type TourState } from "./tour";

/** The slug of the shared read-only demo campaign (see the API's demoGuard). */
const DEMO_SLUG = "demo";

interface DemoTourApi {
  /** True when the signed-in visitor is inside the demo campaign. */
  isDemo: boolean;
  isActive: boolean;
  stepIndex: number;
  stepCount: number;
  /**
   * Restart from step one.
   *
   * Used by the demo banner's button and by the demo launch screen, which is
   * the only thing that opens the tour unprompted. Nobody who reaches a demo
   * page another way — a shared link, a bookmark, a second tab — gets dragged
   * into the walkthrough; the banner offers it instead of forcing it.
   */
  startTour: () => void;
}

const DemoTourContext = createContext<DemoTourApi>({
  isDemo: false,
  isActive: false,
  stepIndex: 0,
  stepCount: TOUR_STEPS.length,
  startTour: () => {},
});

export function useDemoTour(): DemoTourApi {
  return useContext(DemoTourContext);
}

export function DemoTourProvider({ children }: { children: React.ReactNode }) {
  const { activeTenant } = useIdentity();
  const isDemo = activeTenant?.slug === DEMO_SLUG;

  const [state, setState] = useState<TourState>(() => readTourState());

  useEffect(() => {
    writeTourState(state);
  }, [state]);

  const startTour = useCallback(() => {
    setState((s) => ({ ...s, step: 0, status: "running", ctaDismissed: false }));
  }, []);

  const next = useCallback(() => {
    setState((s) =>
      s.step < TOUR_STEPS.length - 1
        ? { ...s, step: s.step + 1 }
        : { ...s, status: "finished", ctaDismissed: false },
    );
  }, []);

  const back = useCallback(() => {
    setState((s) => ({ ...s, step: Math.max(0, s.step - 1) }));
  }, []);

  // Skipping is still the end of the tour: the visitor has opted out of the
  // walkthrough, not out of the offer, so the CTA still gets its one showing.
  const skip = useCallback(() => {
    setState((s) => ({ ...s, status: "finished", ctaDismissed: false }));
  }, []);

  const dismissCta = useCallback(() => {
    setState((s) => ({ ...s, ctaDismissed: true }));
  }, []);

  const isActive = isDemo && state.status === "running";
  const showCta = isDemo && state.status === "finished" && !state.ctaDismissed;

  const api = useMemo<DemoTourApi>(
    () => ({
      isDemo,
      isActive,
      stepIndex: state.step,
      stepCount: TOUR_STEPS.length,
      startTour,
    }),
    [isDemo, isActive, state.step, startTour],
  );

  return (
    <DemoTourContext.Provider value={api}>
      {children}
      {isActive && (
        <GuidedTour
          step={TOUR_STEPS[state.step]}
          stepIndex={state.step}
          stepCount={TOUR_STEPS.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      )}
      {showCta && <DemoCompleteModal onClose={dismissCta} onRestart={startTour} />}
    </DemoTourContext.Provider>
  );
}
