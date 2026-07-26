CREATE TABLE "consent_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_email" text NOT NULL,
	"subject_name" text,
	"consent_type" text NOT NULL,
	"action" text NOT NULL,
	"purpose" text,
	"ip_address" text,
	"user_agent" text,
	"evidence_text" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_breach_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"discovered_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone,
	"contained_at" timestamp with time zone,
	"data_categories" text[],
	"estimated_records_affected" integer,
	"severity" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"root_cause" text,
	"remedial_actions" text,
	"notified_dpa" boolean DEFAULT false,
	"notified_subjects" boolean DEFAULT false,
	"reported_by" uuid,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_processing_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_name" text NOT NULL,
	"purpose" text NOT NULL,
	"legal_basis" text NOT NULL,
	"data_categories" text[],
	"data_subject_categories" text[],
	"recipients" text[],
	"retention_period_days" integer,
	"cross_border_transfer" boolean DEFAULT false,
	"safeguards" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_category" text NOT NULL,
	"retention_days" integer NOT NULL,
	"legal_basis" text NOT NULL,
	"description" text,
	"auto_delete" boolean DEFAULT false NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpia_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"process_id" uuid,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"risk_description" text,
	"mitigation_measures" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exported_by" uuid,
	"report_type" text NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"filters" jsonb,
	"row_count" integer,
	"ip_address" text,
	"user_agent" text,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_name" text NOT NULL,
	"vendor_type" text NOT NULL,
	"services_provided" text NOT NULL,
	"data_shared" text[],
	"contract_url" text,
	"dpa_signed_at" timestamp with time zone,
	"dpa_expires_at" timestamp with time zone,
	"country_of_operation" text,
	"adequacy_decision" boolean DEFAULT true,
	"transfer_mechanism" text,
	"risk_rating" text DEFAULT 'low',
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
