/**
 * CampaignConfigContext — fetches /api/config/branding and provides campaign
 * identity + election level config to the entire mobile app.
 *
 * Tenant resolution (priority order):
 *   1. Active Clerk org in the JWT (after sign-in + org activation) — the server
 *      resolves branding from resolveTenantMixed, which prefers the JWT org.
 *   2. EXPO_PUBLIC_TENANT_SLUG baked at build time — sent as X-Tenant-Slug header
 *      for unauthenticated (pre-login) calls so the correct campaign branding
 *      appears on the sign-in screen.
 *   3. Neutral defaults if neither is available.
 *
 * Query is keyed on the active org ID so it automatically refetches when
 * the user selects a different campaign in the org picker.
 *
 * Colour handling:
 *   The web branding stores colours as HSL components ("209 88% 50%").
 *   React Native StyleSheet does not accept hsl() strings, so this context
 *   converts any HSL-component value to a hex string automatically.
 *   Plain hex values (#RRGGBB) are passed through unchanged.
 */
import React, { createContext, useContext, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { useOrganization } from '@clerk/expo';

// ── IEBC result form name by election level ──────────────────────────────────
const FORM_NAME_BY_ELECTION: Record<string, string> = {
  Presidential: 'Form 34A',
  Gubernatorial: 'Form 37A',
  Senatorial: 'Form 37C',
  'Women Rep': 'Form 37B',
  MP: 'Form 35A',
  MCA: 'Form 36A',
};

// ── Config shape ─────────────────────────────────────────────────────────────
export interface CampaignConfig {
  candidateName: string;
  positionTitle: string;
  electionYear: number;
  electionLevel: string;
  /** Correct IEBC result form name for the configured election level */
  formName: string;
  /** React Native-compatible hex colour derived from the branding primaryColor */
  primaryColor: string;
  isLoading: boolean;
}

const FALLBACK_PRIMARY = '#1D9BF0';

const DEFAULTS: CampaignConfig = {
  candidateName: 'Campaign Agent',
  positionTitle: 'Field Agent Portal',
  electionYear: new Date().getFullYear() + 1,
  electionLevel: 'Presidential',
  formName: 'Form 34A',
  primaryColor: FALLBACK_PRIMARY,
  isLoading: true,
};

// ── Color conversion: HSL components → hex ───────────────────────────────────

/**
 * Convert "H S% L%" (HSL without the hsl() wrapper, as stored in the
 * web branding config) to a CSS hex string usable in React Native StyleSheet.
 * Returns null for unrecognised formats.
 */
function hslComponentsToHex(hsl: string): string | null {
  const m = hsl.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return null;
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Accept hex, rgb, or HSL-component strings; always return a hex colour for React Native. */
function toReactNativeColor(color: string | null | undefined): string {
  if (!color) return FALLBACK_PRIMARY;
  const trimmed = color.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('rgb')) return trimmed;
  return hslComponentsToHex(trimmed) ?? FALLBACK_PRIMARY;
}

// ── Provider ─────────────────────────────────────────────────────────────────

const CampaignConfigContext = createContext<CampaignConfig>(DEFAULTS);

const domain = process.env.EXPO_PUBLIC_DOMAIN;
/** Build-time tenant slug — used as X-Tenant-Slug on unauthenticated calls so
 *  the sign-in screen shows the correct campaign branding before auth. */
const buildTimeTenantSlug = process.env.EXPO_PUBLIC_TENANT_SLUG;

export function CampaignConfigProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  // Re-fetch whenever the active org changes so the correct tenant's branding
  // is loaded immediately after the org picker activates an organisation.
  const { organization } = useOrganization();

  const { data, isLoading } = useQuery({
    queryKey: ['campaign-config', organization?.id ?? null],
    queryFn: async () => {
      if (!domain) return null;
      try {
        const headers: Record<string, string> = {};

        if (isSignedIn) {
          // Authenticated path — include JWT so server resolves tenant from
          // the active Clerk org (resolveTenantMixed prefers this).
          const token = await getToken();
          if (token) headers['Authorization'] = `Bearer ${token}`;
        } else if (buildTimeTenantSlug) {
          // Unauthenticated path — use build-time slug so sign-in screen shows
          // the correct campaign branding before the user logs in.
          headers['X-Tenant-Slug'] = buildTimeTenantSlug;
        }

        const res = await fetch(`https://${domain}/api/config/branding`, { headers });
        if (!res.ok) return null;
        return res.json() as Promise<Record<string, unknown>>;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: 2,
  });

  let config: CampaignConfig;
  if (data) {
    const level = (data.electionLevel as string | null) ?? 'Presidential';
    config = {
      candidateName: (data.candidateName as string) ?? DEFAULTS.candidateName,
      positionTitle: (data.positionTitle as string) ?? DEFAULTS.positionTitle,
      electionYear: (data.electionYear as number) ?? DEFAULTS.electionYear,
      electionLevel: level,
      formName: FORM_NAME_BY_ELECTION[level] ?? DEFAULTS.formName,
      primaryColor: toReactNativeColor(data.primaryColor as string | null),
      isLoading: false,
    };
  } else {
    config = { ...DEFAULTS, isLoading };
  }

  return (
    <CampaignConfigContext.Provider value={config}>
      {children}
    </CampaignConfigContext.Provider>
  );
}

export function useCampaignConfig(): CampaignConfig {
  return useContext(CampaignConfigContext);
}
