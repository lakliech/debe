/**
 * Submission statuses whose candidate votes count toward the tally:
 *   "verified"       — passed human review
 *   "auto_validated" — passed automated validation checks
 *
 * Invariant: every writer of result_submissions.status must keep the
 * submission's candidate votes' isVerified flag in lockstep with membership
 * in this set — the tally filters on BOTH the parent status and the flag.
 */
export const TALLY_ELIGIBLE_STATUSES: string[] = ["verified", "auto_validated"];

import { sql } from "drizzle-orm";

/**
 * Idempotent repair for rows written BEFORE the lockstep sync existed:
 * sets every vote's isVerified from its parent submission's membership in
 * TALLY_ELIGIBLE_STATUSES. Safe to re-run; covers all tenants.
 */
export async function backfillTallyEligibilityFlags(db: any): Promise<void> {
  // sql.join keeps each status a bound parameter (drizzle expands a raw JS
  // array into a row constructor, which ANY() rejects). The IS DISTINCT FROM
  // guard means steady-state runs write zero rows — only genuine mismatches.
  const eligible = sql`(s.status IN (${sql.join(
    TALLY_ELIGIBLE_STATUSES.map((st) => sql`${st}`),
    sql`, `,
  )}))`;
  await db.execute(sql`
    UPDATE submission_candidate_votes scv
    SET is_verified = ${eligible}
    FROM result_submissions s
    WHERE scv.submission_id = s.id
      AND scv.is_verified IS DISTINCT FROM ${eligible}
  `);
}
