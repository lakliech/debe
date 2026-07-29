CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "aspirants" DROP CONSTRAINT "aspirants_national_id_position_unique";--> statement-breakpoint
ALTER TABLE "system_config" DROP CONSTRAINT "system_config_key_unique";--> statement-breakpoint
ALTER TABLE "manifesto_sectors" DROP CONSTRAINT "manifesto_sectors_slug_unique";--> statement-breakpoint
ALTER TABLE "news_articles" DROP CONSTRAINT "news_articles_slug_unique";--> statement-breakpoint
ALTER TABLE "budget_categories" DROP CONSTRAINT "budget_categories_name_unique";--> statement-breakpoint
ALTER TABLE "budget_categories" DROP CONSTRAINT "budget_categories_code_unique";--> statement-breakpoint
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_reference_number_unique";--> statement-breakpoint
ALTER TABLE "expenditure_requests" DROP CONSTRAINT "expenditure_requests_reference_number_unique";--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_name_unique";--> statement-breakpoint
ALTER TABLE "payment_vouchers" DROP CONSTRAINT "payment_vouchers_voucher_number_unique";--> statement-breakpoint
ALTER TABLE "branding" ALTER COLUMN "campaign_name" SET DEFAULT 'Campaign';--> statement-breakpoint
ALTER TABLE "branding" ALTER COLUMN "tagline" SET DEFAULT 'Building a Better Future Together';--> statement-breakpoint
ALTER TABLE "aspirants" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_suspensions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_feed" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_submissions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "polling_agents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "supporters" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "county_priorities" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "faq_items" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "manifesto_sectors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "volunteer_tasks" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "donor_alerts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_audit_log" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "mpesa_transactions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "spokesperson_directory" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_training_courses" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "data_processing_records" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "dpia_register" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "aspirants" ADD CONSTRAINT "aspirants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_suspensions" ADD CONSTRAINT "user_suspensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_feed" ADD CONSTRAINT "activity_feed_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding" ADD CONSTRAINT "branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_submissions" ADD CONSTRAINT "policy_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_agents" ADD CONSTRAINT "polling_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporters" ADD CONSTRAINT "supporters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "county_priorities" ADD CONSTRAINT "county_priorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifesto_sectors" ADD CONSTRAINT "manifesto_sectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_tasks" ADD CONSTRAINT "volunteer_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD CONSTRAINT "audience_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_alerts" ADD CONSTRAINT "donor_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_audit_log" ADD CONSTRAINT "finance_audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spokesperson_directory" ADD CONSTRAINT "spokesperson_directory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_training_courses" ADD CONSTRAINT "agent_training_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_processing_records" ADD CONSTRAINT "data_processing_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpia_register" ADD CONSTRAINT "dpia_register_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aspirants" ADD CONSTRAINT "aspirants_national_id_position_unique" UNIQUE("tenant_id","national_id","position");--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_tenant_name_year_unique" UNIQUE("tenant_id","name","year");--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_tenant_key_unique" UNIQUE("tenant_id","key");--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_tenant_ref_unique" UNIQUE("tenant_id","reference_number");--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_tenant_ref_unique" UNIQUE("tenant_id","reference_number");--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_tenant_voucher_unique" UNIQUE("tenant_id","voucher_number");