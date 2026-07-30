/**
 * Demo tenant reset — truncates and re-seeds the shared Debe demo environment.
 * ⚠️  DESTRUCTIVE — deletes all resettable data for the demo tenant.
 *
 * Usage (on-demand):
 *   pnpm --filter @workspace/scripts run reset:demo
 *
 * Scheduled use:
 *   Triggered nightly at 23:00 UTC by the API server cron job in
 *   artifacts/api-server/src/jobs/demoReset.ts when DEMO_RESET_ENABLED=true.
 *
 * What is deleted (all scoped strictly to the demo tenant_id):
 *   submission_candidate_votes → result_submissions → polling_agents
 *   election_disputes → election_incident_reports
 *   donations → volunteers → supporters → activity_feed
 *
 * What is preserved (stable reference data):
 *   tenants row, branding, elections, candidates
 *
 * After deletion the canonical seed data is re-inserted by calling the
 * exported seed functions from seed-demo-tenant.ts.
 */

import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import {
  tenantsTable,
  activityFeedTable,
  pollingAgentsTable,
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  volunteersTable,
  supportersTable,
  donationsTable,
  electionIncidentReportsTable,
  electionDisputesTable,
  electionsTable,
  candidatesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  DEMO_SLUG,
  seedBranding,
  seedPollingAgents,
  seedElection,
  seedCandidates,
  seedResultSubmissions,
  seedVolunteers,
  seedSupporters,
  seedDonations,
  seedIncidents,
  seedDisputes,
} from "./seed-demo-tenant.js";

// Nil UUID used as the userId for system-generated activity-feed entries
// (activityFeedTable.userId is NOT NULL but has no FK reference).
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ── Delete all resettable demo-tenant data ────────────────────────────────────

async function deleteDemoTenantData(tenantId: string): Promise<void> {
  console.log("  Deleting resettable demo data…");

  // 1. submission_candidate_votes — child of result_submissions (cascade ON DELETE
  //    would handle this, but we are explicit to avoid schema assumptions).
  const submissions = await db
    .select({ id: resultSubmissionsTable.id })
    .from(resultSubmissionsTable)
    .where(eq(resultSubmissionsTable.tenantId, tenantId));

  if (submissions.length) {
    const submissionIds = submissions.map(s => s.id);
    const deleted = await db
      .delete(submissionCandidateVotesTable)
      .where(inArray(submissionCandidateVotesTable.submissionId, submissionIds));
    console.log(`    Deleted submission_candidate_votes`);
  }

  // 2. election_disputes — references result_submissions
  const disputesDel = await db
    .delete(electionDisputesTable)
    .where(eq(electionDisputesTable.tenantId, tenantId));
  console.log(`    Deleted election_disputes`);

  // 3. result_submissions — references polling_agents
  await db
    .delete(resultSubmissionsTable)
    .where(eq(resultSubmissionsTable.tenantId, tenantId));
  console.log(`    Deleted result_submissions`);

  // 4. polling_agents
  await db
    .delete(pollingAgentsTable)
    .where(eq(pollingAgentsTable.tenantId, tenantId));
  console.log(`    Deleted polling_agents`);

  // 5. election_incident_reports
  await db
    .delete(electionIncidentReportsTable)
    .where(eq(electionIncidentReportsTable.tenantId, tenantId));
  console.log(`    Deleted election_incident_reports`);

  // 6. donations
  await db
    .delete(donationsTable)
    .where(eq(donationsTable.tenantId, tenantId));
  console.log(`    Deleted donations`);

  // 7. volunteers
  await db
    .delete(volunteersTable)
    .where(eq(volunteersTable.tenantId, tenantId));
  console.log(`    Deleted volunteers`);

  // 8. supporters
  await db
    .delete(supportersTable)
    .where(eq(supportersTable.tenantId, tenantId));
  console.log(`    Deleted supporters`);

  // 9. activity_feed — clear previous reset notices so they don't accumulate
  await db
    .delete(activityFeedTable)
    .where(eq(activityFeedTable.tenantId, tenantId));
  console.log(`    Deleted activity_feed`);

  console.log("  Deletion complete.");
}

// ── Re-seed from canonical state ──────────────────────────────────────────────

async function reseedDemoData(tenantId: string): Promise<void> {
  console.log("  Re-seeding demo data…");

  // elections and candidates are preserved — retrieve their IDs
  const [election] = await db
    .select({ id: electionsTable.id })
    .from(electionsTable)
    .where(eq(electionsTable.tenantId, tenantId))
    .limit(1);

  if (!election) {
    console.log("    No election found — running full seed instead of partial reset");
    await seedBranding(tenantId);
    const agents = await seedPollingAgents(tenantId);
    const electionId = await seedElection(tenantId);
    const candidates = await seedCandidates(tenantId, electionId);
    await seedResultSubmissions(tenantId, electionId, agents, candidates);
    await seedVolunteers(tenantId);
    await seedSupporters(tenantId);
    await seedDonations(tenantId);
    await seedIncidents(tenantId, electionId);
    await seedDisputes(tenantId, electionId);
    return;
  }

  const existingCandidates = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
      partyAbbreviation: candidatesTable.partyAbbreviation,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.tenantId, tenantId));

  const candidates = existingCandidates.map(c => ({
    id: c.id,
    name: c.fullName,
    abbreviation: c.partyAbbreviation ?? "",
  }));

  // Re-seed resettable tables — they are now empty so all seed functions will insert
  const agents = await seedPollingAgents(tenantId);
  await seedResultSubmissions(tenantId, election.id, agents, candidates);
  await seedVolunteers(tenantId);
  await seedSupporters(tenantId);
  await seedDonations(tenantId);
  await seedIncidents(tenantId, election.id);
  await seedDisputes(tenantId, election.id);
}

// ── Activity feed notice ──────────────────────────────────────────────────────

async function writeResetActivity(tenantId: string): Promise<void> {
  await db.insert(activityFeedTable).values({
    tenantId,
    type: "demo_reset",
    description: "Demo data restored to clean state",
    userId: SYSTEM_USER_ID,
    userName: "Debe Platform",
    resource: "demo",
  });
  console.log("  Activity feed entry written.");
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runDemoReset(): Promise<void> {
  console.log("\n🔄  Debe Demo Tenant — Nightly Reset");
  console.log("⚠️   ALL DATA IS FICTIONAL — FOR DEMONSTRATION ONLY\n");
  const startedAt = Date.now();

  // Look up the demo tenant
  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, DEMO_SLUG))
    .limit(1);

  if (!tenant) {
    throw new Error(
      `Demo tenant (slug='${DEMO_SLUG}') not found. Run seed:demo first.`,
    );
  }

  console.log(`  Demo tenant id: ${tenant.id}`);

  await deleteDemoTenantData(tenant.id);
  await reseedDemoData(tenant.id);
  await writeResetActivity(tenant.id);

  const elapsedMs = Date.now() - startedAt;
  console.log(`\n✅  Demo reset complete in ${(elapsedMs / 1000).toFixed(1)}s.\n`);
}

async function main(): Promise<void> {
  try {
    await runDemoReset();
  } catch (err) {
    console.error("Demo reset error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run main() when this file is executed directly, not when imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
