/**
 * Comprehensive seed script — Linda Mwananchi 2027 Campaign Platform
 * ⚠️  ALL DATA IS FICTIONAL AND FOR DEMONSTRATION PURPOSES ONLY ⚠️
 *
 * Usage:
 *   pnpm exec tsx scripts/seed.ts
 *
 * Covers:
 *   - 47 counties, sample constituencies/wards/polling stations
 *   - Campaign officials for each major role
 *   - Volunteers, supporters, donors
 *   - Presidential candidates
 *   - Polling agents with mixed training/accreditation states
 *   - Result submissions in various verification states
 *   - Incidents and disputes
 *   - Data protection seed records
 *   - Retention policies
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/src/schema";
import { eq } from "drizzle-orm";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const FICTIONAL_NOTICE = "[DEMO DATA — FICTIONAL]";

// ── Kenyan Counties (all 47) ───────────────────────────────────────────────
const COUNTIES = [
  { code: "001", name: "Mombasa" }, { code: "002", name: "Kwale" },
  { code: "003", name: "Kilifi" }, { code: "004", name: "Tana River" },
  { code: "005", name: "Lamu" }, { code: "006", name: "Taita-Taveta" },
  { code: "007", name: "Garissa" }, { code: "008", name: "Wajir" },
  { code: "009", name: "Mandera" }, { code: "010", name: "Marsabit" },
  { code: "011", name: "Isiolo" }, { code: "012", name: "Meru" },
  { code: "013", name: "Tharaka-Nithi" }, { code: "014", name: "Embu" },
  { code: "015", name: "Kitui" }, { code: "016", name: "Machakos" },
  { code: "017", name: "Makueni" }, { code: "018", name: "Nyandarua" },
  { code: "019", name: "Nyeri" }, { code: "020", name: "Kirinyaga" },
  { code: "021", name: "Murang'a" }, { code: "022", name: "Kiambu" },
  { code: "023", name: "Turkana" }, { code: "024", name: "West Pokot" },
  { code: "025", name: "Samburu" }, { code: "026", name: "Trans-Nzoia" },
  { code: "027", name: "Uasin Gishu" }, { code: "028", name: "Elgeyo-Marakwet" },
  { code: "029", name: "Nandi" }, { code: "030", name: "Baringo" },
  { code: "031", name: "Laikipia" }, { code: "032", name: "Nakuru" },
  { code: "033", name: "Narok" }, { code: "034", name: "Kajiado" },
  { code: "035", name: "Kericho" }, { code: "036", name: "Bomet" },
  { code: "037", name: "Kakamega" }, { code: "038", name: "Vihiga" },
  { code: "039", name: "Bungoma" }, { code: "040", name: "Busia" },
  { code: "041", name: "Siaya" }, { code: "042", name: "Kisumu" },
  { code: "043", name: "Homa Bay" }, { code: "044", name: "Migori" },
  { code: "045", name: "Kisii" }, { code: "046", name: "Nyamira" },
  { code: "047", name: "Nairobi" },
];

async function seedCounties() {
  console.log("  Seeding counties…");
  const existing = await db.select({ code: schema.countiesTable.code }).from(schema.countiesTable);
  const existingCodes = new Set(existing.map((c) => c.code));
  const toInsert = COUNTIES.filter((c) => !existingCodes.has(c.code));
  if (toInsert.length) {
    await db.insert(schema.countiesTable).values(toInsert);
    console.log(`    Inserted ${toInsert.length} counties`);
  } else {
    console.log("    Counties already seeded");
  }
  return db.select().from(schema.countiesTable).orderBy(schema.countiesTable.code);
}

async function seedConstituencies(counties: schema.County[]) {
  console.log("  Seeding sample constituencies…");
  // Seed 3 constituencies per county (9 major ones in demo)
  const samples = [
    { code: "0471", name: "Westlands", countyId: "" },
    { code: "0472", name: "Dagoretti North", countyId: "" },
    { code: "0473", name: "Dagoretti South", countyId: "" },
    { code: "0321", name: "Nakuru East", countyId: "" },
    { code: "0322", name: "Nakuru West", countyId: "" },
    { code: "0421", name: "Kisumu Central", countyId: "" },
    { code: "0012", name: "Kwale Central", countyId: "" },
    { code: "0271", name: "Turbo", countyId: "" },
    { code: "0372", name: "Kakamega Central", countyId: "" },
  ];
  const nairobi = counties.find((c) => c.code === "047")!;
  const nakuru = counties.find((c) => c.code === "032")!;
  const kisumu = counties.find((c) => c.code === "042")!;
  const kwale = counties.find((c) => c.code === "002")!;
  const uasin = counties.find((c) => c.code === "027")!;
  const kakamega = counties.find((c) => c.code === "037")!;

  const withCounty = [
    { ...samples[0], countyId: nairobi.id },
    { ...samples[1], countyId: nairobi.id },
    { ...samples[2], countyId: nairobi.id },
    { ...samples[3], countyId: nakuru.id },
    { ...samples[4], countyId: nakuru.id },
    { ...samples[5], countyId: kisumu.id },
    { ...samples[6], countyId: kwale.id },
    { ...samples[7], countyId: uasin.id },
    { ...samples[8], countyId: kakamega.id },
  ];

  const existing = await db.select({ code: schema.constituenciesTable.code }).from(schema.constituenciesTable);
  const existingCodes = new Set(existing.map((c) => c.code));
  const toInsert = withCounty.filter((c) => !existingCodes.has(c.code));
  if (toInsert.length) {
    await db.insert(schema.constituenciesTable).values(toInsert);
  }
  return db.select().from(schema.constituenciesTable).limit(20);
}

async function seedPollingStations(constituencies: schema.Constituency[]) {
  console.log("  Seeding polling stations…");
  if (!constituencies.length) return [];

  const existing = await db.select({ code: schema.pollingStationsTable.code }).from(schema.pollingStationsTable);
  if (existing.length > 0) {
    console.log(`    ${existing.length} stations already exist`);
    return db.select().from(schema.pollingStationsTable).limit(20);
  }

  const statuses = ["pending", "accredited", "accredited", "accredited", "pending"] as const;
  const reportingStatuses = ["not_reporting", "reporting", "reporting", "reporting", "not_reporting"] as const;
  const trainingStatuses = ["not_started", "completed", "completed", "in_progress", "not_started"] as const;

  const stations = [];
  for (let i = 0; i < constituencies.length; i++) {
    const c = constituencies[i];
    for (let j = 1; j <= 4; j++) {
      stations.push({
        name: `${c.name} PS ${j} ${FICTIONAL_NOTICE}`,
        code: `${c.code}PS${j.toString().padStart(2, "0")}`,
        countyId: c.countyId,
        constituencyId: c.id,
        wardId: null,
        pollingCentreId: null,
        registeredVoters: Math.floor(Math.random() * 3000) + 500,
        accreditationStatus: statuses[j % statuses.length],
        trainingStatus: trainingStatuses[j % trainingStatuses.length],
        reportingStatus: reportingStatuses[j % reportingStatuses.length],
        hasAgent: j <= 3,
      });
    }
  }
  if (stations.length) {
    await db.insert(schema.pollingStationsTable).values(stations);
    console.log(`    Inserted ${stations.length} polling stations`);
  }
  return db.select().from(schema.pollingStationsTable).limit(20);
}

async function seedVolunteers(counties: schema.County[]) {
  console.log("  Seeding volunteers…");
  const existing = await db.select({ id: schema.volunteersTable.id }).from(schema.volunteersTable).limit(1);
  if (existing.length) { console.log("    Volunteers already seeded"); return; }

  const roles = ["voter-education", "mobiliser", "events", "data-entry", "logistics"];
  const statuses = ["active", "active", "active", "pending", "suspended"];

  const volunteers = counties.slice(0, 20).flatMap((county, ci) =>
    [1, 2, 3].map((vi) => ({
      fullName: `Demo Volunteer ${ci + 1}-${vi} ${FICTIONAL_NOTICE}`,
      email: `volunteer${ci + 1}${vi}@demo.invalid`,
      phoneNumber: `07${String(ci * 10 + vi).padStart(8, "0")}`,
      countyId: county.id,
      preferredRole: roles[vi % roles.length],
      status: statuses[vi % statuses.length] as any,
      skills: ["door-to-door"],
      consentGiven: true,
      consentDate: new Date("2027-01-01"),
    }))
  );
  await db.insert(schema.volunteersTable).values(volunteers);
  console.log(`    Inserted ${volunteers.length} volunteers`);
}

async function seedSupporters(counties: schema.County[]) {
  console.log("  Seeding supporters…");
  const existing = await db.select({ id: schema.supportersTable.id }).from(schema.supportersTable).limit(1);
  if (existing.length) { console.log("    Supporters already seeded"); return; }

  const statuses = ["supporter", "active_member", "champion"];
  const supporters = counties.slice(0, 30).flatMap((county, ci) =>
    [1, 2].map((si) => ({
      fullName: `Demo Supporter ${ci + 1}-${si} ${FICTIONAL_NOTICE}`,
      email: `supporter${ci + 1}${si}@demo.invalid`,
      phoneNumber: `07${String(ci * 10 + si).padStart(8, "0")}`,
      countyId: county.id,
      membershipStatus: statuses[(ci + si) % statuses.length] as any,
      consentMarketing: true,
      consentSms: true,
      consentEmail: true,
    }))
  );
  await db.insert(schema.supportersTable).values(supporters);
  console.log(`    Inserted ${supporters.length} supporters`);
}

async function seedContributions() {
  console.log("  Seeding sample donations…");
  const existing = await db.select({ id: schema.contributionsTable.id }).from(schema.contributionsTable).limit(1);
  if (existing.length) { console.log("    Contributions already seeded"); return; }

  const channels = ["mpesa", "bank_transfer", "cash", "mpesa", "mpesa"];
  const amounts = [500, 1000, 5000, 10000, 50000, 100000];
  const donations = Array.from({ length: 50 }, (_, i) => ({
    referenceNumber: `LIND-SEED-${String(i + 1).padStart(4, "0")}`,
    donorFullName: `Demo Donor ${i + 1} ${FICTIONAL_NOTICE}`,
    donorEmail: `donor${i + 1}@demo.invalid`,
    donorPhone: `07${String(i).padStart(8, "0")}`,
    amount: String(amounts[i % amounts.length]),
    currency: "KES",
    channel: channels[i % channels.length] as any,
    verificationStatus: i % 5 === 0 ? "pending" : "verified" as any,
    mpesaReceiptNumber: channels[i % channels.length] === "mpesa" ? `QD${String(i).padStart(8, "0")}` : undefined,
    donorEntityType: "individual" as any,
    ledger: "candidate" as any,
    contributionType: "one_off" as any,
    purpose: "general" as any,
  }));
  await db.insert(schema.contributionsTable).values(donations);
  console.log(`    Inserted ${donations.length} donations`);
}

async function seedPollingAgents(stations: schema.PollingStation[]) {
  console.log("  Seeding polling agents…");
  const existing = await db.select({ id: schema.pollingAgentsTable.id }).from(schema.pollingAgentsTable).limit(1);
  if (existing.length) { console.log("    Agents already seeded"); return; }

  const trainingStatuses = ["completed", "completed", "in_progress", "not_started"];
  const accreditStatuses = ["accredited", "accredited", "pending", "pending"];

  const agents = stations.slice(0, 16).map((s, i) => ({
    fullName: `Demo Agent ${i + 1} ${FICTIONAL_NOTICE}`,
    phoneNumber: `07${String(i).padStart(8, "0")}`,
    nationalId: `AG${String(i).padStart(7, "0")}`,
    pollingStationId: s.id,
    isBackup: i % 4 === 3,
    status: "registered" as any,
    trainingStatus: trainingStatuses[i % trainingStatuses.length] as any,
    accreditationStatus: accreditStatuses[i % accreditStatuses.length] as any,
    codeOfConductAccepted: i % 4 !== 3,
    codeOfConductDate: i % 4 !== 3 ? new Date("2027-06-01") : undefined,
  }));
  if (agents.length) {
    await db.insert(schema.pollingAgentsTable).values(agents);
    console.log(`    Inserted ${agents.length} agents`);
  }
}

async function seedElection() {
  console.log("  Seeding election…");
  const existing = await db.select({ id: schema.electionsTable.id }).from(schema.electionsTable).limit(1);
  if (existing.length) {
    console.log("    Election already exists");
    return existing[0].id;
  }
  const [election] = await db.insert(schema.electionsTable).values({
    name: `General Election 2027 ${FICTIONAL_NOTICE}`,
    year: 2027,
    electionDate: new Date("2027-08-10"),
    status: "active",
    isActive: true,
  }).returning();
  console.log(`    Inserted election ${election.id}`);
  return election.id;
}

async function seedCandidates(electionId: string) {
  console.log("  Seeding presidential candidates…");
  const existing = await db.select({ id: schema.presidentialCandidatesTable.id })
    .from(schema.presidentialCandidatesTable).where(eq(schema.presidentialCandidatesTable.electionId, electionId)).limit(1);
  if (existing.length) { console.log("    Candidates already seeded"); return; }

  const candidates = [
    { fullName: `Amara Nzingha ${FICTIONAL_NOTICE}`, partyName: "United People's Alliance", partyAbbreviation: "UPA", ballotPosition: 1, isOurCandidate: true },
    { fullName: `Kwame Otieno ${FICTIONAL_NOTICE}`, partyName: "National Democratic Front", partyAbbreviation: "NDF", ballotPosition: 2, isOurCandidate: false },
    { fullName: `Fatuma Wanjiku ${FICTIONAL_NOTICE}`, partyName: "Progressive Movement", partyAbbreviation: "PM", ballotPosition: 3, isOurCandidate: false },
    { fullName: `Jomo Kariuki ${FICTIONAL_NOTICE}`, partyName: "Reform Alliance", partyAbbreviation: "RA", ballotPosition: 4, isOurCandidate: false },
  ];
  await db.insert(schema.presidentialCandidatesTable).values(
    candidates.map((c) => ({ ...c, electionId }))
  );
  console.log(`    Inserted ${candidates.length} candidates`);
}

async function seedResultSubmissions(stations: schema.PollingStation[], electionId: string) {
  console.log("  Seeding result submissions…");
  const existing = await db.select({ id: schema.resultSubmissionsTable.id }).from(schema.resultSubmissionsTable).limit(1);
  if (existing.length) { console.log("    Submissions already seeded"); return; }

  const statuses = [
    "verified", "auto_validated", "submitted", "exception",
    "constituency_verification", "national_verification",
  ];
  const candidates = await db.select().from(schema.presidentialCandidatesTable)
    .where(eq(schema.presidentialCandidatesTable.electionId, electionId));
  if (!candidates.length) return;

  const submissions = [];
  const votes = [];

  for (let i = 0; i < Math.min(stations.length, 10); i++) {
    const station = stations[i];
    const totalVotes = Math.floor(Math.random() * 1000) + 200;
    const status = statuses[i % statuses.length] as any;

    const [sub] = await db.insert(schema.resultSubmissionsTable).values({
      pollingStationId: station.id,
      electionId,
      agentId: "00000000-0000-0000-0000-000000000001", // placeholder — seed agent
      status,
      version: 1,
      totalVotesCast: totalVotes,
      rejectedBallots: Math.floor(Math.random() * 20),
      submittedAt: new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000),
    }).returning();

    // Distribute votes among candidates
    let remaining = totalVotes;
    for (let ci = 0; ci < candidates.length; ci++) {
      const isLast = ci === candidates.length - 1;
      const voteCount = isLast ? remaining : Math.floor(remaining * (0.3 + Math.random() * 0.4));
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
    await db.insert(schema.submissionCandidateVotesTable).values(votes);
    console.log(`    Inserted ${stations.slice(0, 10).length} submissions with votes`);
  }
}

async function seedIncidents() {
  console.log("  Seeding election incidents…");
  const existing = await db.select({ id: schema.electionIncidentReportsTable.id }).from(schema.electionIncidentReportsTable).limit(1);
  if (existing.length) { console.log("    Incidents already seeded"); return; }

  // Need an election id for the required FK
  const elections = await db.select({ id: schema.electionsTable.id }).from(schema.electionsTable).limit(1);
  if (!elections.length) { console.log("    No election found — skipping incidents"); return; }
  const electionId = elections[0].id;

  const incidents = [
    { electionId, title: `Form 34A Discrepancy at Westlands PS 1 ${FICTIONAL_NOTICE}`, description: "Vote totals do not match. Under investigation.", incidentType: "tallying_dispute" as any, severity: "high" as any, status: "open" as any },
    { electionId, title: `Intimidation Report - Nakuru East ${FICTIONAL_NOTICE}`, description: "Agents report intimidation from unknown persons.", incidentType: "voter_intimidation" as any, severity: "critical" as any, status: "escalated" as any },
    { electionId, title: `Late Material Delivery - Kisumu ${FICTIONAL_NOTICE}`, description: "Ballot papers arrived 2 hours late.", incidentType: "missing_ballot_papers" as any, severity: "medium" as any, status: "resolved" as any },
    { electionId, title: `Connectivity Loss - Turkana ${FICTIONAL_NOTICE}`, description: "Agent unable to submit results — no network.", incidentType: "equipment_failure" as any, severity: "medium" as any, status: "open" as any },
    { electionId, title: `Turnout Anomaly - Mombasa ${FICTIONAL_NOTICE}`, description: "Reported turnout exceeds 98% at three stations.", incidentType: "counting_irregularity" as any, severity: "high" as any, status: "open" as any },
  ];
  await db.insert(schema.electionIncidentReportsTable).values(incidents);
  console.log(`    Inserted ${incidents.length} incidents`);
}

async function seedDisputes() {
  console.log("  Seeding election disputes…");
  const existing = await db.select({ id: schema.electionDisputesTable.id }).from(schema.electionDisputesTable).limit(1);
  if (existing.length) { console.log("    Disputes already seeded"); return; }

  const elections = await db.select({ id: schema.electionsTable.id }).from(schema.electionsTable).limit(1);
  if (!elections.length) return;
  const electionId = elections[0].id;

  const disputes = [
    { title: `Result Manipulation Claim - Westlands ${FICTIONAL_NOTICE}`, description: "Petitioner alleges results were altered at the polling centre.", disputeType: "figure_discrepancy" as any, status: "open" as any, priority: "high" as any, electionId },
    { title: `Agent Exclusion Dispute - Nakuru ${FICTIONAL_NOTICE}`, description: "Polling agent denied entry to polling station.", disputeType: "other" as any, status: "open" as any, priority: "medium" as any, electionId },
  ];
  await db.insert(schema.electionDisputesTable).values(disputes);
  console.log(`    Inserted ${disputes.length} disputes`);
}

async function seedRetentionPolicies() {
  console.log("  Seeding retention policies…");
  const existing = await db.select({ id: schema.dataRetentionPoliciesTable.id }).from(schema.dataRetentionPoliciesTable).limit(1);
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
  await db.insert(schema.dataRetentionPoliciesTable).values(policies);
  console.log(`    Inserted ${policies.length} retention policies`);
}

async function seedVendors() {
  console.log("  Seeding vendor register…");
  const existing = await db.select({ id: schema.vendorRegisterTable.id }).from(schema.vendorRegisterTable).limit(1);
  if (existing.length) { console.log("    Vendors already seeded"); return; }

  const vendors = [
    { vendorName: "Clerk (Authentication)", vendorType: "saas" as any, servicesProvided: "User identity management and authentication", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "low" as any, dpaSignedAt: new Date("2026-01-01") },
    { vendorName: "Neon / PostgreSQL (Database)", vendorType: "cloud" as any, servicesProvided: "Primary PostgreSQL database hosting", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "medium" as any },
    { vendorName: "Google Cloud Storage", vendorType: "cloud" as any, servicesProvided: "Object storage for documents and evidence files", countryOfOperation: "USA", adequacyDecision: false, transferMechanism: "sccs", riskRating: "medium" as any },
    { vendorName: "Safaricom M-Pesa (Paybill 3033049)", vendorType: "payment" as any, servicesProvided: "Mobile money donation collection", countryOfOperation: "Kenya", adequacyDecision: true, riskRating: "low" as any, dpaSignedAt: new Date("2026-01-01") },
  ];
  await db.insert(schema.vendorRegisterTable).values(vendors);
  console.log(`    Inserted ${vendors.length} vendors`);
}

async function main() {
  console.log("\n🌱  Linda Mwananchi 2027 — Seed Script");
  console.log("⚠️   ALL DATA IS FICTIONAL — FOR DEMONSTRATION ONLY\n");

  try {
    const counties = await seedCounties();
    const constituencies = await seedConstituencies(counties);
    const stations = await seedPollingStations(constituencies);
    await seedVolunteers(counties);
    await seedSupporters(counties);
    await seedContributions();
    await seedPollingAgents(stations);
    const electionId = await seedElection();
    await seedCandidates(electionId);
    await seedResultSubmissions(stations, electionId);
    await seedIncidents();
    await seedDisputes();
    await seedRetentionPolicies();
    await seedVendors();

    console.log("\n✅  Seed complete.");
    console.log("📋  Demo credentials: create accounts via /sign-up, then assign roles in /roles\n");
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
