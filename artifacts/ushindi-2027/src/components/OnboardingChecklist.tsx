import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X, Loader2, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface ChecklistStep {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

interface OnboardingData {
  steps: ChecklistStep[];
  completed: number;
  total: number;
  percent: number;
  allDone: boolean;
  dismissed: boolean;
}

export default function OnboardingChecklist() {
  const qc = useQueryClient();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { data, isLoading } = useQuery<OnboardingData>({
    queryKey: ["/api/settings/onboarding"],
    queryFn: () => apiFetch("/api/settings/onboarding"),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const dismiss = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/onboarding/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      }),
    onSuccess: (updated: OnboardingData) => {
      qc.setQueryData(["/api/settings/onboarding"], updated);
    },
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-sm p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.dismissed || data.allDone) return null;

  return (
    <div className="bg-gradient-to-br from-primary/5 via-card to-green-500/5 border border-primary/20 rounded-sm shadow-md overflow-hidden animate-in fade-in slide-in-from-top-4 duration-700" data-testid="onboarding-checklist">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight text-foreground">Get Started</h3>
            <p className="text-xs text-muted-foreground">
              {data.completed} of {data.total} steps complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed((v) => !v)}
            className="p-1.5 rounded-sm hover:bg-muted/50 transition-colors text-muted-foreground"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            data-testid="button-toggle-checklist"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", isCollapsed ? "rotate-0" : "rotate-90")} />
          </button>
          <button
            onClick={() => dismiss.mutate()}
            disabled={dismiss.isPending}
            className="p-1.5 rounded-sm hover:bg-muted/50 transition-colors text-muted-foreground disabled:opacity-50"
            aria-label="Dismiss"
            data-testid="button-dismiss-checklist"
          >
            {dismiss.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 pt-4">
        <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-green-500 transition-all duration-700 ease-out"
            style={{ width: `${data.percent}%` }}
          />
        </div>
        <p className="text-xs font-bold text-primary mt-2">{data.percent}% Complete</p>
      </div>

      {/* Steps */}
      {!isCollapsed && (
        <div className="px-6 py-4 space-y-3">
          {data.steps.map((step, idx) => (
            <div
              key={step.key}
              className={cn(
                "flex items-start gap-4 p-4 rounded-sm border transition-all duration-300 animate-in fade-in slide-in-from-left-2",
                step.done
                  ? "bg-green-50 border-green-200 opacity-80"
                  : "bg-card border-border hover:border-primary/30 hover:shadow-sm"
              )}
              style={{ animationDelay: `${idx * 80}ms` }}
              data-testid={`checklist-step-${step.key}`}
            >
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all duration-500",
                step.done
                  ? "bg-green-500 text-white scale-110"
                  : "bg-muted text-muted-foreground"
              )}>
                {step.done ? (
                  <Check className="h-4 w-4 animate-in zoom-in duration-300" />
                ) : (
                  <span className="text-xs font-black">{idx + 1}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className={cn("text-sm font-bold", step.done ? "text-green-900 line-through" : "text-foreground")}>
                  {step.label}
                </h4>
                <p className={cn("text-xs mt-1", step.done ? "text-green-700" : "text-muted-foreground")}>
                  {step.description}
                </p>
              </div>
              {!step.done && (
                <Link href={step.href} className="shrink-0" data-testid={`link-step-${step.key}`}>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-bold">
                    Start
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
