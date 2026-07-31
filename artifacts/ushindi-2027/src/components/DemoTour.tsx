/**
 * DemoTour — 6-step guided product walkthrough for Ushindi election platform
 *
 * USAGE:
 * 1. Mount <DemoTour /> once in AppLayout (already done)
 * 2. Auto-starts once when VITE_DEMO_MODE=true and user hasn't seen it
 * 3. Programmatic start from any component:
 *
 *    import { useDemoTour } from "@/components/DemoTour";
 *
 *    function MyComponent() {
 *      const tour = useDemoTour();
 *      return <Button onClick={tour.start}>Take Tour</Button>;
 *    }
 *
 * FEATURES:
 * - Spotlight overlay with smooth transitions
 * - Auto-navigation to required routes
 * - Keyboard support (Escape, Arrow keys)
 * - Respects prefers-reduced-motion
 * - Persists completion to localStorage
 * - Gracefully skips steps if elements don't appear within 5s
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { X, ChevronLeft, ChevronRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Tour Step Definition ─────────────────────────────────────────────────────

interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector or data-tour attribute value */
  target: string;
  /** Route required before showing this step */
  route?: string;
  /** Tooltip position preference */
  position?: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    title: "Command Centre Dashboard",
    body: "Your campaign at a glance. Monitor volunteers, supporters, finance, and field operations in real-time.",
    target: '[data-tour="dashboard"]',
    route: "/dashboard",
    position: "right",
  },
  {
    id: "polling-stations",
    title: "Polling Station Coverage",
    body: "Track every polling station across all 47 counties. Identify coverage gaps and deploy agents strategically.",
    target: '[data-tour="polling-stations"]',
    route: "/polling-stations",
    position: "right",
  },
  {
    id: "polling-agents",
    title: "Field Agents on the Ground",
    body: "Manage your polling agents, track their deployment status, and verify their training completion.",
    target: '[data-tour="polling-agents"]',
    route: "/polling-agents",
    position: "right",
  },
  {
    id: "results",
    title: "Form 34A Verification",
    body: "Every result submission is captured, verified against scanned Form 34A documents, and flagged for discrepancies—before tallying begins.",
    target: '[data-tour="results"]',
    route: "/election-results",
    position: "right",
  },
  {
    id: "tally",
    title: "Live National Tally",
    body: "Watch results aggregate in real-time from polling stations to constituencies, counties, and the national count. Drill down to any level.",
    target: '[data-tour="tally"]',
    route: "/tally",
    position: "right",
  },
  {
    id: "transparency",
    title: "Public Transparency Portal",
    body: "Build trust with voters. Every verified result is published to a public portal with full audit trails and downloadable reports.",
    target: '[data-tour="transparency"]',
    route: "/transparency-portal",
    position: "right",
  },
];

const TOUR_STORAGE_KEY = "ushindi-tour-completed";
const TOUR_AUTO_START_DELAY = 1500; // Wait 1.5s after app load before auto-starting
const ELEMENT_WAIT_TIMEOUT = 5000; // Wait max 5s for an element before skipping

// ── Hook: useDemoTour ────────────────────────────────────────────────────────
//
// Use this hook in any component to programmatically start the tour:
//
//   const tour = useDemoTour();
//   <Button onClick={tour.start}>Start Tour</Button>
//

interface UseDemoTourReturn {
  /** Programmatically start the tour from step 1 */
  start: () => void;
  /** Whether the tour is currently active */
  isActive: boolean;
  /** Reset completion state so tour can auto-start again (dev/testing only) */
  reset: () => void;
}

let globalTourController: {
  start: () => void;
  subscribe: (listener: (active: boolean) => void) => () => void;
} | null = null;

export function useDemoTour(): UseDemoTourReturn {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!globalTourController) return;
    return globalTourController.subscribe(setIsActive);
  }, []);

  const start = useCallback(() => {
    if (globalTourController) {
      globalTourController.start();
    }
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  }, []);

  return { start, isActive, reset };
}

// ── Component: DemoTour ──────────────────────────────────────────────────────

export default function DemoTour() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const frameRef = useRef<number | null>(null);
  const waitTimeoutRef = useRef<number | null>(null);
  const autoStartTimeoutRef = useRef<number | null>(null);
  const listenersRef = useRef<Set<(active: boolean) => void>>(new Set());

  // Check prefers-reduced-motion
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Auto-start in demo mode if not completed
  useEffect(() => {
    const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";
    const completed = localStorage.getItem(TOUR_STORAGE_KEY) === "true";

    if (isDemoMode && !completed) {
      autoStartTimeoutRef.current = window.setTimeout(() => {
        setCurrentStep(0);
      }, TOUR_AUTO_START_DELAY);
    }

    return () => {
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }
    };
  }, []);

  // Register global controller
  useEffect(() => {
    globalTourController = {
      start: () => {
        setCurrentStep(0);
      },
      subscribe: (listener: (active: boolean) => void) => {
        listenersRef.current.add(listener);
        listener(currentStep !== null);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
    return () => {
      globalTourController = null;
    };
  }, [currentStep]);

  // Notify listeners when active state changes
  useEffect(() => {
    const isActive = currentStep !== null;
    listenersRef.current.forEach((listener) => listener(isActive));
  }, [currentStep]);

  const isActive = currentStep !== null;

  // Position tooltip and spotlight around target element
  const updatePositions = useCallback(() => {
    if (currentStep === null) return;

    const step = TOUR_STEPS[currentStep];
    const target = document.querySelector(step.target);

    if (!target) {
      // Element not found — will be handled by wait timeout
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 8;
    const tooltipGap = 16;
    const tooltipMaxWidth = 360;

    // Spotlight cutout
    setSpotlightStyle({
      position: "fixed",
      top: `${rect.top - padding}px`,
      left: `${rect.left - padding}px`,
      width: `${rect.width + padding * 2}px`,
      height: `${rect.height + padding * 2}px`,
      pointerEvents: "none",
      zIndex: 9998,
      transition: prefersReducedMotion ? "none" : "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    });

    // Tooltip positioning
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let top = 0;
    let left = 0;

    const preferredPosition = step.position ?? "bottom";

    switch (preferredPosition) {
      case "top":
        top = rect.top - padding - tooltipGap;
        left = rect.left + rect.width / 2;
        // Flip to bottom if not enough space
        if (top < 100) {
          top = rect.bottom + padding + tooltipGap;
        }
        break;
      case "bottom":
        top = rect.bottom + padding + tooltipGap;
        left = rect.left + rect.width / 2;
        // Flip to top if not enough space
        if (top + 200 > viewportHeight) {
          top = rect.top - padding - tooltipGap;
        }
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - padding - tooltipGap;
        // Flip to right if not enough space
        if (left - tooltipMaxWidth < 0) {
          left = rect.right + padding + tooltipGap;
        }
        break;
      case "right":
      default:
        top = rect.top + rect.height / 2;
        left = rect.right + padding + tooltipGap;
        // Flip to left if not enough space
        if (left + tooltipMaxWidth > viewportWidth) {
          left = rect.left - padding - tooltipGap;
        }
        break;
    }

    setTooltipStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      transform: "translate(-50%, -50%)",
      zIndex: 9999,
      maxWidth: `${tooltipMaxWidth}px`,
      transition: prefersReducedMotion ? "none" : "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    });
  }, [currentStep, prefersReducedMotion]);

  // Wait for element and navigate if needed
  useEffect(() => {
    if (currentStep === null) return;

    const step = TOUR_STEPS[currentStep];

    // Navigate to required route
    if (step.route) {
      setLocation(step.route);
    }

    // Wait for element to appear
    const checkElement = () => {
      const target = document.querySelector(step.target);
      if (target) {
        // Element found — scroll into view and position tooltip
        target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
        if (waitTimeoutRef.current) {
          clearTimeout(waitTimeoutRef.current);
          waitTimeoutRef.current = null;
        }
        updatePositions();
      } else {
        // Element not found — keep checking
        frameRef.current = requestAnimationFrame(checkElement);
      }
    };

    // Start checking
    checkElement();

    // Timeout fallback — skip step if element never appears
    waitTimeoutRef.current = window.setTimeout(() => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // Skip to next step
      if (currentStep < TOUR_STEPS.length - 1) {
        setCurrentStep((s) => (s !== null ? s + 1 : null));
      } else {
        end();
      }
    }, ELEMENT_WAIT_TIMEOUT);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      if (waitTimeoutRef.current) {
        clearTimeout(waitTimeoutRef.current);
      }
    };
  }, [currentStep, setLocation, prefersReducedMotion, updatePositions]);

  // Update positions on scroll/resize
  useEffect(() => {
    if (currentStep === null) return;

    const handler = () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(updatePositions);
    };

    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);

    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [currentStep, updatePositions]);

  const next = useCallback(() => {
    setCurrentStep((current) => {
      if (current === null) return null;
      if (current < TOUR_STEPS.length - 1) {
        return current + 1;
      } else {
        localStorage.setItem(TOUR_STORAGE_KEY, "true");
        return null;
      }
    });
  }, []);

  const back = useCallback(() => {
    setCurrentStep((current) => {
      if (current === null) return null;
      if (current > 0) {
        return current - 1;
      }
      return current;
    });
  }, []);

  const end = useCallback(() => {
    setCurrentStep(null);
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (currentStep === null) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        end();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        back();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentStep, next, back, end]);

  if (!isActive) return null;

  const step = TOUR_STEPS[currentStep];

  return (
    <>
      {/* Backdrop with spotlight cutout */}
      <div
        className="fixed inset-0 z-[9997] pointer-events-none"
        style={{
          background: "rgba(0, 0, 0, 0.7)",
          transition: prefersReducedMotion ? "none" : "background 0.4s ease",
        }}
      >
        {/* Spotlight */}
        <div
          style={spotlightStyle}
          className="rounded-sm shadow-2xl"
        >
          <div className="absolute inset-0 rounded-sm ring-4 ring-primary ring-offset-2 ring-offset-black/50" />
        </div>
      </div>

      {/* Tooltip */}
      <div
        style={tooltipStyle}
        className={cn(
          "bg-card border border-border rounded-md shadow-2xl p-6 pointer-events-auto",
          "w-full max-w-[360px]"
        )}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="text-xs font-black tracking-widest text-muted-foreground uppercase">
            Step {currentStep + 1} of {TOUR_STEPS.length}
          </div>
          <button
            onClick={end}
            className="text-muted-foreground hover:text-foreground transition-colors -mt-1 -mr-1"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="text-lg font-bold text-foreground mb-2 leading-tight">
          {step.title}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {step.body}
        </p>

        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={end}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5"
          >
            <SkipForward className="h-4 w-4" />
            Skip Tour
          </Button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button
                onClick={back}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button
              onClick={next}
              size="sm"
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {currentStep < TOUR_STEPS.length - 1 ? "Next" : "Finish"}
              {currentStep < TOUR_STEPS.length - 1 && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
