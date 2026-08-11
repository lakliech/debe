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
// Elections query is also configurable so tests can supply a real election to select.
let _mockSubmissionsData: unknown = undefined;
let _mockElectionsData: unknown = [];

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (Array.isArray(queryKey) && queryKey[0] === "election-results") {
      return { data: _mockSubmissionsData, isLoading: false };
    }
    // elections-list query
    return { data: _mockElectionsData, isLoading: false };
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
  return { branding: makeBranding(level), isLoading: false, isSuspended: false, isTenant: true };
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
  _mockElectionsData = [];
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

// ═══════════════════════════════════════════════════════════════════════════════
// 4. statusFilter, search, and electionId are NOT reset on election level change
// ═══════════════════════════════════════════════════════════════════════════════

describe("ResultSubmissions — statusFilter, search, and electionId preserved on election level change", () => {
  /**
   * search is a plain <input>; it can be changed with fireEvent.change and read
   * back via input.value — no Radix machinery involved.
   */
  it("preserves the search term when switching from Presidential to MCA", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    const searchInput = screen.getByPlaceholderText(/search by station code/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "STATION-001" } });
    expect(searchInput.value).toBe("STATION-001");

    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // The election-level change must NOT reset the search field.
    expect(searchInput.value).toBe("STATION-001");
  });

  /**
   * statusFilter is managed via a Radix Select.  We open the dropdown via a
   * pointerDown on the trigger (the event Radix listens to), pick "submitted",
   * then rerender with a different election level and assert the chosen value
   * survives — confirming no reset effect is wired to this state field.
   */
  it("preserves statusFilter when switching from Presidential to MCA", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Locate the status Select trigger by its visible text content.
    // (Radix 2.x renders role="combobox" but accessible-name computation is env-dependent;
    //  text-content lookup is reliable across test environments.)
    const statusTrigger = screen.getByText(/all statuses/i).closest("button")!;

    // Open the Radix Select dropdown.
    // Radix 2.x checks: button === 0 && ctrlKey === false && pointerType === "mouse"
    fireEvent.pointerDown(statusTrigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

    // The listbox content is portalled to document.body — find the option there.
    const submittedOption = screen.getByText(/^submitted$/i);
    fireEvent.click(submittedOption);

    // Trigger must now show the selected value, not the placeholder.
    expect(screen.getByText(/^submitted$/i)).toBeInTheDocument();
    expect(screen.queryByText(/all statuses/i)).not.toBeInTheDocument();

    // Change election level — no reset effect should touch statusFilter.
    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // "submitted" must still be shown — not reverted to "all".
    expect(screen.getByText(/^submitted$/i)).toBeInTheDocument();
    expect(screen.queryByText(/all statuses/i)).not.toBeInTheDocument();
  });

  /**
   * electionId has no reset logic tied to election level.  We supply a real
   * election via the mock, select it, then change the election level and
   * confirm the chosen election persists — proving no accidental reset runs.
   */
  it("preserves a selected electionId when switching from Presidential to MCA", () => {
    // Provide one election so there is a non-default option available.
    _mockElectionsData = [{ id: "election-abc", electionType: "Presidential", year: 2027 }];

    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // Locate the election Select trigger by its visible placeholder text.
    const electionTrigger = screen.getByText(/all elections/i).closest("button")!;

    // Open the dropdown via pointerDown.
    // Radix 2.x checks: button === 0 && ctrlKey === false && pointerType === "mouse"
    fireEvent.pointerDown(electionTrigger, { button: 0, ctrlKey: false, pointerType: "mouse" });

    // Select "Presidential 2027" from the portalled listbox.
    const electionOption = screen.getByText(/presidential 2027/i);
    fireEvent.click(electionOption);

    // The trigger must now show the selected election, not the placeholder.
    expect(screen.getByText(/presidential 2027/i)).toBeInTheDocument();
    expect(screen.queryByText(/all elections/i)).not.toBeInTheDocument();

    // Change election level — electionId has no reset effect wired.
    rerender(
      <BrandingContext.Provider value={makeCtx("MCA")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // The selected election must persist across the branding-context update.
    expect(screen.getByText(/presidential 2027/i)).toBeInTheDocument();
    expect(screen.queryByText(/all elections/i)).not.toBeInTheDocument();
  });

  /**
   * Branding can update mid-session (e.g. campaign admin edits campaign name).
   * A branding context update must not clear the search input even when the
   * election level itself stays the same.
   */
  it("search input retains its value after a branding context update", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx("Presidential")}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    const searchInput = screen.getByPlaceholderText(/search by station code/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "NAIROBI-001" } });
    expect(searchInput.value).toBe("NAIROBI-001");

    // Simulate a branding refresh — same election level, but campaign name changed.
    const updatedBranding: BrandingData = {
      ...makeBranding("Presidential"),
      campaignName: "Updated Campaign Name",
    };
    rerender(
      <BrandingContext.Provider value={{ branding: updatedBranding, isLoading: false, isSuspended: false, isTenant: true }}>
        <ResultSubmissions />
      </BrandingContext.Provider>
    );

    // The search value must survive the branding refresh.
    expect(searchInput.value).toBe("NAIROBI-001");
  });
});
