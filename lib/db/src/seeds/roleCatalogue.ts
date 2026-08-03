/**
 * Role catalogue — the single source of truth for which roles exist and how
 * privileged each one is (lower level = more privileged).
 *
 * Deliberately free of any database import so it can be consumed both by the
 * seed runner and by the API server's startup bootstrap without an import
 * cycle. A role that is named in an API guard but missing here can be held by
 * nobody, so the guard silently grants no one access.
 */

export const ROLES = [
  { name: "Platform Administrator", slug: "platform_admin", level: 0, color: "#0f172a", description: "Cross-tenant platform operator — can create and manage campaign tenants. Assigned with NULL tenant_id." },
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

  // ── Delegate roles referenced by API route guards ──────────────────────────
  // These slugs are named in `requireRoles([...])` across the API but were
  // absent from this catalogue, so no user could ever hold them and the guards
  // granted nobody. Levels follow docs/roles-permissions.md where it specifies
  // one; otherwise they mirror the nearest existing role.
  { name: "Campaign Treasurer", slug: "campaign-treasurer", level: 2, color: "#a16207", description: "Approves campaign expenditure alongside the Treasurer" },
  { name: "Finance Manager", slug: "finance-manager", level: 3, color: "#f59e0b", description: "All financial operations; raises and approves expenditure" },
  { name: "Returning Officer", slug: "returning-officer", level: 3, color: "#991b1b", description: "Final expenditure approval and official results sign-off" },
  { name: "Data Officer", slug: "data-officer", level: 3, color: "#1e3a8a", description: "Data protection, export and compliance requests" },
  { name: "Security Officer", slug: "security-officer", level: 3, color: "#4b5563", description: "Day-to-day security operations under the Security Administrator" },
  { name: "Media Officer", slug: "media-officer", level: 3, color: "#db2777", description: "Press and media relations, rapid response and event publicity" },
  { name: "Result Verifier", slug: "result-verifier", level: 4, color: "#047857", description: "Verifies submitted results against source forms" },
  // Named by the four-eyes "Tally Verifiers" group in the privileged-access
  // review. Without them that separation-of-duties rule can never match.
  { name: "National Tally Verifier", slug: "national-tally-verifier", level: 4, color: "#0d9488", description: "National-level verification of aggregated tallies" },
  { name: "County Verification Officer", slug: "county-verification-officer", level: 4, color: "#65a30d", description: "County-level verification of submitted results" },
  { name: "Events Coordinator", slug: "events-coordinator", level: 4, color: "#c026d3", description: "Plans and runs campaign events and rallies" },
  { name: "Fact Checker", slug: "fact-checker", level: 4, color: "#9333ea", description: "Verifies claims for rapid-response communications" },
  { name: "Polling Agent Supervisor", slug: "polling-agent-supervisor", level: 5, color: "#2563eb", description: "Supervises polling agents across a cluster of stations" },
  { name: "Polling Agent", slug: "polling-agent", level: 7, color: "#4f46e5", description: "Submits results from an assigned polling station" },
] as const;
