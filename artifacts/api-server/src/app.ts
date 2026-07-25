import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

app.use("/api", router);

export default app;
