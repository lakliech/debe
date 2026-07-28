/**
 * Canonical list of Data Subject Request types accepted by the API.
 *
 * This file is the single source of truth — import it in both the API server
 * validation logic and the frontend form so they can never drift apart.
 *
 * API: artifacts/api-server/src/routes/dataRequests.ts
 * Form: artifacts/ushindi-2027/src/pages/public/DataRequest.tsx
 */
import { z } from "zod";

/**
 * The four valid `requestType` values for POST /api/data-requests.
 *
 * These correspond to rights under the Kenya Data Protection Act 2019:
 *  - access      — obtain a copy of personal data held
 *  - correction  — correct inaccurate / incomplete data
 *  - deletion    — erase personal data (right to be forgotten)
 *  - objection   — object to processing
 */
export const DATA_REQUEST_TYPES = ["access", "correction", "deletion", "objection"] as const;

export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];

/** Zod enum — use this in both form schemas and API validation. */
export const dataRequestTypeSchema = z.enum(DATA_REQUEST_TYPES, {
  errorMap: () => ({ message: "Please select a valid request type (access, correction, deletion, or objection)" }),
});
