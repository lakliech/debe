/**
 * GuidedTour — the spotlight overlay and tooltip for one tour step.
 *
 * Purely presentational: the provider owns which step is current and what
 * happens at the end. This component navigates to the step's route, waits for
 * its target to appear, and draws the highlight.
 *
 * A step whose target never appears (a page the demo data leaves empty, a
 * layout that hides it on this viewport) is skipped rather than left holding
 * the visitor on a blank overlay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TourStep } from "./tour";

interface GuidedTourProps {
  step: TourStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const TOOLTIP_WIDTH = 340;
const TOOLTIP_HEIGHT_ESTIMATE = 210;
const GAP = 14;
const PADDING = 8;
const MARGIN = 16;
/** How long to wait for a step's target before giving up on that step. */
const TARGET_WAIT_MS = 5000;

type Box = { top: number; left: number; width: number; height: number };

export default function GuidedTour({
  step,
  stepIndex,
  stepCount,
  onNext,
  onBack,
  onSkip,
}: GuidedTourProps) {
  const [location, setLocation] = useLocation();
  const [spotlight, setSpotlight] = useState<Box | null>(null);
  const [tooltip, setTooltip] = useState<{ top: number; left: number }>({
    top: MARGIN,
    left: MARGIN,
  });
  const [reducedMotion, setReducedMotion] = useState(false);

  const rafRef = useRef<number | null>(null);
  /** Last geometry written to state, so a static target does not re-render. */
  const lastBoxRef = useRef<string>("");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /** Measure the target and place the spotlight and the tooltip around it. */
  const measure = useCallback((): boolean => {
    const target = document.querySelector(step.target);
    if (!target) return false;

    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const box: Box = {
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
    };

    // The measure loop runs every frame to track scrolling; writing state
    // unconditionally would re-render the overlay 60 times a second and make
    // the tooltip buttons hard to click.
    const signature = `${box.top}|${box.left}|${box.width}|${box.height}`;
    const unchanged = signature === lastBoxRef.current;
    if (unchanged) return true;
    lastBoxRef.current = signature;
    setSpotlight(box);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;

    switch (step.position ?? "bottom") {
      case "top":
        top = box.top - GAP - TOOLTIP_HEIGHT_ESTIMATE;
        left = box.left + box.width / 2 - TOOLTIP_WIDTH / 2;
        if (top < MARGIN) top = box.top + box.height + GAP;
        break;
      case "left":
        top = box.top + box.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2;
        left = box.left - GAP - TOOLTIP_WIDTH;
        if (left < MARGIN) left = box.left + box.width + GAP;
        break;
      case "right":
        top = box.top + box.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2;
        left = box.left + box.width + GAP;
        if (left + TOOLTIP_WIDTH > vw - MARGIN) left = box.left - GAP - TOOLTIP_WIDTH;
        break;
      case "bottom":
      default:
        top = box.top + box.height + GAP;
        left = box.left + box.width / 2 - TOOLTIP_WIDTH / 2;
        if (top + TOOLTIP_HEIGHT_ESTIMATE > vh - MARGIN) {
          top = box.top - GAP - TOOLTIP_HEIGHT_ESTIMATE;
        }
        break;
    }

    // Never let the tooltip leave the viewport — an off-screen Next button
    // would strand the visitor mid-tour.
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - TOOLTIP_HEIGHT_ESTIMATE - MARGIN));
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - TOOLTIP_WIDTH - MARGIN));
    setTooltip({ top, left });
    return true;
  }, [step.target, step.position]);

  // Navigate to the step's route. Compared first so re-measuring on scroll
  // does not push the visitor back to the same page repeatedly.
  useEffect(() => {
    if (!step.route) return;
    const [path] = step.route.split("?");
    if (location !== path) setLocation(step.route);
  }, [step.route, location, setLocation]);

  // Wait for the target, then keep the highlight glued to it.
  useEffect(() => {
    setSpotlight(null);
    lastBoxRef.current = "";
    let cancelled = false;
    let scrolled = false;

    // Armed before the first measure, and disarmed the moment the target is
    // found. Arming it afterwards would leave it running on every step whose
    // target is already in the DOM — silently advancing the tour on a timer.
    let giveUp: number | null = window.setTimeout(() => {
      if (!cancelled) onNext();
    }, TARGET_WAIT_MS);

    const poll = () => {
      if (cancelled) return;
      const found = measure();
      if (found) {
        if (giveUp !== null) {
          clearTimeout(giveUp);
          giveUp = null;
        }
        if (!scrolled) {
          scrolled = true;
          document
            .querySelector(step.target)
            ?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
        }
      }
      rafRef.current = requestAnimationFrame(poll);
    };
    poll();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (giveUp !== null) clearTimeout(giveUp);
    };
    // onNext is stable in the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, measure, reducedMotion]);

  // Keyboard: Escape skips, arrows move.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && stepIndex > 0) onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNext, onBack, onSkip, stepIndex]);

  const isLast = stepIndex === stepCount - 1;
  const transition = reducedMotion ? "none" : "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";

  return (
    <div className="fixed inset-0 z-[9990]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/*
        The dim layer is a single element with a huge spread shadow punching a
        hole where the spotlight sits — one box, no four-rectangle maths, and
        the cutout animates between steps for free.
      */}
      <div
        className="fixed rounded-md pointer-events-none"
        style={{
          top: spotlight?.top ?? window.innerHeight / 2,
          left: spotlight?.left ?? window.innerWidth / 2,
          width: spotlight?.width ?? 0,
          height: spotlight?.height ?? 0,
          boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.72)",
          outline: spotlight ? "2px solid hsl(var(--primary))" : "none",
          outlineOffset: "2px",
          transition,
        }}
      />

      <div
        className="fixed bg-card border border-border rounded-md shadow-2xl p-5"
        style={{ top: tooltip.top, left: tooltip.left, width: TOOLTIP_WIDTH, transition }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
            Step {stepIndex + 1} of {stepCount}
          </span>
          <button
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground transition-colors -mt-1 -mr-1"
            aria-label="Skip the tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="text-base font-black tracking-tight text-foreground mb-1.5">{step.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">{step.body}</p>

        <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
          {Array.from({ length: stepCount }).map((_, i) => (
            <span
              key={i}
              className={
                i <= stepIndex ? "h-1 flex-1 rounded-full bg-primary" : "h-1 flex-1 rounded-full bg-muted"
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 rounded-sm">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={onNext} className="gap-1.5 rounded-sm">
              {isLast ? "Finish" : "Next"}
              {!isLast && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
