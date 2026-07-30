/**
 * BrandingContext — single source of truth for live campaign branding.
 *
 * Fetches /api/config/branding once, applies CSS custom properties for
 * --primary and --secondary so the entire UI repaints without a code change,
 * and provides the branding object to every component via useBranding().
 *
 * Color format handling
 * ---------------------
 * The branding API may return colors in two formats depending on when the
 * record was created:
 *   - HSL components: "209 88% 50%"  (new format, direct CSS var value)
 *   - Hex:            "#1D9BF0"      (legacy format from older defaults/rows)
 *
 * Both formats are accepted everywhere. Helpers convert hex→HSL transparently
 * so CSS custom properties and Clerk theming always receive valid values.
 */
import { createContext, useContext, useEffect, ReactNode } from "react";
import { useGetBranding } from "@workspace/api-client-react";

// Extend the generated Branding type with fields added in migration 0015
export interface BrandingData {
  campaignName: string;
  candidateName: string;
  positionTitle: string;
  partyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  tagline: string;
  electionYear: number;
  mpesaPaybill?: string | null;
  electionLevel: string;
  websiteUrl?: string | null;
  socialTwitter?: string | null;
  socialFacebook?: string | null;
  socialInstagram?: string | null;
  updatedAt: string;
}

const DEFAULTS: BrandingData = {
  campaignName: "Your Campaign",
  candidateName: "Your Candidate",
  positionTitle: "Your Position",
  partyName: "Your Party",
  primaryColor: "209 88% 50%",
  secondaryColor: "0 0% 8%",
  tagline: "Your Campaign Tagline",
  electionYear: new Date().getFullYear() + 1,
  mpesaPaybill: "",
  electionLevel: "Presidential",
  updatedAt: new Date().toISOString(),
};

interface BrandingContextValue {
  branding: BrandingData;
  isLoading: boolean;
  /** True when the branding fetch returned HTTP 403 — the campaign is suspended. */
  isSuspended: boolean;
}

export const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULTS,
  isLoading: true,
  isSuspended: false,
});

// ─── Color helpers ────────────────────────────────────────────────────────────

/** True when val looks like CSS HSL components without the hsl() wrapper: "H S% L%" */
export function isHslComponents(val: string): boolean {
  return /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(val.trim());
}

/** Convert #rrggbb (or #rgb) to "H S% L%" components. Returns null if not a hex string. */
export function hexToHslComponents(hex: string): string | null {
  const s3 = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex.trim());
  const full = s3
    ? /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
        `#${s3[1]}${s3[1]}${s3[2]}${s3[2]}${s3[3]}${s3[3]}`
      )
    : /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!full) return null;

  let r = parseInt(full[1], 16) / 255;
  let g = parseInt(full[2], 16) / 255;
  let b = parseInt(full[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Normalize any supported color value to HSL components ("H S% L%").
 * Accepts HSL components or hex. Returns null for unrecognized formats.
 */
export function toHslComponents(val: string): string | null {
  if (!val) return null;
  if (isHslComponents(val)) return val;
  return hexToHslComponents(val);
}

/**
 * Convert any supported color value to a valid CSS color string.
 * HSL components → "hsl(H S% L%)"; hex → returned as-is.
 */
export function toCssColor(val: string): string {
  if (!val) return val;
  if (isHslComponents(val)) return `hsl(${val})`;
  return val; // already a valid CSS color (hex, named, etc.)
}

// ─── CSS var application ──────────────────────────────────────────────────────

function applyCssVars(branding: BrandingData) {
  const root = document.documentElement;
  const primary = toHslComponents(branding.primaryColor);
  const secondary = toHslComponents(branding.secondaryColor);
  if (primary) {
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-primary", primary);
    root.style.setProperty("--sidebar-ring", primary);
  }
  if (secondary) {
    root.style.setProperty("--secondary", secondary);
    root.style.setProperty("--accent", secondary);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useGetBranding();

  // Detect suspended campaign: the branding endpoint returns 403 when the
  // tenant's isSuspended flag is true.  ApiError carries a numeric .status.
  const isSuspended =
    (error as any)?.status === 403 ||
    (error as any)?.response?.status === 403;

  const branding: BrandingData = data
    ? ({ ...DEFAULTS, ...(data as unknown as Partial<BrandingData>) } as BrandingData)
    : DEFAULTS;

  useEffect(() => {
    if (data) applyCssVars(branding);
  }, [data]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading, isSuspended }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingData {
  return useContext(BrandingContext).branding;
}

export function useBrandingLoading(): boolean {
  return useContext(BrandingContext).isLoading;
}

/** True when the campaign is suspended — public portal should show an unavailable page. */
export function useBrandingSuspended(): boolean {
  return useContext(BrandingContext).isSuspended;
}
