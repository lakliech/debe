-- Election Day Logistics & Security Command Center
-- Mirrors lib/db/src/schema/logistics.ts (drizzle push applies this on merge/deploy).

CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "registration_number" text NOT NULL,
  "make" text,
  "model" text,
  "capacity" integer,
  "vehicle_type" text,
  "assigned_driver_id" text,
  "assigned_county_id" uuid REFERENCES "counties"("id"),
  "assigned_constituency_id" uuid REFERENCES "constituencies"("id"),
  "status" text NOT NULL DEFAULT 'available',
  "gps_device_id" text,
  "last_gps_lat" double precision,
  "last_gps_lon" double precision,
  "last_gps_at" timestamp with time zone,
  "fuel_capacity_liters" double precision,
  "current_fuel_level" double precision,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "vehicles_tenant_status_idx" ON "vehicles" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vehicles_tenant_county_idx" ON "vehicles" ("tenant_id", "assigned_county_id");
CREATE INDEX IF NOT EXISTS "vehicles_reg_uniq" ON "vehicles" ("tenant_id", "registration_number");

CREATE TABLE IF NOT EXISTS "transport_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "election_id" uuid NOT NULL REFERENCES "elections"("id") ON DELETE cascade,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE cascade,
  "driver_id" text,
  "origin_county_id" uuid REFERENCES "counties"("id"),
  "origin_description" text,
  "destination_county_id" uuid REFERENCES "counties"("id"),
  "destination_description" text,
  "passenger_agent_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "planned_departure_at" timestamp with time zone,
  "planned_arrival_at" timestamp with time zone,
  "actual_departure_at" timestamp with time zone,
  "actual_arrival_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'scheduled',
  "delay_reason" text,
  "fuel_issued_liters" double precision,
  "fuel_cost_kes" double precision,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "transport_tenant_election_idx" ON "transport_assignments" ("tenant_id", "election_id");
CREATE INDEX IF NOT EXISTS "transport_tenant_status_idx" ON "transport_assignments" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "transport_vehicle_idx" ON "transport_assignments" ("vehicle_id");

CREATE TABLE IF NOT EXISTS "agent_check_ins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "election_id" uuid NOT NULL REFERENCES "elections"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "polling_agents"("id") ON DELETE cascade,
  "polling_station_id" uuid REFERENCES "polling_stations"("id") ON DELETE set null,
  "check_in_type" text NOT NULL,
  "gps_lat" double precision,
  "gps_lon" double precision,
  "gps_accuracy" double precision,
  "photo_url" text,
  "distance_from_station" double precision,
  "is_within_geofence" boolean,
  "device_id" text,
  "source" text NOT NULL DEFAULT 'app',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "checkins_tenant_election_idx" ON "agent_check_ins" ("tenant_id", "election_id");
CREATE INDEX IF NOT EXISTS "checkins_tenant_agent_idx" ON "agent_check_ins" ("tenant_id", "agent_id");
CREATE INDEX IF NOT EXISTS "checkins_tenant_station_idx" ON "agent_check_ins" ("tenant_id", "polling_station_id");
CREATE INDEX IF NOT EXISTS "checkins_tenant_created_idx" ON "agent_check_ins" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "checkins_tenant_type_idx" ON "agent_check_ins" ("tenant_id", "check_in_type");

CREATE TABLE IF NOT EXISTS "security_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "election_id" uuid NOT NULL REFERENCES "elections"("id") ON DELETE cascade,
  "reported_by_agent_id" uuid REFERENCES "polling_agents"("id") ON DELETE set null,
  "reported_by_user_id" text,
  "county_id" uuid REFERENCES "counties"("id"),
  "constituency_id" uuid REFERENCES "constituencies"("id"),
  "polling_station_id" uuid REFERENCES "polling_stations"("id") ON DELETE set null,
  "gps_lat" double precision,
  "gps_lon" double precision,
  "incident_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'medium',
  "title" text NOT NULL,
  "description" text,
  "photo_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "video_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'reported',
  "assigned_to" text,
  "escalation_level" integer NOT NULL DEFAULT 1,
  "resolution_notes" text,
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "is_panic_button" boolean NOT NULL DEFAULT false,
  "panic_acknowledged_at" timestamp with time zone,
  "panic_acknowledged_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_election_idx" ON "security_incidents" ("tenant_id", "election_id");
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_status_idx" ON "security_incidents" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_severity_idx" ON "security_incidents" ("tenant_id", "severity");
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_station_idx" ON "security_incidents" ("tenant_id", "polling_station_id");
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_created_idx" ON "security_incidents" ("tenant_id", "created_at");

CREATE TABLE IF NOT EXISTS "panic_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "election_id" uuid NOT NULL REFERENCES "elections"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "polling_agents"("id") ON DELETE cascade,
  "polling_station_id" uuid REFERENCES "polling_stations"("id") ON DELETE set null,
  "gps_lat" double precision,
  "gps_lon" double precision,
  "status" text NOT NULL DEFAULT 'active',
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" text,
  "resolved_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "panic_alerts_tenant_election_idx" ON "panic_alerts" ("tenant_id", "election_id");
CREATE INDEX IF NOT EXISTS "panic_alerts_tenant_status_idx" ON "panic_alerts" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "panic_alerts_tenant_agent_idx" ON "panic_alerts" ("tenant_id", "agent_id");
CREATE INDEX IF NOT EXISTS "panic_alerts_tenant_created_idx" ON "panic_alerts" ("tenant_id", "created_at");
