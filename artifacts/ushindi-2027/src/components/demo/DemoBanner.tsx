/**
 * DemoBanner — persistent notice while a visitor is inside the shared demo
 * campaign, with the two things they should be able to do at any moment:
 * restart the guided tour, or register their own campaign.
 *
 * Not dismissible on purpose. The demo is read-only, and a visitor who forgets
 * that reads a blocked save as a broken product.
 */

import { Link } from "wouter";
import { ArrowRight, PlayCircle, Eye } from "lucide-react";
import { useDemoTour } from "./DemoTourProvider";

export default function DemoBanner() {
  const { isDemo, startTour } = useDemoTour();

  if (!isDemo) return null;

  return (
    <div className="shrink-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2 bg-sky-100 border-b border-sky-300 text-sky-950 text-sm">
      <span className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        <span>
          You are exploring a <strong>read-only demo campaign</strong> — the data resets
          nightly and changes are disabled.
        </span>
      </span>

      <button
        onClick={startTour}
        className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-2 hover:text-sky-700"
      >
        <PlayCircle className="h-4 w-4" />
        Start guided tour
      </button>

      <Link
        href="/register/campaign"
        data-tour="demo-register"
        className="inline-flex items-center gap-1.5 bg-sky-900 text-white font-bold text-xs uppercase tracking-wider px-3 py-1.5 rounded-sm hover:bg-sky-800 transition-colors"
      >
        Register your campaign
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
