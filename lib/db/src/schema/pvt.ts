/**
 * pvt.ts — Parallel Vote Tabulation (PVT) schema.
 *
 * PVT lets a campaign project results before the official announcement using
 * a stratified PPS sample of its own polling stations. Quick reports are
 * intentionally separate from full result-form submissions: simplified counts
 * arrive first for live projections, full audit forms follow the existing
 * submission pipeline.
 */
import { pgTable, uuid, text, integer, doublePrecision, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { electionsTable, pollingAgentsTable } from "./config";
import { tenantsTable } from "./core";
import { countiesTable, constituenciesTable, pollingStationsTable } from "./geography";

/** Configuration for one PVT sample design. */
export const pvtSampleDesignsTable = pgTable("pvt_sample_designs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  stratumLevel: text("stratum_level").notNull(), // "county" | "constituency"
  targetSampleSize: integer("target_sample_size").notNull(),
  confidenceLevel: doublePrecision("confidence_level").notNull().default(0.95),
  marginOfError: doublePrecision("margin_of_error").notNull().default(0.015),
  selectionMethod: text("selection_method").notNull().default("pps"),
  status: text("status").notNull().default("draft"), // draft | active | closed | archived
  generatedBy: text("generated_by"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("pvt_designs_tenant_election_idx").on(t.tenantId, t.electionId),
  index("pvt_designs_status_idx").on(t.tenantId, t.status),
]);

/** Individual stations drawn into a sample. */
export const pvtSampledStationsTable = pgTable("pvt_sampled_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sampleDesignId: uuid("sample_design_id").notNull().references(() => pvtSampleDesignsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  pollingStationId: uuid("polling_station_id").notNull().references(() => pollingStationsTable.id, { onDelete: "cascade" }),
  countyId: uuid("county_id").references(() => countiesTable.id),
  constituencyId: uuid("constituency_id").references(() => constituenciesTable.id),
  stratumId: uuid("stratum_id").notNull(),
  stratumName: text("stratum_name").notNull(),
  registeredVoters: integer("registered_voters").notNull().default(0),
  /** Registered voters of the WHOLE campaign-universe stratum (sampling frame),
   *  not the geographic stratum — the universe the HT weights project to. */
  stratumVoters: integer("stratum_voters").notNull().default(0),
  selectionProbability: doublePrecision("selection_probability").notNull(),
  designWeight: doublePrecision("design_weight").notNull(), // 1 / selectionProbability
  reportStatus: text("report_status").notNull().default("pending"), // pending | quick_reported | full_reported | missing
  quickReportedAt: timestamp("quick_reported_at", { withTimezone: true }),
  fullReportedAt: timestamp("full_reported_at", { withTimezone: true }),
  assignedAgentId: uuid("assigned_agent_id").references(() => pollingAgentsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pvt_sampled_station_uniq").on(t.sampleDesignId, t.pollingStationId),
  index("pvt_sampled_design_idx").on(t.sampleDesignId, t.reportStatus),
  index("pvt_sampled_stratum_idx").on(t.sampleDesignId, t.stratumId),
  index("pvt_sampled_tenant_idx").on(t.tenantId, t.electionId),
]);

/** Simplified quick reports from sampled stations (precedes full form). */
export const pvtQuickReportsTable = pgTable("pvt_quick_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sampleDesignId: uuid("sample_design_id").notNull().references(() => pvtSampleDesignsTable.id, { onDelete: "cascade" }),
  sampledStationId: uuid("sampled_station_id").notNull().references(() => pvtSampledStationsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => pollingAgentsTable.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  totalVotesCast: integer("total_votes_cast").notNull(),
  registeredVoters: integer("registered_voters").notNull(),
  rejectedBallots: integer("rejected_ballots").notNull().default(0),
  candidateVotes: jsonb("candidate_votes").notNull().$type<{ candidateId: string; votes: number }[]>(),
  isValid: boolean("is_valid").notNull().default(true),
  validationNotes: text("validation_notes"),
  source: text("source").notNull().default("mobile"), // mobile | ussd | ivr | sms
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pvt_quick_report_station_uniq").on(t.sampledStationId),
  index("pvt_quick_reports_design_idx").on(t.sampleDesignId, t.submittedAt),
  index("pvt_quick_reports_tenant_idx").on(t.tenantId, t.electionId),
]);

/** Computed projection snapshots — append-only history. */
export const pvtProjectionsTable = pgTable("pvt_projections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sampleDesignId: uuid("sample_design_id").notNull().references(() => pvtSampleDesignsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  totalSampledStations: integer("total_sampled_stations").notNull().default(0),
  reportedStations: integer("reported_stations").notNull().default(0),
  reportingRate: doublePrecision("reporting_rate").notNull().default(0),
  projectedTotalVotes: doublePrecision("projected_total_votes").notNull().default(0),
  projectedTurnoutPercent: doublePrecision("projected_turnout_percent").notNull().default(0),
  candidateProjections: jsonb("candidate_projections").notNull().$type<{
    candidateId: string;
    candidateName: string;
    partyId: string | null;
    partyName: string | null;
    color: string | null;
    projectedVotes: number;
    projectedVoteShare: number;
    voteShareLower: number;
    voteShareUpper: number;
    votesLower: number;
    votesUpper: number;
    winProbability: number;
  }[]>(),
  projectedMargin: doublePrecision("projected_margin").notNull().default(0),
  marginLower: doublePrecision("margin_lower").notNull().default(0),
  marginUpper: doublePrecision("margin_upper").notNull().default(0),
  isWithinRecountTerritory: boolean("is_within_recount_territory").notNull().default(false),
  effectiveSampleSize: doublePrecision("effective_sample_size").notNull().default(0),
  designEffect: doublePrecision("design_effect").notNull().default(1),
  methodology: text("methodology").notNull().default("stratified-pps-bootstrap-2000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pvt_projections_design_idx").on(t.sampleDesignId, t.computedAt),
  index("pvt_projections_tenant_idx").on(t.tenantId, t.electionId),
]);

/** Alerts triggered by projections. */
export const pvtAlertsTable = pgTable("pvt_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sampleDesignId: uuid("sample_design_id").notNull().references(() => pvtSampleDesignsTable.id, { onDelete: "cascade" }),
  projectionId: uuid("projection_id").references(() => pvtProjectionsTable.id, { onDelete: "set null" }),
  alertType: text("alert_type").notNull(), // recount_territory | upset_warning | low_reporting | statistical_anomaly | turnout_spike
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  title: text("title").notNull(),
  description: text("description").notNull(),
  contextData: jsonb("context_data").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("active"), // active | acknowledged | resolved | dismissed
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pvt_alerts_design_idx").on(t.sampleDesignId, t.status),
  index("pvt_alerts_tenant_idx").on(t.tenantId, t.severity),
]);

/** Pre-computed stratum aggregates for fast dashboard reads. */
export const pvtStratumSummariesTable = pgTable("pvt_stratum_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sampleDesignId: uuid("sample_design_id").notNull().references(() => pvtSampleDesignsTable.id, { onDelete: "cascade" }),
  stratumId: uuid("stratum_id").notNull(),
  stratumName: text("stratum_name").notNull(),
  totalStations: integer("total_stations").notNull().default(0),
  sampledStations: integer("sampled_stations").notNull().default(0),
  reportedStations: integer("reported_stations").notNull().default(0),
  registeredVoters: integer("registered_voters").notNull().default(0),
  totalVotesCast: integer("total_votes_cast").notNull().default(0),
  candidateVoteShares: jsonb("candidate_vote_shares").$type<Record<string, number>>(),
  turnoutPercent: doublePrecision("turnout_percent").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("pvt_stratum_summary_uniq").on(t.sampleDesignId, t.stratumId),
  index("pvt_stratum_summaries_tenant_idx").on(t.tenantId, t.sampleDesignId),
]);
