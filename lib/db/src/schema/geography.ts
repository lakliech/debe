import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Counties ─────────────────────────────────────────────────────────────────
export const countiesTable = pgTable("counties", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: integer("code").notNull().unique(),
  name: text("name").notNull().unique(),
  capital: text("capital"),
  registeredVoters: integer("registered_voters"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCountySchema = createInsertSchema(countiesTable).omit({ id: true, createdAt: true });
export type InsertCounty = z.infer<typeof insertCountySchema>;
export type County = typeof countiesTable.$inferSelect;

// ── Constituencies ────────────────────────────────────────────────────────────
export const constituenciesTable = pgTable("constituencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: integer("code").notNull().unique(),
  name: text("name").notNull(),
  countyId: uuid("county_id").notNull().references(() => countiesTable.id),
  registeredVoters: integer("registered_voters"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConstituencySchema = createInsertSchema(constituenciesTable).omit({ id: true, createdAt: true });
export type InsertConstituency = z.infer<typeof insertConstituencySchema>;
export type Constituency = typeof constituenciesTable.$inferSelect;

// ── Wards ─────────────────────────────────────────────────────────────────────
export const wardsTable = pgTable("wards", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: integer("code").notNull().unique(),
  name: text("name").notNull(),
  constituencyId: uuid("constituency_id").notNull().references(() => constituenciesTable.id),
  countyId: uuid("county_id").notNull().references(() => countiesTable.id),
  registeredVoters: integer("registered_voters"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWardSchema = createInsertSchema(wardsTable).omit({ id: true, createdAt: true });
export type InsertWard = z.infer<typeof insertWardSchema>;
export type Ward = typeof wardsTable.$inferSelect;

// ── Polling Centres ──────────────────────────────────────────────────────────
export const pollingCentresTable = pgTable("polling_centres", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  wardId: uuid("ward_id").notNull().references(() => wardsTable.id),
  constituencyId: uuid("constituency_id").notNull().references(() => constituenciesTable.id),
  countyId: uuid("county_id").notNull().references(() => countiesTable.id),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPollingCentreSchema = createInsertSchema(pollingCentresTable).omit({ id: true, createdAt: true });
export type InsertPollingCentre = z.infer<typeof insertPollingCentreSchema>;
export type PollingCentre = typeof pollingCentresTable.$inferSelect;

// ── Polling Stations ─────────────────────────────────────────────────────────
export const pollingStationsTable = pgTable("polling_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  centreId: uuid("centre_id").notNull().references(() => pollingCentresTable.id),
  wardId: uuid("ward_id").notNull().references(() => wardsTable.id),
  constituencyId: uuid("constituency_id").notNull().references(() => constituenciesTable.id),
  countyId: uuid("county_id").notNull().references(() => countiesTable.id),
  registeredVoters: integer("registered_voters").notNull().default(0),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  primaryAgentId: uuid("primary_agent_id"),
  backupAgentId: uuid("backup_agent_id"),
  accreditationStatus: text("accreditation_status").default("pending"),
  trainingStatus: text("training_status").default("pending"),
  contactStatus: text("contact_status").default("pending"),
  reportingStatus: text("reporting_status").default("not_reported"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPollingStationSchema = createInsertSchema(pollingStationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPollingStation = z.infer<typeof insertPollingStationSchema>;
export type PollingStation = typeof pollingStationsTable.$inferSelect;

// ── Campaign Station Profiles ─────────────────────────────────────────────────
// Per-tenant, per-station campaign state. Multiple campaigns deploying agents to
// the same physical station each get their own row — never overwriting each other.
export const campaignStationProfilesTable = pgTable(
  "campaign_station_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    stationId: uuid("station_id").notNull().references(() => pollingStationsTable.id, { onDelete: "cascade" }),
    accreditationStatus: text("accreditation_status").default("pending"),
    trainingStatus: text("training_status").default("pending"),
    contactStatus: text("contact_status").default("pending"),
    reportingStatus: text("reporting_status").default("not_reported"),
    primaryAgentId: uuid("primary_agent_id"),
    backupAgentId: uuid("backup_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({ uniq: uniqueIndex("csp_tenant_station_uniq").on(t.tenantId, t.stationId) })
);

export type CampaignStationProfile = typeof campaignStationProfilesTable.$inferSelect;
