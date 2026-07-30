/**
 * Home — root landing page router.
 *
 * Routes between the Debe platform landing page (base domain, no tenant
 * branding loaded) and the tenant campaign landing page (tenant subdomain,
 * branding loaded from the API).
 *
 * Signed-in users are redirected to /dashboard by HomeRedirect in App.tsx
 * before this component even renders.
 */
import { useBrandingLoading, useBrandingTenant } from "@/contexts/BrandingContext";
import DebeHome from "./DebeHome";
import TenantHome from "./TenantHome";

export default function Home() {
  const isLoading = useBrandingLoading();
  const isTenant = useBrandingTenant();

  // While branding is loading, show nothing (avoids a flash of the wrong page).
  // The load is fast (single API call) and the app shell has no layout shift.
  if (isLoading) {
    return null;
  }

  return isTenant ? <TenantHome /> : <DebeHome />;
}
