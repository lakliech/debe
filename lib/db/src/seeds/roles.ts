import { db } from "../index";
import { rolesTable } from "../schema";
import { sql } from "drizzle-orm";

export const ROLES = [
  { name: "Super Administrator", slug: "super-admin", level: 1, color: "#7c3aed", description: "Full system access — all permissions across all levels" },
  { name: "Presidential Candidate", slug: "presidential-candidate", level: 1, color: "#dc2626", description: "The candidate — read access to all data, authorises comms" },
  { name: "Campaign Executive Director", slug: "campaign-exec-director", level: 2, color: "#b91c1c", description: "Overall campaign operations leader" },
  { name: "National Campaign Manager", slug: "national-campaign-manager", level: 2, color: "#c2410c", description: "Day-to-day national campaign management" },
  { name: "National Organising Director", slug: "national-organising-director", level: 2, color: "#b45309", description: "Volunteer and organiser network coordination" },
  { name: "County Coordinator", slug: "county-coordinator", level: 3, color: "#15803d", description: "County-level campaign operations (scoped to one county)" },
  { name: "Constituency Coordinator", slug: "constituency-coordinator", level: 4, color: "#0f766e", description: "Constituency-level operations" },
  { name: "Ward Coordinator", slug: "ward-coordinator", level: 5, color: "#0369a1", description: "Ward-level ground operations" },
  { name: "Polling Centre Coordinator", slug: "polling-centre-coordinator", level: 6, color: "#1d4ed8", description: "Manages a single polling centre" },
  { name: "Polling Station Agent", slug: "polling-station-agent", level: 7, color: "#4338ca", description: "Primary presiding agent at a polling station" },
  { name: "Backup Polling Agent", slug: "backup-polling-agent", level: 7, color: "#6d28d9", description: "Relief agent ready to substitute primary agent" },
  { name: "Volunteer", slug: "volunteer", level: 8, color: "#059669", description: "General campaign volunteer" },
  { name: "Donor", slug: "donor", level: 8, color: "#0891b2", description: "Financial supporter with donor-portal access" },
  { name: "Finance Officer", slug: "finance-officer", level: 3, color: "#d97706", description: "Manages campaign finances and disbursements" },
  { name: "Treasurer", slug: "treasurer", level: 2, color: "#ca8a04", description: "Chief custodian of campaign funds" },
  { name: "Communications Officer", slug: "communications-officer", level: 3, color: "#e11d48", description: "Creates and schedules campaign communications" },
  { name: "Content Approver", slug: "content-approver", level: 3, color: "#be185d", description: "Reviews and approves all outbound communications" },
  { name: "Legal Officer", slug: "legal-officer", level: 2, color: "#7e22ce", description: "Legal compliance and dispute resolution" },
  { name: "Verification Officer", slug: "verification-officer", level: 3, color: "#0e7490", description: "Verifies volunteer and agent identities" },
  { name: "Data Protection Officer", slug: "data-protection-officer", level: 2, color: "#1e40af", description: "ODPC compliance and data subject requests" },
  { name: "Security Administrator", slug: "security-admin", level: 2, color: "#374151", description: "Platform security, access controls, anomaly detection" },
  { name: "Auditor", slug: "auditor", level: 2, color: "#6b7280", description: "Read-only access to all audit logs and compliance reports" },
  { name: "Call Centre Agent", slug: "call-centre-agent", level: 8, color: "#78716c", description: "Handles inbound supporter enquiries" },
  { name: "Public Supporter", slug: "public-supporter", level: 10, color: "#84cc16", description: "Registered public supporter — minimal portal access" },
] as const;

import { brandingTable } from "../schema";

export async function seedBranding() {
  const existing = await db.select().from(brandingTable).limit(1);
  const data = {
    campaignName: "Linda Mwananchi",
    candidateName: "Linda Mwananchi Campaign",
    primaryColor: "#1D9BF0",
    secondaryColor: "#000000",
    accentColor: "#000000",
    tagline: "It's Time. Be Part of the Change.",
    electionYear: 2027,
    websiteUrl: "https://lindamwananchi.com",
    socialTwitter: "@LindaMwananchi",
  };
  if (existing[0]) {
    await db.update(brandingTable).set(data);
    console.log("✓ Branding updated");
  } else {
    await db.insert(brandingTable).values(data);
    console.log("✓ Branding seeded");
  }
}

export async function seedRoles() {
  console.log("Seeding roles...");
  for (const role of ROLES) {
    await db
      .insert(rolesTable)
      .values(role)
      .onConflictDoUpdate({
        target: rolesTable.slug,
        set: { name: role.name, description: role.description, level: role.level, color: role.color },
      });
  }
  console.log(`✓ ${ROLES.length} roles seeded`);
}
