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

// ── Subdomain → X-Tenant-Slug injection ───────────────────────────────────
// When the reverse proxy / edge maps <slug>.domain.tld to this server it
// should set X-Tenant-Slug directly.  This middleware is a dev-time / last-
// resort fallback: it parses the Host header to extract the leading subdomain
// and injects X-Tenant-Slug when the header is not already present.
//
// Examples:
//   ushindi2027.ushindi.app       → X-Tenant-Slug: ushindi2027
//   ushindi2027.abc.replit.dev    → X-Tenant-Slug: ushindi2027
//   abc123.replit.dev             → (no injection — 2-part Replit dev domain)
//   localhost:5173                → (no injection)
//   www.ushindi.app               → (skipped — "www" is reserved)
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.headers["x-tenant-slug"]) return next(); // already set upstream

  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers["host"] ?? "";
  const hostname = host.split(":")[0]; // strip optional port
  const parts = hostname.split(".");

  // Skip reserved / non-slug first labels and single/two-part hostnames
  const RESERVED = new Set(["www", "api", "app", "mail", "localhost"]);
  if (parts.length >= 3 && !RESERVED.has(parts[0])) {
    req.headers["x-tenant-slug"] = parts[0];
  }
  next();
});

app.use("/api", router);

export default app;
