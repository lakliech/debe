/**
 * Comprehensive seed script — Linda Mwananchi 2027 Campaign Platform
 * ⚠️  ALL DATA IS FICTIONAL AND FOR DEMONSTRATION PURPOSES ONLY ⚠️
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed
 *
 * Idempotent: safe to run multiple times — skips already-seeded sections.
 *
 * Covers:
 *   - Polling centres + polling stations (uses existing wards/constituencies/counties)
 *   - Volunteers, supporters, donations
 *   - Election, presidential candidates, polling agents
 *   - Result submissions with candidate vote distributions
 *   - Incidents, disputes
 *   - Data retention policies and vendor register
 */

import { db, pool } from "@workspace/db";
import {
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  volunteersTable,
  supportersTable,
  contributionsTable,
  pollingAgentsTable,
  electionsTable,
  candidatesTable,
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  electionIncidentReportsTable,
  electionDisputesTable,
  dataRetentionPoliciesTable,
  vendorRegisterTable,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const FICTIONAL_NOTICE = "[DEMO DATA — FICTIONAL]";

/** Load a page of existing data — used to seed dependent data. */
async function loadExisting<T>(table: any, limit = 50): Promise<T[]> {
  return db.select().from(table).limit(limit) as Promise<T[]>;
}

// ── Polling Centres & Stations ────────────────────────────────────────────────
async function seedPollingCentresAndStations() {
  console.log("  Seeding polling centres and stations…");

  // Check existing
  const existingStations = await db
    .select({ id: pollingStationsTable.id })
    .from(pollingStationsTable)
    .limit(1);
  if (existingStations.length) {
    console.log("    Polling stations already seeded");
    return db.select().from(pollingStationsTable).limit(40);
  }

  // Load up to 6 wards (each has constituency + county IDs)
  const wards = await db
    .select({
      id: wardsTable.id,
      code: wardsTable.code,
      name: wardsTable.name,
      constituencyId: wardsTable.constituencyId,
      countyId: wardsTable.countyId,
    })
    .from(wardsTable)
    .orderBy(asc(wardsTable.code))
    .limit(6);

  if (!wards.length) {
    console.log("    No wards found — skipping polling centre/station seed");
    return [];
  }

  const stationIds: { id: string }[] = [];

  for (let wi = 0; wi < wards.length; wi++) {
    const ward = wards[wi];

    // Create one polling centre per ward
    const [centre] = await db.insert(pollingCentresTable).values({
      name: `Demo Centre ${wi + 1} ${FICTIONAL_NOTICE}`,
      wardId: ward.id,
      constituencyId: ward.constituencyId,
      countyId: ward.countyId,
    }).returning({ id: pollingCentresTable.id });

    // Create 3 polling stations per centre
    for (let si = 1; si <= 3; si++) {
      const code = `DEMO${String(ward.code).padStart(4, "0")}PS${si}`;
      const [station] = await db.insert(pollingStationsTable).values({
        code,
        name: `Demo Station ${wi + 1}-${si} ${FICTIONAL_NOTICE}`,
        centreId: centre.id,
        wardId: ward.id,
        constituencyId: ward.constituencyId,
        countyId: ward.countyId,
        registeredVoters: 500 + wi * 100 + si * 17,
        accreditationStatus: si <= 2 ? "accredited" : "pending",
        trainingStatus: si === 1 ? "completed" : "in_progress",
        reportingStatus: si === 1 ? "reporting" : "not_reported",
      }).returning({ id: pollingStationsTable.id });
      stationIds.push({ id: station.id });
    }
  }

  console.log(`    Inserted ${stationIds.length} polling stations across ${wards.length} wards`);
  return db.select().from(pollingStationsTable).limit(40);
}

// ── Volunteers ────────────────────────────────────────────────────────────────
async function seedVolunteers() {
  console.log("  Seeding volunteers…");
  const existing = await db.select({ id: volunteersTable.id }).from(volunteersTable).limit(1);
  if (existing.length) { console.log("    Volunteers already seeded"); return; }

  const counties = await db
    .select({ id: countiesTable.id })
    .from(countiesTable)
    .orderBy(asc(countiesTable.code))
    .limit(20);

  if (!counties.length) { console.log("    No counties — skipping volunteers"); return; }

  const roles = ["voter-education", "mobiliser", "events", "data-entry", "logistics"];
  const statuses = ["active", "active", "active", "pending", "suspended"];

  const volunteers = counties.flatMap((county, ci) =>
    [1, 2, 3].map((vi) => ({
      fullName: `Demo Volunteer ${ci + 1}-${vi} ${FICTIONAL_NOTICE}`,
      email: `volunteer${ci + 1}_${vi}@demo.invalid`,
      phoneNumber: `070${String(ci * 10 + vi).padStart(7, "0")}`,
      countyId: county.id,
      preferredRole: roles[vi % roles.length],
      status: statuses[vi % statuses.length] as any,
      skills: ["door-to-door"],
      consentGiven: true,
      consentDate: new Date("2027-01-01"),
    }))
  );
  await db.insert(volunteersTable).values(volunteers);
  console.log(`    Inserted ${volunteers.length} volunteers`);
}

// ── Supporters ────────────────────────────────────────────────────────────────
async function seedSupporters() {
  console.log("  Seeding supporters…");
  const existing = await db.select({ id: supportersTable.id }).from(supportersTable).limit(1);
  if (existing.length) { console.log("    Supporters already seeded"); return; }

  const counties = await db
    .select({ id: countiesTable.id })
    .from(countiesTable)
    .orderBy(asc(countiesTable.code))
    .limit(30);

  if (!counties.length) { console.log("    No counties — skipping supporters"); return; }

  const statuses = ["supporter", "active_member", "champion"];
  const supporters = counties.flatMap((county, ci) =>
    [1, 2].map((si) => ({
      fullName: `Demo Supporter ${ci + 1}-${si} ${FICTIONAL_NOTICE}`,
      email: `supporter${ci + 1}_${si}@demo.invalid`,
      phoneNumber: `071${String(ci * 10 + si).padStart(7, "0")}`,
      countyId: county.id,
      membershipStatus: statuses[(ci + si) % statuses.length] as any,
      consentMarketing: true,
      consentSms: true,
      consentEmail: true,
    }))
  );
  await db.insert(supportersTable).values(supporters);
  console.log(`    Inserted ${supporters.length} supporters`);
}

// ── Contributions ─────────────────────────────────────────────────────────────
async function seedContributions() {
  console.log("  Seeding sample donations…");
  const existing = await db.select({ id: contributionsTable.id }).from(contributionsTable).limit(1);
  if (existing.length) { console.log("    Contributions already seeded"); return; }

  const channels = ["mpesa", "bank_transfer", "cash", "mpesa", "mpesa"] as const;
  const amounts = [500, 1000, 5000, 10000, 50000, 100000];
  const donations = Array.from({ length: 50 }, (_, i) => ({
    referenceNumber: `LIND-SEED-${String(i + 1).padStart(4, "0")}`,
    donorFullName: `Demo Donor ${i + 1} ${FICTIONAL_NOTICE}`,
    donorEmail: `donor${i + 1}@demo.invalid`,
    donorPhone: `072${String(i).padStart(7, "0")}`,
    amount: String(amounts[i % amounts.length]),
    currency: "KES",
    channel: channels[i % channels.length],
    verificationStatus: i % 5 === 0 ? "pending" : "verified",
    mpesaReceiptNumber: channels[i % channels.length] === "mpesa"
      ? `QD${String(i).padStart(8, "0")}` : undefined,
    donorEntityType: "individual",
    ledger: "candidate",
    contributionType: "one_off",
    purpose: "general",
  }));
  await db.insert(contributionsTable).values(donations as any);
  console.log(`    Inserted ${donations.length} donations`);
}

// ── Election & Candidates ─────────────────────────────────────────────────────
async function seedElection(): Promise<string> {
  console.log("  Seeding election…");
  const existing = await db
    .select({ id: electionsTable.id })
    .from(electionsTable)
    .where(eq(electionsTable.year, 2027))
    .limit(1);
  if (existing.length) {
    console.log("    Election already exists");
    return existing[0].id;
  }
  const [election] = await db.insert(electionsTable).values({
    name: `General Election 2027 ${FICTIONAL_NOTICE}`,
    year: 2027,
    electionDate: "2027-08-10",
    status: "active",
    isActive: true,
  }).returning({ id: electionsTable.id });
  console.log(`    Inserted election ${election.id}`);
  return election.id;
}

async function seedCandidates(electionId: string) {
  console.log("  Seeding presidential candidates…");
  const existing = await db
    .select({ id: candidatesTable.id })
    .from(candidatesTable)
    .where(eq(candidatesTable.electionId, electionId))
    .limit(1);
  if (existing.length) { console.log("    Candidates already seeded"); return; }

  const candidates = [
    { fullName: `Amara Nzingha ${FICTIONAL_NOTICE}`, partyName: "United People's Alliance", partyAbbreviation: "UPA", displayOrder: 1, isOurCandidate: true },
    { fullName: `Kwame Otieno ${FICTIONAL_NOTICE}`, partyName: "National Democratic Front", partyAbbreviation: "NDF", displayOrder: 2, isOurCandidate: false },
    { fullName: `Fatuma Wanjiku ${FICTIONAL_NOTICE}`, partyName: "Progressive Movement", partyAbbreviation: "PM", displayOrder: 3, isOurCandidate: false },
    { fullName: `Jomo Kariuki ${FICTIONAL_NOTICE}`, partyName: "Reform Alliance", partyAbbreviation: "RA", displayOrder: 4, isOurCandidate: false },
  ];
  await db.insert(candidatesTable).values(candidates.map((c) => ({ ...c, electionId })));
  console.log(`    Inserted ${candidates.length} candidates`);
}

// ── Polling Agents ────────────────────────────────────────────────────────────
async function seedPollingAgents(stations: { id: string }[]): Promise<{ id: string }[]> {
  console.log("  Seeding polling agents…");
  const existing = await db
    .select({ id: pollingAgentsTable.id })
    .from(pollingAgentsTable)
    .limit(1);
  if (existing.length) {
    console.log("    Agents already seeded");
    return db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable).limit(40);
  }

  const trainingStatuses = ["completed", "completed", "in_progress", "not_started"];
  const accreditStatuses = ["accredited", "accredited", "pending", "pending"];

  const stationsToUse = stations.slice(0, 16);
  if (!stationsToUse.length) {
    console.log("    No polling stations — skipping agent seed");
    return [];
  }

  const agents = stationsToUse.map((s, i) => ({
    fullName: `Demo Agent ${i + 1} ${FICTIONAL_NOTICE}`,
    phoneNumber: `073${String(i).padStart(7, "0")}`,
    nationalId: `AG${String(i).padStart(7, "0")}`,
    pollingStationId: s.id,
    isBackup: i % 4 === 3,
    status: "registered" as const,
    trainingStatus: trainingStatuses[i % trainingStatuses.length],
    accreditationStatus: accreditStatuses[i % accreditStatuses.length],
    codeOfConductAccepted: i % 4 !== 3,
    codeOfConductDate: i % 4 !== 3 ? new Date("2027-06-01") : undefined,
  }));

  const inserted = await db.insert(pollingAgentsTable).values(agents as any).returning({ id: pollingAgentsTable.id });
  console.log(`    Inserted ${inserted.length} agents`);
  return inserted;
}

// ── Result Submissions ────────────────────────────────────────────────────────
async function seedResultSubmissions(
  stations: { id: string }[],
  agents: { id: string }[],
  electionId: string,
) {
  console.log("  Seeding result submissions…");
  const existing = await db
    .select({ id: resultSubmissionsTable.id })
    .from(resultSubmissionsTable)
    .limit(1);
  if (existing.length) { console.log("    Submissions already seeded"); return; }

  const candidates = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.electionId, electionId));

  if (!candidates.length || !stations.length || !agents.length) {
    console.log("    Missing candidates/stations/agents — skipping submissions");
    return;
  }

  const statuses = ["verified", "auto_validated", "submitted", "exception", "constituency_verification"];
  const votes: any[] = [];
  const count = Math.min(stations.length, 10, agents.length);

  for (let i = 0; i < count; i++) {
    const station = stations[i];
    const agent = agents[i % agents.length];
    const totalVotes = 200 + i * 73 + 37;
    const status = statuses[i % statuses.length] as any;

    const [sub] = await db.insert(resultSubmissionsTable).values({
      pollingStationId: station.id,
      electionId,
      agentId: agent.id,
      status,
      version: 1,
      totalVotesCast: totalVotes,
      rejectedBallots: (i * 3) % 20,
      submittedAt: new Date("2027-08-10T14:00:00Z"),
    }).returning({ id: resultSubmissionsTable.id });

    let remaining = totalVotes;
    const shares = [0.45, 0.27, 0.17]; // first three candidates; last gets remainder
    for (let ci = 0; ci < candidates.length; ci++) {
      const isLast = ci === candidates.length - 1;
      const voteCount = isLast
        ? Math.max(0, remaining)
        : Math.floor(totalVotes * (shares[ci] ?? 0.05));
      remaining -= voteCount;
      votes.push({
        submissionId: sub.id,
        candidateId: candidates[ci].id,
        candidateName: candidates[ci].fullName,
        partyAbbreviation: candidates[ci].partyAbbreviation ?? undefined,
        voteCount: Math.max(0, voteCount),
      });
    }
  }

  if (votes.length) {
    await db.insert(submissionCandidateVotesTable).values(votes);
    console.log(`    Inserted ${count} submissions with candidate votes`);
  }
}

// ── Incidents ─────────────────────────────────────────────────────────────────
async function seedIncidents(electionId: string) {
  console.log("  Seeding election incidents…");
  const existing = await db
    .select({ id: electionIncidentReportsTable.id })
    .from(electionIncidentReportsTable)
    .limit(1);
  if (existing.length) { console.log("    Incidents already seeded"); return; }

  const incidents = [
    { electionId, title: `Form 34A Discrepancy - Westlands ${FICTIONAL_NOTICE}`, description: "Vote totals do not match. Under investigation.", incidentType: "tallying_dispute", severity: "high", status: "open" },
    { electionId, title: `Intimidation Report - Nakuru East ${FICTIONAL_NOTICE}`, description: "Agents report intimidation from unknown persons.", incidentType: "voter_intimidation", severity: "critical", status: "escalated" },
    { electionId, title: `Late Material Delivery - Kisumu ${FICTIONAL_NOTICE}`, description: "Ballot papers arrived 2 hours late.", incidentType: "missing_ballot_papers", severity: "medium", status: "resolved" },
    { electionId, title: `Connectivity Loss - Turkana ${FICTIONAL_NOTICE}`, description: "Agent unable to submit results — no network.", incidentType: "equipment_failure", severity: "medium", status: "open" },
    { electionId, title: `Turnout Anomaly - Mombasa ${FICTIONAL_NOTICE}`, description: "Reported turnout exceeds 98% at three stations.", incidentType: "counting_irregularity", severity: "high", status: "open" },
  ];
  await db.insert(electionIncidentReportsTable).values(incidents as any);
  console.log(`    Inserted ${incidents.length} incidents`);
}

// ── Disputes ──────────────────────────────────────────────────────────────────
async function seedDisputes(electionId: string) {
  console.log("  Seeding election disputes…");
  const existing = await db
    .select({ id: electionDisputesTable.id })
    .from(electionDisputesTable)
    .limit(1);
  if (existing.length) { console.log("    Disputes already seeded"); return; }

  const disputes = [
    { electionId, title: `Result Manipulation Claim - Westlands ${FICTIONAL_NOTICE}`, description: "Petitioner alleges results were altered at the polling centre.", disputeType: "figure_discrepancy", status: "open", priority: "high" },
    { electionId, title: `Agent Exclusion Dispute - Nakuru ${FICTIONAL_NOTICE}`, description: "Polling agent denied entry to polling station.", disputeType: "other", status: "open", priority: "medium" },
  ];
  await db.insert(electionDisputesTable).values(disputes as any);
  console.log(`    Inserted ${disputes.length} disputes`);
}

// ── Retention Policies ────────────────────────────────────────────────────────
async function seedRetentionPolicies() {
  console.log("  Seeding retention policies…");
  const existing = await db
    .select({ id: dataRetentionPoliciesTable.id })
    .from(dataRetentionPoliciesTable)
    .limit(1);
  if (existing.length) { console.log("    Retention policies already seeded"); return; }

  const policies = [
    { dataCategory: "volunteers", retentionDays: 1095, legalBasis: "consent", description: "3-year post-campaign retention", autoDelete: false },
    { dataCategory: "supporters", retentionDays: 1095, legalBasis: "legitimate_interest", description: "CRM data — 3-year retention", autoDelete: false },
    { dataCategory: "donors", retentionDays: 2555, legalBasis: "legal_obligation", description: "7-year statutory financial record obligation", autoDelete: false },
    { dataCategory: "agents", retentionDays: 1825, legalBasis: "contract", description: "5-year post-election retention for legal defence", autoDelete: false },
    { dataCategory: "results", retentionDays: 3650, legalBasis: "legal_obligation", description: "10-year statutory election record retention", autoDelete: false },
    { dataCategory: "audit_logs", retentionDays: 3650, legalBasis: "legal_obligation", description: "Audit logs retained 10 years — non-deletable", autoDelete: false },
    { dataCategory: "financial", retentionDays: 2555, legalBasis: "legal_obligation", description: "7-year EACC and KRA compliance", autoDelete: false },
  ];
  await db.insert(dataRetentionPoliciesTable).values(policies);
  console.log(`    Inserted ${policies.length} retention policies`);
}

// ── Vendor Register ───────────────────────────────────────────────────────────
async function seedVendors() {
  console.log("  Seeding vendor register…");
  const existing = await db
    .select({ id: vendorRegisterTable.id })
    .from(vendorRegisterTable)
    .limit(1);
  if (existing.length) { console.log("    Vendors already seeded"); return; }

  const vendors = [
    { vendorName: "Clerk (Authentication)", vendorType: "saas", servicesProvided: "User identity management and authentication", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "low", dpaSignedAt: new Date("2026-01-01") },
    { vendorName: "Neon / PostgreSQL (Database)", vendorType: "cloud", servicesProvided: "Primary PostgreSQL database hosting", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "medium" },
    { vendorName: "Google Cloud Storage", vendorType: "cloud", servicesProvided: "Object storage for documents and evidence files", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "medium" },
    { vendorName: "Safaricom M-Pesa (Paybill 3033049)", vendorType: "payment", servicesProvided: "Mobile money donation collection", countryOfOperation: "Kenya", adequacyDecision: true, riskRating: "low", dpaSignedAt: new Date("2026-01-01") },
  ];
  await db.insert(vendorRegisterTable).values(vendors as any);
  console.log(`    Inserted ${vendors.length} vendors`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🌱  Linda Mwananchi 2027 — Seed Script");
  console.log("⚠️   ALL DATA IS FICTIONAL — FOR DEMONSTRATION ONLY\n");

  try {
    // Geography already seeded — just seed centres/stations using existing wards
    const stations = await seedPollingCentresAndStations();

    // Campaign data
    await seedVolunteers();
    await seedSupporters();
    await seedContributions();
    const agents = await seedPollingAgents(stations);
    const electionId = await seedElection();
    await seedCandidates(electionId);
    await seedResultSubmissions(stations, agents, electionId);
    await seedIncidents(electionId);
    await seedDisputes(electionId);
    await seedRetentionPolicies();
    await seedVendors();

    console.log("\n✅  Seed complete.");
    console.log("📋  Create accounts via /sign-up then assign roles at /roles\n");
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
