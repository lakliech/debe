/**
 * Demo tenant seed — Debe platform shared demo environment
 * ⚠️  ALL DATA IS FICTIONAL AND FOR DEMONSTRATION PURPOSES ONLY ⚠️
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:demo
 *
 * Idempotent: safe to run multiple times — skips already-seeded sections.
 *
 * What it creates (all scoped to the demo tenant):
 *   - Tenant row  (slug=demo, plan=pro, custom_domain=demo.debe.ke)
 *   - Campaign branding
 *   - 6 polling agents assigned to real polling stations
 *   - 1 election + 4 candidates
 *   - 6 result submissions with candidate vote breakdowns
 *   - 10 volunteers
 *   - 10 supporters
 *   - 5 donations
 *   - 2 election incidents
 *   - 1 election dispute
 *
 * After running, follow the printed Clerk checklist to create demo accounts.
 */

import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import {
  tenantsTable,
  brandingTable,
  pollingAgentsTable,
  pollingStationsTable,
  electionsTable,
  candidatesTable,
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  volunteersTable,
  supportersTable,
  donationsTable,
  electionIncidentReportsTable,
  electionDisputesTable,
} from "@workspace/db";
import { eq, asc, and } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Placeholder Clerk org ID.
 * MUST be replaced with a real Clerk Organisation ID before demo users can log
 * in. See the post-run checklist printed at the end of this script.
 */
export const DEMO_CLERK_ORG_ID = "org_demo_debe_platform";

export const DEMO_SLUG = "demo";
const DEMO_DOMAIN = "demo.debe.ke";

// ── Helper ────────────────────────────────────────────────────────────────────

export async function getOrCreateTenant(): Promise<string> {
  console.log("  Checking for existing demo tenant…");
  const existing = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, DEMO_SLUG))
    .limit(1);

  if (existing.length) {
    console.log(`    Demo tenant already exists (id=${existing[0].id})`);
    return existing[0].id;
  }

  const [tenant] = await db
    .insert(tenantsTable)
    .values({
      clerkOrgId: DEMO_CLERK_ORG_ID,
      name: "Debe Demo Campaign",
      slug: DEMO_SLUG,
      plan: "pro",
      customDomain: DEMO_DOMAIN,
    })
    .returning({ id: tenantsTable.id });

  console.log(`    Created demo tenant (id=${tenant.id})`);
  return tenant.id;
}

// ── Branding ──────────────────────────────────────────────────────────────────

export async function seedBranding(tenantId: string): Promise<void> {
  console.log("  Seeding branding…");
  const existing = await db
    .select({ id: brandingTable.id })
    .from(brandingTable)
    .where(eq(brandingTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Branding already seeded");
    return;
  }

  await db.insert(brandingTable).values({
    tenantId,
    campaignName: "Amina Wanjiku 2027",
    candidateName: "Amina Wanjiku",
    positionTitle: "Presidential Candidate",
    partyName: "Umoja Party of Kenya",
    primaryColor: "161 84% 40%",   // deep teal
    secondaryColor: "0 0% 8%",
    accentColor: "39 100% 50%",
    tagline: "Ushindi wa Wananchi — Victory for the People",
    electionYear: 2027,
    electionLevel: "Presidential",
    mpesaPaybill: "4033049",
    socialTwitter: "@AminaWanjiku2027",
    socialFacebook: "AminaWanjiku2027",
  });
  console.log("    Branding inserted");
}

// ── Polling Agents ────────────────────────────────────────────────────────────

export async function seedPollingAgents(tenantId: string): Promise<{ id: string; stationId: string }[]> {
  console.log("  Seeding polling agents…");

  const existingAgents = await db
    .select({ id: pollingAgentsTable.id, pollingStationId: pollingAgentsTable.pollingStationId })
    .from(pollingAgentsTable)
    .where(eq(pollingAgentsTable.tenantId, tenantId))
    .limit(6);

  if (existingAgents.length >= 6) {
    console.log("    Polling agents already seeded");
    return existingAgents
      .filter(a => a.pollingStationId != null)
      .map(a => ({ id: a.id, stationId: a.pollingStationId! }));
  }

  // Pick 6 real polling stations from the DB
  const stations = await db
    .select({ id: pollingStationsTable.id, name: pollingStationsTable.name })
    .from(pollingStationsTable)
    .orderBy(asc(pollingStationsTable.code))
    .limit(6);

  if (!stations.length) {
    console.log("    No polling stations found — skipping agent seed");
    return [];
  }

  const agentData = [
    { fullName: "David Kimani Mwangi",    phoneNumber: "+254711000001", nationalId: "DM10001", status: "deployed"    },
    { fullName: "Grace Atieno Odhiambo",  phoneNumber: "+254711000002", nationalId: "GA10002", status: "deployed"    },
    { fullName: "Peter Mutua Ndegwa",     phoneNumber: "+254711000003", nationalId: "PM10003", status: "deployed"    },
    { fullName: "Fatuma Hassan Abdi",     phoneNumber: "+254711000004", nationalId: "FH10004", status: "deployed"    },
    { fullName: "James Ochieng Otieno",   phoneNumber: "+254711000005", nationalId: "JO10005", status: "deployed"    },
    { fullName: "Mary Wambui Kariuki",    phoneNumber: "+254711000006", nationalId: "MW10006", status: "registered"  },
  ];

  // Load any agents already seeded for this tenant (by nationalId) so we can
  // skip individual rows on re-runs without aborting the whole section.
  const existingByNationalId = new Set(
    (
      await db
        .select({ nationalId: pollingAgentsTable.nationalId })
        .from(pollingAgentsTable)
        .where(eq(pollingAgentsTable.tenantId, tenantId))
    )
      .map(r => r.nationalId)
      .filter(Boolean) as string[],
  );

  const allAgentRows = await db
    .select({ id: pollingAgentsTable.id, pollingStationId: pollingAgentsTable.pollingStationId, nationalId: pollingAgentsTable.nationalId })
    .from(pollingAgentsTable)
    .where(eq(pollingAgentsTable.tenantId, tenantId));

  const inserted: { id: string; stationId: string }[] = [];
  // Collect already-existing agents so they are returned even on re-runs.
  const existing: { id: string; stationId: string }[] = allAgentRows
    .filter(a => a.pollingStationId != null)
    .map(a => ({ id: a.id, stationId: a.pollingStationId! }));

  for (let i = 0; i < Math.min(agentData.length, stations.length); i++) {
    const agent = agentData[i];
    const station = stations[i];

    // Skip rows that were already inserted in a previous run.
    if (existingByNationalId.has(agent.nationalId)) continue;

    const [row] = await db
      .insert(pollingAgentsTable)
      .values({
        tenantId,
        ...agent,
        pollingStationId: station.id,
        accreditationStatus: "approved",
        trainingStatus: "completed",
        codeOfConductAccepted: true,
        codeOfConductDate: new Date("2027-05-01"),
        deploymentConfirmed: agent.status === "deployed",
        allowancePaid: false,
      })
      .returning({ id: pollingAgentsTable.id });

    inserted.push({ id: row.id, stationId: station.id });
  }

  const total = existing.length + inserted.length;
  if (inserted.length) {
    console.log(`    Inserted ${inserted.length} new polling agents (${total} total)`);
  } else {
    console.log(`    Polling agents already seeded (${total} total)`);
  }
  // Return the union: already-existing + newly-inserted
  return [...existing, ...inserted];
}

// ── Election ──────────────────────────────────────────────────────────────────

export async function seedElection(tenantId: string): Promise<string> {
  console.log("  Seeding election…");

  const existing = await db
    .select({ id: electionsTable.id })
    .from(electionsTable)
    .where(eq(electionsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Election already seeded");
    return existing[0].id;
  }

  const [election] = await db
    .insert(electionsTable)
    .values({
      tenantId,
      name: "Kenya Presidential Election 2027",
      year: 2027,
      electionDate: "2027-08-10",
      status: "upcoming",
      isActive: true,
    })
    .returning({ id: electionsTable.id });

  console.log("    Election inserted");
  return election.id;
}

// ── Candidates ────────────────────────────────────────────────────────────────

export async function seedCandidates(tenantId: string, electionId: string): Promise<{ id: string; name: string; abbreviation: string }[]> {
  console.log("  Seeding candidates…");

  const existing = await db
    .select({ id: candidatesTable.id, fullName: candidatesTable.fullName, partyAbbreviation: candidatesTable.partyAbbreviation })
    .from(candidatesTable)
    .where(eq(candidatesTable.tenantId, tenantId));

  if (existing.length >= 4) {
    console.log("    Candidates already seeded");
    return existing.map(c => ({ id: c.id, name: c.fullName, abbreviation: c.partyAbbreviation ?? "" }));
  }

  const candidateData = [
    { fullName: "Amina Wanjiku",      partyName: "Umoja Party of Kenya",   partyAbbreviation: "UPK",  isOurCandidate: true,  displayOrder: 1 },
    { fullName: "Kariuki Njoroge",    partyName: "Jubilee Alliance",       partyAbbreviation: "JAL",  isOurCandidate: false, displayOrder: 2 },
    { fullName: "Aisha Mwangi",       partyName: "Democratic Congress",    partyAbbreviation: "DC",   isOurCandidate: false, displayOrder: 3 },
    { fullName: "Samuel Oduya",       partyName: "People's Movement Party",partyAbbreviation: "PMP",  isOurCandidate: false, displayOrder: 4 },
  ];

  const rows = await db
    .insert(candidatesTable)
    .values(candidateData.map(c => ({ tenantId, electionId, ...c })))
    .returning({ id: candidatesTable.id, fullName: candidatesTable.fullName, partyAbbreviation: candidatesTable.partyAbbreviation });

  console.log(`    Inserted ${rows.length} candidates`);
  return rows.map(r => ({ id: r.id, name: r.fullName, abbreviation: r.partyAbbreviation ?? "" }));
}

// ── Result Submissions ────────────────────────────────────────────────────────

export async function seedResultSubmissions(
  tenantId: string,
  electionId: string,
  agents: { id: string; stationId: string }[],
  candidates: { id: string; name: string; abbreviation: string }[],
): Promise<void> {
  console.log("  Seeding result submissions…");

  const existing = await db
    .select({ id: resultSubmissionsTable.id })
    .from(resultSubmissionsTable)
    .where(eq(resultSubmissionsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Result submissions already seeded");
    return;
  }

  if (!agents.length || !candidates.length) {
    console.log("    No agents or candidates — skipping result submissions");
    return;
  }

  // Realistic vote distributions per station (our candidate leads)
  const stationVotes = [
    [312, 198, 87, 44],
    [276, 221, 95, 38],
    [401, 167, 73, 51],
    [289, 244, 102, 29],
    [355, 201, 88, 42],
    [298, 189, 91, 33],
  ];

  for (let i = 0; i < Math.min(agents.length, stationVotes.length); i++) {
    const agent = agents[i];
    const votes = stationVotes[i];
    const totalValid = votes.reduce((s, v) => s + v, 0);
    const totalCast = totalValid + 4; // small spoilt/rejected count
    const registered = totalCast + Math.floor(Math.random() * 50) + 100;

    const [submission] = await db
      .insert(resultSubmissionsTable)
      .values({
        tenantId,
        pollingStationId: agent.stationId,
        electionId,
        agentId: agent.id,
        status: i < 4 ? "verified" : "submitted",
        registeredVoters: registered,
        ballotsReceived: registered,
        ballotsIssued: totalCast,
        unusedBallots: registered - totalCast,
        spoiltBallots: 2,
        rejectedBallots: 2,
        totalValidVotes: totalValid,
        totalVotesCast: totalCast,
        agentSigned: true,
        agentReceivedCopy: true,
        resultsDisplayed: true,
        objectionRaised: i === 2, // one station with objection
        submittedAt: new Date("2027-08-10T17:30:00Z"),
        syncedAt: new Date("2027-08-10T18:00:00Z"),
        version: 1,
      })
      .returning({ id: resultSubmissionsTable.id });

    // Insert per-candidate votes
    const voteRows = candidates.map((c, ci) => ({
      submissionId: submission.id,
      candidateId: c.id,
      candidateName: c.name,
      partyAbbreviation: c.abbreviation,
      voteCount: votes[ci] ?? 0,
      isVerified: i < 4,
    }));

    await db.insert(submissionCandidateVotesTable).values(voteRows);
  }

  console.log(`    Inserted ${Math.min(agents.length, stationVotes.length)} result submissions`);
}

// ── Volunteers ────────────────────────────────────────────────────────────────

export async function seedVolunteers(tenantId: string): Promise<void> {
  console.log("  Seeding volunteers…");

  const existing = await db
    .select({ id: volunteersTable.id })
    .from(volunteersTable)
    .where(eq(volunteersTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Volunteers already seeded");
    return;
  }

  const volunteers = [
    { fullName: "Josephine Auma Otieno",   phoneNumber: "+254722101001", email: "j.auma@demo.debe.ke",    preferredRole: "agent_coordinator",   availability: "full_time",  status: "active"   },
    { fullName: "Brian Kipkemoi Langat",   phoneNumber: "+254722101002", email: "b.langat@demo.debe.ke",  preferredRole: "data_entry",          availability: "part_time",  status: "active"   },
    { fullName: "Naomi Wangechi Githinji", phoneNumber: "+254722101003", email: "n.wangechi@demo.debe.ke",preferredRole: "voter_education",      availability: "weekends",   status: "active"   },
    { fullName: "Hassan Abdullahi Bare",   phoneNumber: "+254722101004", email: "h.bare@demo.debe.ke",    preferredRole: "security_liaison",    availability: "full_time",  status: "pending"  },
    { fullName: "Cynthia Moraa Bosire",    phoneNumber: "+254722101005", email: "c.moraa@demo.debe.ke",   preferredRole: "social_media",        availability: "part_time",  status: "active"   },
    { fullName: "Elijah Omondi Ouma",      phoneNumber: "+254722101006", email: "e.omondi@demo.debe.ke",  preferredRole: "driver",              availability: "full_time",  status: "active"   },
    { fullName: "Purity Njeri Kamau",      phoneNumber: "+254722101007", email: "p.njeri@demo.debe.ke",   preferredRole: "logistics",           availability: "weekends",   status: "active"   },
    { fullName: "Victor Ochieng Adhiambo", phoneNumber: "+254722101008",                                     preferredRole: "photographer",        availability: "part_time",  status: "pending"  },
    { fullName: "Beatrice Chebet Rono",    phoneNumber: "+254722101009", email: "b.chebet@demo.debe.ke",  preferredRole: "interpreter_kalenjin",availability: "full_time",  status: "active"   },
    { fullName: "Samuel Gitonga Mwangi",   phoneNumber: "+254722101010", email: "s.gitonga@demo.debe.ke", preferredRole: "voter_registration",  availability: "full_time",  status: "active"   },
  ];

  await db.insert(volunteersTable).values(
    volunteers.map(v => ({
      tenantId,
      ...v,
      skills: ["communication", "mobilization"],
      languages: ["en", "sw"],
      consentGiven: true,
      consentDate: new Date("2027-01-15"),
    })),
  );
  console.log(`    Inserted ${volunteers.length} volunteers`);
}

// ── Supporters ────────────────────────────────────────────────────────────────

export async function seedSupporters(tenantId: string): Promise<void> {
  console.log("  Seeding supporters…");

  const existing = await db
    .select({ id: supportersTable.id })
    .from(supportersTable)
    .where(eq(supportersTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Supporters already seeded");
    return;
  }

  const supporters = [
    { fullName: "Rose Wambua Kiema",       email: "rose.wambua@example.com",    phoneNumber: "+254733201001", membershipStatus: "member"    },
    { fullName: "Francis Mwenda Mutua",    email: "f.mwenda@example.com",       phoneNumber: "+254733201002", membershipStatus: "supporter"  },
    { fullName: "Doris Adhiambo Were",     email: "doris.were@example.com",     phoneNumber: "+254733201003", membershipStatus: "member"    },
    { fullName: "Patrick Ngugi Kamande",   email: "p.ngugi@example.com",        phoneNumber: "+254733201004", membershipStatus: "donor"      },
    { fullName: "Sophia Chelimo Kirui",    email: "s.chelimo@example.com",      phoneNumber: "+254733201005", membershipStatus: "supporter"  },
    { fullName: "Anthony Opiyo Owino",     email: "a.opiyo@example.com",        phoneNumber: "+254733201006", membershipStatus: "member"    },
    { fullName: "Jane Wanjiku Gacheru",    email: "j.wanjiku.g@example.com",    phoneNumber: "+254733201007", membershipStatus: "supporter"  },
    { fullName: "Michael Njuguna Karanja", email: "m.njuguna@example.com",      phoneNumber: "+254733201008", membershipStatus: "donor"      },
    { fullName: "Caroline Achieng Oloo",   email: "c.achieng@example.com",      phoneNumber: "+254733201009", membershipStatus: "supporter"  },
    { fullName: "Geoffrey Korir Biwott",   email: "g.korir@example.com",        phoneNumber: "+254733201010", membershipStatus: "member"    },
  ];

  await db.insert(supportersTable).values(
    supporters.map(s => ({
      tenantId,
      ...s,
      consentMarketing: true,
      consentSms: true,
      consentEmail: true,
    })),
  );
  console.log(`    Inserted ${supporters.length} supporters`);
}

// ── Donations ─────────────────────────────────────────────────────────────────

export async function seedDonations(tenantId: string): Promise<void> {
  console.log("  Seeding donations…");

  const existing = await db
    .select({ id: donationsTable.id })
    .from(donationsTable)
    .where(eq(donationsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Donations already seeded");
    return;
  }

  const donations = [
    { donorFullName: "Anon Wanjiku",       amount: 5000,  paymentChannel: "mpesa",      transactionRef: "DEMO-TX-0001", campaignPurpose: "General Fund",        receiptNumber: "DEMO-RCT-0001" },
    { donorFullName: "Business Supporter", amount: 50000, paymentChannel: "bank_transfer",transactionRef: "DEMO-TX-0002", campaignPurpose: "Voter Education Fund",receiptNumber: "DEMO-RCT-0002" },
    { donorFullName: "Jane Chebet",        amount: 2500,  paymentChannel: "mpesa",      transactionRef: "DEMO-TX-0003", campaignPurpose: "Rally Fund",           receiptNumber: "DEMO-RCT-0003" },
    { donorFullName: "Youth Alliance KE",  amount: 15000, paymentChannel: "bank_transfer",transactionRef: "DEMO-TX-0004", campaignPurpose: "Digital Campaign",    receiptNumber: "DEMO-RCT-0004" },
    { donorFullName: "Peter M. Gachoki",   amount: 1000,  paymentChannel: "mpesa",      transactionRef: "DEMO-TX-0005", campaignPurpose: "General Fund",         receiptNumber: "DEMO-RCT-0005" },
  ];

  await db.insert(donationsTable).values(
    donations.map(d => ({
      tenantId,
      ...d,
      currency: "KES",
      verificationStatus: "verified",
      complianceFlag: false,
      paidAt: new Date("2027-06-15"),
    })),
  );
  console.log(`    Inserted ${donations.length} donations`);
}

// ── Election Incidents ────────────────────────────────────────────────────────

export async function seedIncidents(tenantId: string, electionId: string): Promise<void> {
  console.log("  Seeding election incidents…");

  const existing = await db
    .select({ id: electionIncidentReportsTable.id })
    .from(electionIncidentReportsTable)
    .where(eq(electionIncidentReportsTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Incidents already seeded");
    return;
  }

  // reportedBy is nullable (FK to users.id without NOT NULL) — omit it in the
  // demo seed so we don't need a real user row to satisfy the FK constraint.
  const incidents = [
    {
      incidentType: "voter_intimidation",
      severity: "high",
      title: "Voter intimidation at polling centre entrance",
      description: "[DEMO] Agent reported a group of unknown individuals blocking voters at the entrance to the polling centre and demanding to see their ID cards before they could enter. The matter was reported to the presiding officer and police were called.",
      escalationLevel: 2,
      status: "resolved",
      resolution: "Police dispersed the group within 20 minutes. Voting resumed normally.",
      occurredAt: new Date("2027-08-10T08:45:00Z"),
    },
    {
      incidentType: "equipment_failure",
      severity: "medium",
      title: "KIEMS kit biometric failure",
      description: "[DEMO] The KIEMS kit at Station 3 stopped reading fingerprints for approximately 45 minutes due to a connectivity issue. The presiding officer authorised manual verification using the printed register while the kit was rebooted and reconfigured.",
      escalationLevel: 1,
      status: "resolved",
      resolution: "IEBC technician restored kit functionality. All affected voters were re-queued and successfully verified.",
      occurredAt: new Date("2027-08-10T10:15:00Z"),
    },
  ];

  await db.insert(electionIncidentReportsTable).values(
    incidents.map(inc => ({ tenantId, electionId, ...inc })),
  );
  console.log(`    Inserted ${incidents.length} incidents`);
}

// ── Election Disputes ─────────────────────────────────────────────────────────

export async function seedDisputes(tenantId: string, electionId: string): Promise<void> {
  console.log("  Seeding election disputes…");

  const existing = await db
    .select({ id: electionDisputesTable.id })
    .from(electionDisputesTable)
    .where(eq(electionDisputesTable.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    console.log("    Disputes already seeded");
    return;
  }

  await db.insert(electionDisputesTable).values({
    tenantId,
    electionId,
    disputeType: "figure_discrepancy",
    title: "Vote count discrepancy — Station 3",
    description: "[DEMO] Agent-reported total valid votes (686) does not match the sum of individual candidate tallies (693) on the Form 34A for Station 3. The 7-vote discrepancy was flagged during initial verification.",
    status: "resolved",
    priority: "high",
    isAutoDetected: true,
    resolvedAt: new Date("2027-08-11T09:00:00Z"),
    resolutionNotes: "Discrepancy traced to a transcription error on the field form. Counter-checked against the original hand-written Form 34A and corrected via the submission corrections workflow.",
  });
  console.log("    Inserted 1 dispute");
}

// ── Clerk checklist printer ───────────────────────────────────────────────────

function printClerkChecklist(tenantId: string): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           ✅  Demo seed complete — Clerk setup checklist                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Demo tenant ID  : ${tenantId.padEnd(56)}║
║                                                                              ║
║  NOTHING BELOW IS REQUIRED for the public guided demo. Visiting /?demo=1     ║
║  signs a prospect in automatically: the API mints a short-lived Clerk        ║
║  sign-in ticket and provisions the shared demo account on first use.         ║
║  This seed is the only setup that flow needs.                                ║
║                                                                              ║
║  The row carries clerk_org_id = '${DEMO_CLERK_ORG_ID.padEnd(33)}'          ║
║  purely as a legacy marker. Campaign membership lives in user_roles, not     ║
║  in Clerk Organisations, so it does not need a real org ID.                  ║
║                                                                              ║
║  The steps below are ONLY for hands-on demos where a person needs to sign    ║
║  in as a specific role:                                                      ║
║                                                                              ║
║  1. Create three Clerk user accounts:                                        ║
║                                                                              ║
║     ┌─────────────────────────────────────────────────────────────┐         ║
║     │  Role             │ Email                    │ Password     │         ║
║     │─────────────────────────────────────────────────────────────│         ║
║     │  Campaign Admin   │ admin@demo.debe.ke    │ Demo@2027!   │         ║
║     │  County Coord.    │ coord@demo.debe.ke    │ Demo@2027!   │         ║
║     │  Field Agent      │ agent@demo.debe.ke    │ Demo@2027!   │         ║
║     └─────────────────────────────────────────────────────────────┘         ║
║                                                                              ║
║  2. In the Debe admin UI (/roles), assign:                                   ║
║       admin@demo.debe.ke  → role: campaign_admin                         ║
║       coord@demo.debe.ke  → role: county_coordinator                     ║
║       agent@demo.debe.ke  → role: polling_agent                          ║
║                                                                              ║
║  3. (Optional) Set custom_domain DNS:                                        ║
║       demo.debe.ke → CNAME or A record pointing at the platform.         ║
║                                                                              ║
║  ⚠️  Nightly reset is handled by a separate cron job (Task #101).            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🌱  Debe Demo Tenant — Seed Script");
  console.log("⚠️   ALL DATA IS FICTIONAL — FOR DEMONSTRATION ONLY\n");

  try {
    const tenantId = await getOrCreateTenant();

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

    printClerkChecklist(tenantId);
  } catch (err) {
    console.error("Demo seed error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run main() when this file is executed directly, not when imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
