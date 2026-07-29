import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

/**
 * Returns the design tokens for the current color scheme, merged with any
 * runtime primary colour override from the campaign config API.
 *
 * The primary colour comes from /api/config/branding so a redeployment
 * for a different campaign automatically repaints every button, header,
 * and active state without a new app build.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  const { primaryColor, isLoading } = useCampaignConfig();
  // Only override once config has loaded (isLoading = false) to avoid a flash
  const primary = isLoading ? palette.primary : primaryColor;
  return { ...palette, primary, radius: colors.radius };
}
