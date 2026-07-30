/**
 * ResultSubmissions — geography filter reset tests.
 *
 * Verifies that the two useEffect hooks added in Task #82 correctly:
 *  1. Hide county / constituency filter dropdowns when the election level
 *     changes to one that doesn't include those geography levels.
 *  2. Reset the page counter back to 1 whenever a filter panel is hidden.
 *
 * These are reactive branding-context tests — no page reload is needed.
 *
 * Run:
 *   pnpm --filter @workspace/ushindi-2027 run test
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ResultSubmissions from "@/pages/admin/ResultSubmissions";
import { BrandingContext } from "@/contexts/BrandingContext";
import type { BrandingData } from "@/contexts/BrandingContext";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useLocation: () => ["/" as string, vi.fn()],
}));

// Submissions query returns a configurable payload so pagination can be tested.
// Elections query always returns an empty list — not relevant to these tests.
let _mockSubmissionsData: unknown = undefined;

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (Array.isArray(queryKey) && queryKey[0] === "election-results") {
      return { data: _mockSubmissionsData, isLoading: false };
    }
    // elections-list query
    return { data: [], isLoading: false };
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBranding: () => ({ data: undefined, isLoading: false, error: null }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_BRANDING: Omit<BrandingData, "electionLevel"> = {
  campaignName:  "Test Campaign",
  candidateName: "Test Candidate",
  positionTitle: "Test Position",
  partyName:     "Test Party",
  primaryColor:  "209 88% 50%",
  secondaryColor:"0 0% 8%",
  tagline:       "Test Tagline",
  electionYear:  2027,
  mpesaPaybill:  "",
  updatedAt:     "2026-01-01T00:00:00.000Z",
};

function makeBranding(level: string): BrandingData {
  return { ...BASE_BRANDING, electionLevel: level };
}

function makeCtx(level: string) {
  return { branding: makeBranding(level), isLoading: false, isSuspended: false };
}

/** Submission list payload with enough total rows to show pagination (> 20). */
const PAGINATED_PAYLOAD = {
  data: [],        // no row content needed — only totals matter for these tests
  total: 100,
  counties: [],
  constituencies: [],
};

beforeEach(() => {
  _mockSubmissionsData = undefined;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Filter visibility per election level
// ═══════════════════════════════════════════════════════════════════════════════

describe("ResultSubmissions — filter visibility matches election level", () => {
  it("shows county AND constituency filters for Presidential (both levels present)", () => {
    render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/all counties/i)).toBeInTheDocument();
    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
  });

  it("shows county AND constituency filters for Gubernatorial", () => {
    render(
      <BrandingContext.Provider value={makeCtx("Gubernatorial")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/all counties/i)).toBeInTheDocument();
    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
  });

  it("hides county filter but shows constituency filter for MP", () => {
    render(
      <BrandingContext.Provider value={makeCtx("MP")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // MP: ["constituency", "ward"] — no county level
    expect(screen.queryByText(/all counties/i)).not.toBeInTheDocument();
    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
  });

  it("hides BOTH county and constituency filters for MCA", () => {
    render(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // MCA: ["ward"] only
    expect(screen.queryByText(/all counties/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/all constituencies/i)).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Live branding change — filters hide reactively (no page reload)
// ═══════════════════════════════════════════════════════════════════════════════

describe("ResultSubmissions — filters reset on live election level change", () => {
  it("hides county filter immediately when level changes from Presidential to MCA", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Confirm it starts visible
    expect(screen.getByText(/all counties/i)).toBeInTheDocument();

    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Must vanish without a page reload
    expect(screen.queryByText(/all counties/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/all constituencies/i)).not.toBeInTheDocument();
  });

  it("hides constituency filter immediately when level changes from Gubernatorial to MCA", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Gubernatorial")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();

    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.queryByText(/all constituencies/i)).not.toBeInTheDocument();
  });

  it("restores both filters when level changes back from MCA to Presidential", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.queryByText(/all counties/i)).not.toBeInTheDocument();

    rerender(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/all counties/i)).toBeInTheDocument();
    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
  });

  it("removes constituency filter but keeps county filter when switching from Presidential to MP", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
    expect(screen.getByText(/all counties/i)).toBeInTheDocument();

    // MP: ["constituency", "ward"] — no county level
    rerender(
      <BrandingContext.Provider value={makeCtx("MP")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.queryByText(/all counties/i)).not.toBeInTheDocument();
    expect(screen.getByText(/all constituencies/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Page resets to 1 when a filter is hidden
// ═══════════════════════════════════════════════════════════════════════════════

describe("ResultSubmissions — page resets to 1 when filter panel is hidden", () => {
  it("resets page from 2 → 1 when county filter is hidden by switching from Presidential to MCA", () => {
    // Use a payload with enough rows to show pagination.
    _mockSubmissionsData = PAGINATED_PAYLOAD;

    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Pagination should now be visible (total=100 > pageSize=20)
    expect(screen.getByText(/page 1 of 5/i)).toBeInTheDocument();

    // Advance to page 2 by clicking the "Next" button
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/page 2 of 5/i)).toBeInTheDocument();

    // Switch to MCA — showCountyFilter becomes false → useEffect calls setPage(1)
    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Page must be reset to 1 automatically
    expect(screen.getByText(/page 1 of 5/i)).toBeInTheDocument();
  });

  it("resets page from 3 → 1 when constituency filter is hidden by switching from Presidential to MP", () => {
    _mockSubmissionsData = PAGINATED_PAYLOAD;

    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Advance to page 3
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn); // page 2
    fireEvent.click(nextBtn); // page 3
    expect(screen.getByText(/page 3 of 5/i)).toBeInTheDocument();

    // Switch to MP — constituency is still shown, but county is hidden → page reset
    // MP: ["constituency", "ward"] — county hidden → setPage(1)
    rerender(
      <BrandingContext.Provider value={makeCtx("MP")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    expect(screen.getByText(/page 1 of 5/i)).toBeInTheDocument();
  });

  it("does NOT reset page when switching between levels that both include county", () => {
    _mockSubmissionsData = PAGINATED_PAYLOAD;

    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn); // page 2
    expect(screen.getByText(/page 2 of 5/i)).toBeInTheDocument();

    // Gubernatorial also includes county + constituency → no reset triggered
    rerender(
      <BrandingContext.Provider value={makeCtx("Gubernatorial")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Page should remain at 2
    expect(screen.getByText(/page 2 of 5/i)).toBeInTheDocument();
  });
});
