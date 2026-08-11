/**
 * DemoCompleteModal — the ask, shown once the tour ends or is skipped.
 *
 * The whole point of the demo is the moment after the tour, so this is the
 * only place in the demo that pushes: one clear CTA to register, and a quiet
 * way back to keep exploring for anyone not ready yet.
 */

import { Link } from "wouter";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DemoCompleteModalProps {
  /** Close and remember the dismissal for this session. */
  onClose: () => void;
  /** Replay the tour from step one. */
  onRestart: () => void;
}

export default function DemoCompleteModal({ onClose, onRestart }: DemoCompleteModalProps) {
  return (
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ready to run your campaign?"
        className="w-full max-w-md bg-card border border-border rounded-md shadow-2xl overflow-hidden"
      >
        <div className="bg-sidebar text-sidebar-foreground px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-[0.2em] uppercase text-sidebar-foreground/60 mb-1.5">
              End of tour
            </p>
            <h2 className="text-xl font-black tracking-tight leading-tight">
              Ready to run your campaign?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            You have seen the command centre, the volunteer roster, election-day agent
            deployment, the live tally and the public transparency portal. Register your
            campaign to set all of it up with your own candidate, counties and agents.
          </p>

          {/*
            Taking the CTA counts as answering it. Without this the modal is
            still "open" when the visitor navigates back from the registration
            page and reappears on top of the dashboard.
          */}
          <Link
            href="/register/campaign"
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground font-black text-sm tracking-widest uppercase px-6 py-3.5 rounded-sm hover:bg-primary/90 transition-colors"
          >
            Register now
            <ArrowRight className="h-4 w-4" />
          </Link>

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button variant="ghost" size="sm" onClick={onRestart} className="text-muted-foreground">
              Replay the tour
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
              Keep exploring
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
