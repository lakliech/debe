/**
 * Guided demo tour — step definitions and session-scoped state.
 *
 * The tour is a sales device: a prospective customer who lands in the demo
 * campaign sees a dense command centre with no idea what matters, so six steps
 * walk them through the workflows that sell the product and end on "register
 * your campaign".
 *
 * State lives in localStorage so it survives a navigation or a full reload,
 * but it is stamped with a session id held in sessionStorage. A new browsing
 * session therefore gets a new id, the stored record no longer matches, and
 * the tour starts again from step one — which is what a *new* prospect should
 * see. Nothing here needs clearing when the nightly demo reset runs.
 */

export interface TourStep {
  id: string;
  /** Tooltip heading. */
  title: string;
  /** One sentence explaining why this screen matters. */
  body: string;
  /** Selector of the element to spotlight. */
  target: string;
  /** Route to visit before the step is shown. */
  route?: string;
  /** Preferred tooltip side; flipped automatically when it would overflow. */
  position?: "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "command-centre",
    title: "Your Command Centre",
    body: "Every campaign number — personnel, agents deployed, stations and counties covered — on one screen, updated as the field reports in.",
    target: '[data-tour="dashboard-overview"]',
    route: "/dashboard",
    position: "bottom",
  },
  {
    id: "volunteers",
    title: "Volunteer roster",
    body: "Recruit, verify and deploy volunteers from a single roster you can filter by county, status or role.",
    target: '[data-tour="volunteer-roster"]',
    route: "/volunteers",
    position: "top",
  },
  {
    id: "deployment",
    title: "Polling agent deployment map",
    body: "On election day you see where every agent actually is — on station, nearby, or missing — instead of guessing from phone calls.",
    target: '[data-tour="agent-deployment-map"]',
    route: "/command-center?tab=agents",
    position: "top",
  },
  {
    id: "tally",
    title: "Live tally dashboard",
    body: "Verified station results aggregate in real time from station to constituency to county, so you know the count before anyone announces it.",
    target: '[data-tour="tally-results"]',
    route: "/tally",
    position: "top",
  },
  {
    id: "transparency",
    title: "Public transparency portal",
    body: "Publish verified results to a public portal with full audit trails — proof for voters, media and observers that your numbers hold up.",
    target: '[data-tour="transparency-portal"]',
    route: "/transparency-portal",
    position: "bottom",
  },
  {
    id: "register",
    title: "Run this for your own campaign",
    body: "Everything you have just seen is available the moment you register — your candidate, your counties, your agents.",
    target: '[data-tour="demo-register"]',
    position: "bottom",
  },
];

// ── Session-scoped persistence ───────────────────────────────────────────────

const TOUR_KEY = "debe.demo-tour.v1";
const SESSION_KEY = "debe.demo-session";

export type TourStatus = "unstarted" | "running" | "finished";

export interface TourState {
  /** The browsing session this record belongs to. */
  sessionId: string;
  /** Zero-based index into TOUR_STEPS. */
  step: number;
  status: TourStatus;
  /** The "Ready to run your campaign?" modal was closed in this session. */
  ctaDismissed: boolean;
}

/**
 * An id for the current browsing session.
 *
 * sessionStorage survives reloads and in-app navigation within a tab but not a
 * new session, which is exactly the lifetime the tour should have.
 */
function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s${Date.now()}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // Storage disabled (private mode, blocked cookies): the tour still runs,
    // it simply does not survive a reload.
    return "ephemeral";
  }
}

export function freshTourState(): TourState {
  return { sessionId: sessionId(), step: 0, status: "unstarted", ctaDismissed: false };
}

export function readTourState(): TourState {
  const current = sessionId();
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (!raw) return freshTourState();
    const parsed = JSON.parse(raw) as Partial<TourState>;
    // A record from an earlier session belongs to an earlier visitor.
    if (parsed.sessionId !== current) return freshTourState();
    const step =
      typeof parsed.step === "number" && parsed.step >= 0 && parsed.step < TOUR_STEPS.length
        ? parsed.step
        : 0;
    const status: TourStatus =
      parsed.status === "running" || parsed.status === "finished" ? parsed.status : "unstarted";
    return { sessionId: current, step, status, ctaDismissed: Boolean(parsed.ctaDismissed) };
  } catch {
    return freshTourState();
  }
}

export function writeTourState(state: TourState): void {
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — see sessionId().
  }
}
