---
name: API must stay campaign-neutral
description: Rule for multi-tenant response text — the API never asserts a campaign identity; branding comes from tenant data or is omitted.
---

# API responses must never carry a hardcoded campaign identity

No server-side string (JSON body, server-rendered HTML/OG tags, outbound
WhatsApp/SMS/email copy, payment references) may contain a specific campaign's
name, tagline, or movement slogan. Use one of, in order of preference:

1. the tenant's own stored branding / tenant name, looked up per request or per
   sweep with the usual tenant filter;
2. `null` / `""` when the client can substitute its own branding (the web and
   mobile clients read branding from their branding context);
3. a generic platform word (`"Campaign Platform"`, `"Command Center"`,
   `"CAMPAIGN"`) when neither is possible.

**Why:** the platform is multi-tenant. A hardcoded fallback leaks the founding
campaign's identity into another tenant's portal, notifications, social-share
previews and M-Pesa records — visible to the wrong voters, and embarrassing.

**How to apply:** crawler-facing routes (Open Graph/meta HTML) and background
jobs cannot rely on the client to substitute branding, so they must do the
tenant lookup server-side rather than falling back to a literal. The platform
portal domain default (`PORTAL_DOMAIN`) is deployment infrastructure, not
branding — leaving it alone is intentional; changing it breaks custom-domain
CNAME verification.
