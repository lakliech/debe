CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid,
	"kind" text NOT NULL,
	"current_value" text,
	"requested_value" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"recipient" text NOT NULL,
	"template" text NOT NULL,
	"subject" text,
	"status" text NOT NULL,
	"error" text,
	"provider_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logo_uploaded" boolean DEFAULT false NOT NULL,
	"colours_set" boolean DEFAULT false NOT NULL,
	"staff_invited" boolean DEFAULT false NOT NULL,
	"stations_configured" boolean DEFAULT false NOT NULL,
	"profile_completed" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_progress_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"event_type" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_anomaly_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"tenant_id" uuid,
	"type" text NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_anomaly_flags_sub_type_uniq" UNIQUE("submission_id","type")
);
--> statement-breakpoint
CREATE TABLE "support_ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"sender_name" text,
	"wa_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"supporter_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"wa_phone" text NOT NULL,
	"contact_name" text,
	"category" text DEFAULT 'supporter' NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_mpesa_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shortcode" text NOT NULL,
	"consumer_key" text NOT NULL,
	"consumer_secret" text NOT NULL,
	"passkey" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_mpesa_configs_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "agent_location_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"agent_id" uuid NOT NULL,
	"election_id" uuid,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy_m" double precision,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tracking_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"agent_id" uuid NOT NULL,
	"election_id" uuid,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_design_id" uuid NOT NULL,
	"projection_id" uuid,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"context_data" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_design_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_sampled_stations" integer DEFAULT 0 NOT NULL,
	"reported_stations" integer DEFAULT 0 NOT NULL,
	"reporting_rate" double precision DEFAULT 0 NOT NULL,
	"projected_total_votes" double precision DEFAULT 0 NOT NULL,
	"projected_turnout_percent" double precision DEFAULT 0 NOT NULL,
	"candidate_projections" jsonb NOT NULL,
	"projected_margin" double precision DEFAULT 0 NOT NULL,
	"margin_lower" double precision DEFAULT 0 NOT NULL,
	"margin_upper" double precision DEFAULT 0 NOT NULL,
	"is_within_recount_territory" boolean DEFAULT false NOT NULL,
	"effective_sample_size" double precision DEFAULT 0 NOT NULL,
	"design_effect" double precision DEFAULT 1 NOT NULL,
	"methodology" text DEFAULT 'stratified-pps-bootstrap-2000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_quick_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_design_id" uuid NOT NULL,
	"sampled_station_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"agent_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_votes_cast" integer NOT NULL,
	"registered_voters" integer NOT NULL,
	"rejected_ballots" integer DEFAULT 0 NOT NULL,
	"candidate_votes" jsonb NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"validation_notes" text,
	"source" text DEFAULT 'mobile' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_sample_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"stratum_level" text NOT NULL,
	"target_sample_size" integer NOT NULL,
	"confidence_level" double precision DEFAULT 0.95 NOT NULL,
	"margin_of_error" double precision DEFAULT 0.015 NOT NULL,
	"selection_method" text DEFAULT 'pps' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_sampled_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_design_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"polling_station_id" uuid NOT NULL,
	"county_id" uuid,
	"constituency_id" uuid,
	"stratum_id" uuid NOT NULL,
	"stratum_name" text NOT NULL,
	"registered_voters" integer DEFAULT 0 NOT NULL,
	"stratum_voters" integer DEFAULT 0 NOT NULL,
	"selection_probability" double precision NOT NULL,
	"design_weight" double precision NOT NULL,
	"report_status" text DEFAULT 'pending' NOT NULL,
	"quick_reported_at" timestamp with time zone,
	"full_reported_at" timestamp with time zone,
	"assigned_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pvt_stratum_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sample_design_id" uuid NOT NULL,
	"stratum_id" uuid NOT NULL,
	"stratum_name" text NOT NULL,
	"total_stations" integer DEFAULT 0 NOT NULL,
	"sampled_stations" integer DEFAULT 0 NOT NULL,
	"reported_stations" integer DEFAULT 0 NOT NULL,
	"registered_voters" integer DEFAULT 0 NOT NULL,
	"total_votes_cast" integer DEFAULT 0 NOT NULL,
	"candidate_vote_shares" jsonb,
	"turnout_percent" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "clerk_org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_override_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "scheduled_deletion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "whatsapp_phone_number_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tls_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tls_cert_error" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tls_provisioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "seat_type" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "scope_county_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "scope_constituency_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "scope_ward_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_global_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "hero_subtagline" text;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "primary_cta_label" text;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "primary_cta_url" text;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "secondary_cta_label" text;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "secondary_cta_url" text;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD COLUMN "anomaly_score" integer;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD COLUMN "anomaly_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD COLUMN "vote_vector_hash" text;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_change_requests" ADD CONSTRAINT "domain_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_change_requests" ADD CONSTRAINT "domain_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_change_requests" ADD CONSTRAINT "domain_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_anomaly_flags" ADD CONSTRAINT "result_anomaly_flags_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_anomaly_flags" ADD CONSTRAINT "result_anomaly_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_supporter_id_supporters_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."supporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_mpesa_configs" ADD CONSTRAINT "tenant_mpesa_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_pings" ADD CONSTRAINT "agent_location_pings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_pings" ADD CONSTRAINT "agent_location_pings_agent_id_polling_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."polling_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_pings" ADD CONSTRAINT "agent_location_pings_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tracking_alerts" ADD CONSTRAINT "agent_tracking_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tracking_alerts" ADD CONSTRAINT "agent_tracking_alerts_agent_id_polling_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."polling_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tracking_alerts" ADD CONSTRAINT "agent_tracking_alerts_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_alerts" ADD CONSTRAINT "pvt_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_alerts" ADD CONSTRAINT "pvt_alerts_sample_design_id_pvt_sample_designs_id_fk" FOREIGN KEY ("sample_design_id") REFERENCES "public"."pvt_sample_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_alerts" ADD CONSTRAINT "pvt_alerts_projection_id_pvt_projections_id_fk" FOREIGN KEY ("projection_id") REFERENCES "public"."pvt_projections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_projections" ADD CONSTRAINT "pvt_projections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_projections" ADD CONSTRAINT "pvt_projections_sample_design_id_pvt_sample_designs_id_fk" FOREIGN KEY ("sample_design_id") REFERENCES "public"."pvt_sample_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_projections" ADD CONSTRAINT "pvt_projections_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_quick_reports" ADD CONSTRAINT "pvt_quick_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_quick_reports" ADD CONSTRAINT "pvt_quick_reports_sample_design_id_pvt_sample_designs_id_fk" FOREIGN KEY ("sample_design_id") REFERENCES "public"."pvt_sample_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_quick_reports" ADD CONSTRAINT "pvt_quick_reports_sampled_station_id_pvt_sampled_stations_id_fk" FOREIGN KEY ("sampled_station_id") REFERENCES "public"."pvt_sampled_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_quick_reports" ADD CONSTRAINT "pvt_quick_reports_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_quick_reports" ADD CONSTRAINT "pvt_quick_reports_agent_id_polling_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."polling_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sample_designs" ADD CONSTRAINT "pvt_sample_designs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sample_designs" ADD CONSTRAINT "pvt_sample_designs_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_sample_design_id_pvt_sample_designs_id_fk" FOREIGN KEY ("sample_design_id") REFERENCES "public"."pvt_sample_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_sampled_stations" ADD CONSTRAINT "pvt_sampled_stations_assigned_agent_id_polling_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."polling_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_stratum_summaries" ADD CONSTRAINT "pvt_stratum_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvt_stratum_summaries" ADD CONSTRAINT "pvt_stratum_summaries_sample_design_id_pvt_sample_designs_id_fk" FOREIGN KEY ("sample_design_id") REFERENCES "public"."pvt_sample_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "result_anomaly_flags_tenant_idx" ON "result_anomaly_flags" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_location_pings_agent_latest_idx" ON "agent_location_pings" USING btree ("tenant_id","agent_id","recorded_at");--> statement-breakpoint
CREATE INDEX "agent_location_pings_tenant_time_idx" ON "agent_location_pings" USING btree ("tenant_id","recorded_at");--> statement-breakpoint
CREATE INDEX "agent_tracking_alerts_agent_kind_idx" ON "agent_tracking_alerts" USING btree ("tenant_id","agent_id","kind","sent_at");--> statement-breakpoint
CREATE INDEX "pvt_alerts_design_idx" ON "pvt_alerts" USING btree ("sample_design_id","status");--> statement-breakpoint
CREATE INDEX "pvt_alerts_tenant_idx" ON "pvt_alerts" USING btree ("tenant_id","severity");--> statement-breakpoint
CREATE INDEX "pvt_projections_design_idx" ON "pvt_projections" USING btree ("sample_design_id","computed_at");--> statement-breakpoint
CREATE INDEX "pvt_projections_tenant_idx" ON "pvt_projections" USING btree ("tenant_id","election_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pvt_quick_report_station_uniq" ON "pvt_quick_reports" USING btree ("sampled_station_id");--> statement-breakpoint
CREATE INDEX "pvt_quick_reports_design_idx" ON "pvt_quick_reports" USING btree ("sample_design_id","submitted_at");--> statement-breakpoint
CREATE INDEX "pvt_quick_reports_tenant_idx" ON "pvt_quick_reports" USING btree ("tenant_id","election_id");--> statement-breakpoint
CREATE INDEX "pvt_designs_tenant_election_idx" ON "pvt_sample_designs" USING btree ("tenant_id","election_id");--> statement-breakpoint
CREATE INDEX "pvt_designs_status_idx" ON "pvt_sample_designs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pvt_sampled_station_uniq" ON "pvt_sampled_stations" USING btree ("sample_design_id","polling_station_id");--> statement-breakpoint
CREATE INDEX "pvt_sampled_design_idx" ON "pvt_sampled_stations" USING btree ("sample_design_id","report_status");--> statement-breakpoint
CREATE INDEX "pvt_sampled_stratum_idx" ON "pvt_sampled_stations" USING btree ("sample_design_id","stratum_id");--> statement-breakpoint
CREATE INDEX "pvt_sampled_tenant_idx" ON "pvt_sampled_stations" USING btree ("tenant_id","election_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pvt_stratum_summary_uniq" ON "pvt_stratum_summaries" USING btree ("sample_design_id","stratum_id");--> statement-breakpoint
CREATE INDEX "pvt_stratum_summaries_tenant_idx" ON "pvt_stratum_summaries" USING btree ("tenant_id","sample_design_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_scope_county_id_counties_id_fk" FOREIGN KEY ("scope_county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_scope_constituency_id_constituencies_id_fk" FOREIGN KEY ("scope_constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_scope_ward_id_wards_id_fk" FOREIGN KEY ("scope_ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_platform_grant_unique" ON "user_roles" USING btree ("user_id","role_id") WHERE "user_roles"."tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_whatsapp_phone_number_id_unique" UNIQUE("whatsapp_phone_number_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_scope_valid" CHECK (seat_type IS NULL OR (
      (seat_type = 'presidential' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
      (seat_type IN ('gubernatorial', 'senator', 'women_rep') AND scope_county_id IS NOT NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
      (seat_type = 'mp' AND scope_county_id IS NULL AND scope_constituency_id IS NOT NULL AND scope_ward_id IS NULL) OR
      (seat_type = 'mca' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NOT NULL)
    ));