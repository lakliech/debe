import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { NO_CAMPAIGN_SELECTED } from "./lib/withTenant";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Proxy trust ────────────────────────────────────────────────────────────
// Replit sits behind one reverse-proxy hop.  Setting trust proxy to 1 tells
// Express to accept the first X-Forwarded-For value as the real client IP,
// but only from the immediately-adjacent proxy — not from arbitrary headers
// injected by the client itself.  req.ip and req.ips are then reliable, and
// rate-limit keyGenerators can safely use req.ip.
app.set("trust proxy", 1);

// ── Secure headers (Helmet) ────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // disabled for Clerk iframe; tighten in production
    crossOriginEmbedderPolicy: false,
  }),
);

// ── Rate limiting ──────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please try again shortly." },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts." },
});
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Export rate limit exceeded — max 20 exports/minute." },
});

app.use(globalLimiter);
// Route-specific limiters (applied before body parsers and main router)
app.use(CLERK_PROXY_PATH, authLimiter);       // Clerk sign-in/sign-up flows
app.use("/api/reporting/export", exportLimiter); // Data export endpoint

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy middleware must come before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Build an explicit origin allowlist from environment.
// CORS_ORIGINS can override with a comma-separated list of trusted origins.
// Defaults to the Replit preview domain and localhost variants.
const rawAllowedOrigins = process.env.CORS_ORIGINS;
const allowedOrigins: string[] = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : [
      // Same-host Replit preview (https://<id>.replit.dev)
      ...(process.env.REPLIT_DEV_DOMAIN
        ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
        : []),
      "http://localhost:5173",
      "http://localhost:3000",
    ];

app.use(
  cors({
    credentials: true,
    origin(requestOrigin, callback) {
      // Allow server-to-server / same-origin requests (no Origin header)
      if (!requestOrigin) return callback(null, true);
      if (allowedOrigins.includes(requestOrigin)) return callback(null, true);
      callback(new Error(`CORS: origin '${requestOrigin}' not allowed`));
    },
  }),
);
// ── Stripe webhook ─────────────────────────────────────────────────────────
// MUST be mounted before express.json(). Stripe signs the raw request bytes,
// so a parsed-and-restringified body fails signature verification. This route
// takes the raw Buffer; every other route still gets normal JSON parsing.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    import("./routes/billing.js")
      .then(({ stripeWebhookHandler }) => stripeWebhookHandler(req, res))
      .catch(next);
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve publishable key from hostname for multi-domain support
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// ── Subdomain / custom-domain → X-Tenant-Slug injection ──────────────────
// When the reverse proxy / edge maps <slug>.domain.tld to this server it
// should set X-Tenant-Slug directly.  This middleware is a dev-time / last-
// resort fallback.
//
// Resolution order:
//  1. If X-Tenant-Slug is already set (by an upstream proxy) → pass through.
//  2. If the hostname is a KNOWN platform domain → extract the leading label
//     as the tenant slug (subdomain pattern).
//  3. Otherwise → DB lookup against tenants.custom_domain.
//
// Known platform domain examples (slug extraction):
//   amina.ushindi.app             → slug: amina
//   amina.abc123.replit.dev       → slug: amina   (4+ labels ending in .replit.dev)
//   abc123.replit.dev             → no slug  (base Replit dev host — only 3 labels)
//   localhost:5173                → no slug
//   www.ushindi.app               → no slug (reserved label)
//
// Custom domain examples (DB lookup):
//   vote.amina.ke                 → lookup "vote.amina.ke" in tenants.custom_domain
//   portal.example.com            → lookup "portal.example.com"
import { db as _tenantDb, tenantsTable as _tenantsTable } from "@workspace/db";
import { eq as _eq } from "drizzle-orm";

const _PORTAL_BASE = (process.env.PORTAL_DOMAIN ?? "ushindi.app").toLowerCase();
const _RESERVED_LABELS = new Set(["www", "api", "app", "mail", "localhost"]);

/**
 * Returns the tenant slug if the hostname matches a known platform subdomain
 * pattern, or null if it should be treated as a custom domain.
 *
 * Rules:
 *  - <slug>.<PORTAL_BASE>  →  slug  (exact: PORTAL_BASE splits into N parts,
 *                                    hostname must have N+1 parts)
 *  - <slug>.<anything>.replit.dev  →  slug  (must have ≥ 4 parts so the bare
 *                                    Replit dev host abc123.replit.dev is excluded)
 *  - <slug>.<anything>.repl.co    →  slug  (same rule, 4+ parts)
 *  - anything else                →  null  (treat as custom domain)
 */
function _extractPlatformSlug(hostname: string, parts: string[]): string | null {
  const slug = parts[0];
  if (_RESERVED_LABELS.has(slug)) return null;

  // <slug>.<PORTAL_BASE>
  const portalParts = _PORTAL_BASE.split(".");
  if (
    parts.length === portalParts.length + 1 &&
    hostname.endsWith(`.${_PORTAL_BASE}`)
  ) {
    return slug;
  }

  // <slug>.<repl>.replit.dev  (4+ labels required to exclude abc123.replit.dev)
  if (hostname.endsWith(".replit.dev") && parts.length >= 4) return slug;
  if (hostname.endsWith(".repl.co") && parts.length >= 4) return slug;

  return null;
}

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.headers["x-tenant-slug"]) return next(); // already set upstream

  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
    req.headers["host"] ??
    "";
  const hostname = host.split(":")[0].toLowerCase(); // strip port, normalise case
  const parts = hostname.split(".");

  // 1. Known platform subdomain → extract slug directly (no DB hit)
  const platformSlug = _extractPlatformSlug(hostname, parts);
  if (platformSlug) {
    req.headers["x-tenant-slug"] = platformSlug;
    return next();
  }

  // 2. Unknown hostname → custom-domain DB lookup.
  //    Only attempt for real-looking domains (contains a dot, not localhost).
  if (hostname.includes(".") && hostname !== "localhost") {
    try {
      const [tenant] = await _tenantDb
        .select({ slug: _tenantsTable.slug })
        .from(_tenantsTable)
        .where(_eq(_tenantsTable.customDomain, hostname))
        .limit(1);
      if (tenant) {
        req.headers["x-tenant-slug"] = tenant.slug;
      }
    } catch {
      // Non-fatal — continue without tenant context
    }
  }

  next();
});

app.use("/api", router);

// ── Error handling ─────────────────────────────────────────────────────────
// "No campaign selected" is a legitimate state, not a crash: platform
// operators hold no campaign until they explicitly enter one. Translate it to
// a 409 with a machine-readable code so the frontend can send them to the
// campaign picker, instead of letting it surface as an opaque 500.
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.code === NO_CAMPAIGN_SELECTED) {
    res.status(409).json({ code: NO_CAMPAIGN_SELECTED, error: err.message });
    return;
  }
  logger.error({ err }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
});

// ── Demo nightly reset job ─────────────────────────────────────────────────
// Only active when DEMO_RESET_ENABLED=true so the cron never fires in
// tenant (production) environments.
if (process.env.DEMO_RESET_ENABLED === "true") {
  // Lazy import to avoid loading node-cron in normal builds.
  import("./jobs/demoReset.js").then(({ registerDemoResetJob }) => {
    registerDemoResetJob();
  }).catch((err) => {
    // Non-fatal — log and continue; the server should still start.
    console.error("[demoReset] Failed to register demo reset job:", err);
  });
}

// ── SaaS lifecycle jobs ────────────────────────────────────────────────────
// Trial expiry and tenant purge. Both are idempotent, but they must run on
// exactly one instance — set BILLING_JOBS_ENABLED=true on the primary only,
// otherwise a scaled-out deployment would send duplicate emails.
if (process.env.BILLING_JOBS_ENABLED === "true") {
  import("./jobs/trialExpiry.js")
    .then(({ registerTrialExpiryJob }) => registerTrialExpiryJob())
    .catch((err) => console.error("[trialExpiry] Failed to register job:", err));

  import("./jobs/tenantPurge.js")
    .then(({ registerTenantPurgeJob }) => registerTenantPurgeJob())
    .catch((err) => console.error("[tenantPurge] Failed to register job:", err));
}

export default app;
