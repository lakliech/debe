/**
 * TenantHome — hero copy rendering tests.
 *
 * Confirms that the homepage hero section:
 *  1. Shows the saved heroSubtagline from BrandingContext when it is non-empty.
 *  2. Falls back to the static default ("Get informed, get involved, and make
 *     your voice count.") when heroSubtagline is null, undefined, or an empty
 *     string — so no empty <p> is ever rendered.
 *  3. Shows saved CTA label and URL when provided.
 *  4. Falls back to the static default CTA labels when the values are null.
 *
 * The test also validates that the PATCH → GET → render pipeline is correct at
 * the component level: when BrandingContext delivers the API response, the hero
 * sub-tagline on the "public homepage" reflects it without a page reload.
 *
 * All external dependencies (wouter, api-client-react) are mocked so these
 * tests run fast and do not require a running server.
 *
 * Run:
 *   pnpm --filter @workspace/ushindi-2027 run test
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TenantHome from "@/pages/TenantHome";
import { BrandingContext } from "@/contexts/BrandingContext";
import type { BrandingData } from "@/contexts/BrandingContext";

// ─── Module mocks ─────────────────────────────────────────────────────────────

// TenantHome uses <Link href="..."> from wouter — mock it to a plain <a>
vi.mock("wouter", () => ({
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

// BrandingContext imports useGetBranding at module scope; silence it so no
// network calls are attempted in the test environment.
vi.mock("@workspace/api-client-react", () => ({
  useGetBranding: () => ({ data: undefined, isLoading: false, error: null }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_BRANDING: BrandingData = {
  campaignName:   "Test Campaign",
  candidateName:  "Jane Mwananchi",
  positionTitle:  "Member of Parliament",
  partyName:      "Unity Party",
  primaryColor:   "209 88% 50%",
  secondaryColor: "0 0% 8%",
  tagline:        "A better Kenya for all",
  electionYear:   2027,
  mpesaPaybill:   "",
  electionLevel:  "Parliamentary",
  updatedAt:      "2026-01-01T00:00:00.000Z",
};

const STATIC_DEFAULT_SUBTAGLINE =
  "Get informed, get involved, and make your voice count.";
const STATIC_DEFAULT_PRIMARY_CTA   = "Read the Manifesto";
const STATIC_DEFAULT_SECONDARY_CTA = "Volunteer";

/**
 * Renders TenantHome inside a BrandingContext with the given branding data.
 * isSuspended is false (active campaign) by default.
 */
function renderWithBranding(
  branding: Partial<BrandingData>,
  { isSuspended = false } = {},
) {
  return render(
    <BrandingContext.Provider
      value={{
        branding: { ...BASE_BRANDING, ...branding },
        isLoading: false,
        isSuspended,
        isTenant: true,
      }}
    >
      <TenantHome />
    </BrandingContext.Provider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TenantHome — hero sub-tagline rendering", () => {

  it("shows the saved heroSubtagline when BrandingContext provides a non-empty value", () => {
    const custom = "Empowering every Kenyan — one vote at a time.";
    renderWithBranding({ heroSubtagline: custom });

    expect(screen.getByText(custom)).toBeInTheDocument();
    // The static default must not appear alongside the custom value
    expect(screen.queryByText(STATIC_DEFAULT_SUBTAGLINE)).not.toBeInTheDocument();
  });

  it("falls back to the static default when heroSubtagline is null", () => {
    renderWithBranding({ heroSubtagline: null });

    expect(screen.getByText(STATIC_DEFAULT_SUBTAGLINE)).toBeInTheDocument();
  });

  it("falls back to the static default when heroSubtagline is undefined", () => {
    renderWithBranding({ heroSubtagline: undefined });

    expect(screen.getByText(STATIC_DEFAULT_SUBTAGLINE)).toBeInTheDocument();
  });

  it("falls back to the static default when heroSubtagline is an empty string", () => {
    // This mirrors the case where the admin left the field blank and the API
    // returns null — TenantHome uses `branding.heroSubtagline || "default"`,
    // so any falsy value (null, undefined, "") triggers the built-in copy.
    renderWithBranding({ heroSubtagline: "" });

    expect(screen.getByText(STATIC_DEFAULT_SUBTAGLINE)).toBeInTheDocument();
  });

  it("reflects an updated heroSubtagline without a page reload (re-render from context update)", () => {
    const firstValue  = "First version of the sub-tagline.";
    const secondValue = "Updated — this change went live immediately.";

    const { rerender } = render(
      <BrandingContext.Provider
        value={{
          branding: { ...BASE_BRANDING, heroSubtagline: firstValue },
          isLoading: false,
          isSuspended: false,
          isTenant: true,
        }}
      >
        <TenantHome />
      </BrandingContext.Provider>,
    );
    expect(screen.getByText(firstValue)).toBeInTheDocument();

    // Simulate BrandingContext delivering fresh data after a save (no page reload)
    rerender(
      <BrandingContext.Provider
        value={{
          branding: { ...BASE_BRANDING, heroSubtagline: secondValue },
          isLoading: false,
          isSuspended: false,
          isTenant: true,
        }}
      >
        <TenantHome />
      </BrandingContext.Provider>,
    );
    expect(screen.getByText(secondValue)).toBeInTheDocument();
    expect(screen.queryByText(firstValue)).not.toBeInTheDocument();
  });
});

describe("TenantHome — hero CTA rendering", () => {

  it("shows the saved primary CTA label when non-empty", () => {
    renderWithBranding({ primaryCtaLabel: "Read our Manifesto", primaryCtaUrl: "/plan" });

    expect(screen.getByText("Read our Manifesto")).toBeInTheDocument();
    expect(screen.queryByText(STATIC_DEFAULT_PRIMARY_CTA)).not.toBeInTheDocument();
  });

  it("falls back to the default primary CTA label when null", () => {
    renderWithBranding({ primaryCtaLabel: null, primaryCtaUrl: null });

    expect(screen.getByText(STATIC_DEFAULT_PRIMARY_CTA)).toBeInTheDocument();
  });

  it("shows the saved secondary CTA label when non-empty", () => {
    renderWithBranding({ secondaryCtaLabel: "Join the Team", secondaryCtaUrl: "/join" });

    expect(screen.getByText("Join the Team")).toBeInTheDocument();
    expect(screen.queryByText(STATIC_DEFAULT_SECONDARY_CTA)).not.toBeInTheDocument();
  });

  it("falls back to the default secondary CTA label when null", () => {
    renderWithBranding({ secondaryCtaLabel: null, secondaryCtaUrl: null });

    expect(screen.getByText(STATIC_DEFAULT_SECONDARY_CTA)).toBeInTheDocument();
  });
});

describe("TenantHome — suspended campaign", () => {
  it("shows the unavailable page and hides the hero when the campaign is suspended", () => {
    renderWithBranding({}, { isSuspended: true });

    expect(screen.getByText("Campaign Unavailable")).toBeInTheDocument();
    // Hero sub-tagline and CTAs are not rendered at all for suspended campaigns
    expect(screen.queryByText(STATIC_DEFAULT_SUBTAGLINE)).not.toBeInTheDocument();
    expect(screen.queryByText(STATIC_DEFAULT_PRIMARY_CTA)).not.toBeInTheDocument();
  });
});
