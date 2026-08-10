/**
 * Shared rate limiters for reuse across route files.
 *
 * publicSubmitLimiter — applied to every unauthenticated write endpoint
 * (volunteer, supporter, aspirant, policy, contact, data-request).
 * Limit: 5 submissions per IP per 15-minute window.
 *
 * IP resolution relies on Express's req.ip, which is derived from the
 * proxy-validated X-Forwarded-For chain only after app.set("trust proxy", 1)
 * is configured in app.ts — making it resistant to header spoofing.
 */
import rateLimit from "express-rate-limit";

/**
 * statusCheckLimiter — applied to the aspirant status-check endpoint.
 * Limit: 20 lookups per IP per 15-minute window — enough for a genuine
 * applicant to recheck their status without enabling bulk enumeration.
 */
export const statusCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: {
    error:
      "Too many status checks from this device — please wait 15 minutes before trying again.",
  },
  skipSuccessfulRequests: false,
});

export const publicSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // req.ip is the proxy-validated client address when trust proxy is set.
  // We do not parse x-forwarded-for manually here — that would be spoofable.
  keyGenerator: (req) => req.ip ?? "unknown",
  message: {
    error:
      "Too many submissions from this device — please wait 15 minutes before trying again.",
  },
  skipSuccessfulRequests: false,
});
