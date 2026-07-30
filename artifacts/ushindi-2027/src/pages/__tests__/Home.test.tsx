/**
 * Home — routing tests.
 *
 * Verifies that the root landing page router correctly selects between
 * DebeHome (platform page, base domain) and TenantHome (campaign page,
 * tenant subdomain) based on the BrandingContext value, and that it
 * renders nothing while branding is still loading.
 *
 * Both child components are mocked so this test targets only the routing
 * logic, not the rendering of either page.
 *
 * Run:
 *   pnpm --filter @workspace/ushindi-2027 run test
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Home from "@/pages/Home";
import { BrandingContext } from "@/contexts/BrandingContext";
import type { BrandingData } from "@/contexts/BrandingContext";

// ─── Mock child pages so routing tests stay fast and focused ─────────────────

vi.mock("@/pages/DebeHome", () => ({
  default: () => <div data-testid="debe-home">DebeHome</div>,
}));

vi.mock("@/pages/TenantHome", () => ({
  default: () => <div data-testid="tenant-home">TenantHome</div>,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BRANDING: BrandingData = {
  campaignName:  "Test Campaign",
  candidateName: "Test Candidate",
  positionTitle: "Test Position",
  partyName:     "Test Party",
  primaryColor:  "209 88% 50%",
  secondaryColor:"0 0% 8%",
  tagline:       "Test Tagline",
  electionYear:  2027,
  mpesaPaybill:  "",
  electionLevel: "Presidential",
  updatedAt:     "2026-01-01T00:00:00.000Z",
};

function makeCtx(
  isLoading: boolean,
  isTenant: boolean,
  isSuspended = false
) {
  return { branding: BRANDING, isLoading, isSuspended, isTenant };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Home — routing between DebeHome and TenantHome", () => {

  it("renders nothing while branding is loading (prevents flash of wrong page)", () => {
    const { container } = render(
      <BrandingContext.Provider value={makeCtx(true, false)}>
        <Home />
      </BrandingContext.Provider>
    );
    // Loading state must be empty — no DebeHome, no TenantHome
    expect(screen.queryByTestId("debe-home")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tenant-home")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("renders DebeHome on the base platform domain (isTenant = false)", () => {
    render(
      <BrandingContext.Provider value={makeCtx(false, false)}>
        <Home />
      </BrandingContext.Provider>
    );
    expect(screen.getByTestId("debe-home")).toBeInTheDocument();
    expect(screen.queryByTestId("tenant-home")).not.toBeInTheDocument();
  });

  it("renders TenantHome on a tenant subdomain (isTenant = true)", () => {
    render(
      <BrandingContext.Provider value={makeCtx(false, true)}>
        <Home />
      </BrandingContext.Provider>
    );
    expect(screen.getByTestId("tenant-home")).toBeInTheDocument();
    expect(screen.queryByTestId("debe-home")).not.toBeInTheDocument();
  });

  it("renders TenantHome even when the campaign is suspended (suspension guard is inside TenantHome)", () => {
    render(
      <BrandingContext.Provider value={makeCtx(false, true, true)}>
        <Home />
      </BrandingContext.Provider>
    );
    // Home's job is just to route — TenantHome itself handles the suspended state
    expect(screen.getByTestId("tenant-home")).toBeInTheDocument();
    expect(screen.queryByTestId("debe-home")).not.toBeInTheDocument();
  });

  it("switches from TenantHome to DebeHome when isTenant changes from true to false", () => {
    const { rerender } = render(
      <BrandingContext.Provider value={makeCtx(false, true)}>
        <Home />
      </BrandingContext.Provider>
    );
    expect(screen.getByTestId("tenant-home")).toBeInTheDocument();

    rerender(
      <BrandingContext.Provider value={makeCtx(false, false)}>
        <Home />
      </BrandingContext.Provider>
    );
    expect(screen.getByTestId("debe-home")).toBeInTheDocument();
    expect(screen.queryByTestId("tenant-home")).not.toBeInTheDocument();
  });
});
