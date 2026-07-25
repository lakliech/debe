CREATE TABLE "constituencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" integer NOT NULL,
	"name" text NOT NULL,
	"county_id" uuid NOT NULL,
	"registered_voters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constituencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "counties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" integer NOT NULL,
	"name" text NOT NULL,
	"capital" text,
	"registered_voters" integer,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counties_code_unique" UNIQUE("code"),
	CONSTRAINT "counties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "polling_centres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ward_id" uuid NOT NULL,
	"constituency_id" uuid NOT NULL,
	"county_id" uuid NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polling_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"centre_id" uuid NOT NULL,
	"ward_id" uuid NOT NULL,
	"constituency_id" uuid NOT NULL,
	"county_id" uuid NOT NULL,
	"registered_voters" integer DEFAULT 0 NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"primary_agent_id" uuid,
	"backup_agent_id" uuid,
	"accreditation_status" text DEFAULT 'pending',
	"training_status" text DEFAULT 'pending',
	"contact_status" text DEFAULT 'pending',
	"reporting_status" text DEFAULT 'not_reported',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polling_stations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" integer NOT NULL,
	"name" text NOT NULL,
	"constituency_id" uuid NOT NULL,
	"county_id" uuid NOT NULL,
	"registered_voters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"level" integer DEFAULT 10 NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name"),
	CONSTRAINT "roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_suspensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"suspended_by" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone_number" text,
	"photo_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "activity_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"resource" text,
	"resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"user_full_name" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_name" text DEFAULT 'Ushindi 2027' NOT NULL,
	"candidate_name" text DEFAULT 'Candidate Name' NOT NULL,
	"primary_color" text DEFAULT '#006600' NOT NULL,
	"secondary_color" text DEFAULT '#bb0000' NOT NULL,
	"accent_color" text DEFAULT '#000000',
	"logo_url" text,
	"favicon_url" text,
	"tagline" text DEFAULT 'Building a Better Kenya Together' NOT NULL,
	"election_year" integer DEFAULT 2027 NOT NULL,
	"website_url" text,
	"social_twitter" text,
	"social_facebook" text,
	"social_instagram" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid,
	"full_name" text NOT NULL,
	"party_name" text,
	"party_abbreviation" text,
	"is_our_candidate" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"channel" text NOT NULL,
	"template_id" uuid,
	"audience" text,
	"content_en" text,
	"content_sw" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0,
	"delivered_count" integer DEFAULT 0,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" text NOT NULL,
	"subject_email" text,
	"subject_name" text,
	"full_name" text,
	"phone_number" text,
	"description" text,
	"resolution_notes" text,
	"subject_type" text,
	"subject_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"due_date" text,
	"resolved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid,
	"donor_full_name" text NOT NULL,
	"donor_email" text,
	"donor_phone" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"payment_channel" text NOT NULL,
	"transaction_ref" text,
	"campaign_purpose" text,
	"contribution_type" text DEFAULT 'monetary',
	"verification_status" text DEFAULT 'pending',
	"compliance_flag" boolean DEFAULT false,
	"refund_status" text,
	"receipt_number" text,
	"receipt_sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_transaction_ref_unique" UNIQUE("transaction_ref"),
	CONSTRAINT "donations_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"election_date" text,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'rally' NOT NULL,
	"venue" text,
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"event_date" text,
	"start_time" text,
	"end_time" text,
	"expected_attendance" integer,
	"actual_attendance" integer,
	"status" text DEFAULT 'proposed' NOT NULL,
	"budget_kes" integer,
	"organized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"polling_station_id" uuid,
	"county_id" uuid,
	"reported_by" uuid NOT NULL,
	"assigned_to" uuid,
	"escalation_level" integer DEFAULT 1,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"legal_action" text,
	"communications_action" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"sector" text,
	"sector_id" uuid,
	"submission_type" text DEFAULT 'problem' NOT NULL,
	"content" text NOT NULL,
	"county_id" uuid,
	"anonymous_id" text,
	"submitter_name" text,
	"submitter_email" text,
	"status" text DEFAULT 'pending',
	"public_display" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polling_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"national_id" text,
	"photo_url" text,
	"polling_station_id" uuid,
	"is_backup" boolean DEFAULT false NOT NULL,
	"accreditation_status" text DEFAULT 'pending',
	"training_status" text DEFAULT 'pending',
	"code_of_conduct_accepted" boolean DEFAULT false,
	"code_of_conduct_date" timestamp with time zone,
	"deployment_confirmed" boolean DEFAULT false,
	"allowance_paid" boolean DEFAULT false,
	"status" text DEFAULT 'registered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"polling_station_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"registered_voters" integer,
	"ballots_received" integer,
	"ballots_issued" integer,
	"unused_ballots" integer,
	"spoilt_ballots" integer,
	"rejected_ballots" integer,
	"total_valid_votes" integer,
	"total_votes_cast" integer,
	"agent_signed" boolean,
	"agent_received_copy" boolean,
	"results_displayed" boolean,
	"objection_raised" boolean,
	"agent_comments" text,
	"submitted_at" timestamp with time zone,
	"offline_captured_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"device_id" text,
	"gps_lat" double precision,
	"gps_lon" double precision,
	"file_hashes" text[],
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone_number" text,
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"membership_status" text DEFAULT 'supporter',
	"consent_marketing" boolean DEFAULT false,
	"consent_sms" boolean DEFAULT false,
	"consent_email" boolean DEFAULT false,
	"opted_out" boolean DEFAULT false,
	"opted_out_at" timestamp with time zone,
	"policy_interests" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"polling_centre_id" uuid,
	"preferred_role" text,
	"skills" text[],
	"languages" text[],
	"availability" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent_given" boolean DEFAULT false NOT NULL,
	"consent_date" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"awarded_by" uuid,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_sw" text,
	"description" text,
	"icon_url" text,
	"criteria" text,
	"level" text DEFAULT 'bronze',
	"category" text DEFAULT 'participation',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_definitions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"consent_type" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"collected_by" uuid,
	"withdrawn_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "county_priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_id" uuid NOT NULL,
	"sector_id" uuid,
	"title_en" text NOT NULL,
	"title_sw" text NOT NULL,
	"body_en" text,
	"body_sw" text,
	"priority" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_check_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_en" text NOT NULL,
	"claim_sw" text,
	"verdict_en" text NOT NULL,
	"verdict_sw" text,
	"rating" text DEFAULT 'false' NOT NULL,
	"source_url" text,
	"checked_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text DEFAULT 'general',
	"question_en" text NOT NULL,
	"question_sw" text,
	"answer_en" text NOT NULL,
	"answer_sw" text,
	"display_order" integer DEFAULT 0,
	"published" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifesto_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sector_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_sw" text NOT NULL,
	"body_en" text,
	"body_sw" text,
	"priority" integer DEFAULT 0,
	"status" text DEFAULT 'committed',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifesto_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_en" text NOT NULL,
	"title_sw" text NOT NULL,
	"description_en" text,
	"description_sw" text,
	"icon_name" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifesto_sectors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "module_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"completed" boolean DEFAULT false,
	"quiz_score" integer,
	"quiz_passed" boolean,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"category" text DEFAULT 'news' NOT NULL,
	"title_en" text NOT NULL,
	"title_sw" text,
	"body_en" text,
	"body_sw" text,
	"excerpt_en" text,
	"excerpt_sw" text,
	"image_url" text,
	"video_url" text,
	"author_id" uuid,
	"published_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"county_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"question_en" text NOT NULL,
	"question_sw" text,
	"options" jsonb NOT NULL,
	"correct_option_id" text NOT NULL,
	"explanation_en" text,
	"explanation_sw" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supporter_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supporter_id" uuid NOT NULL,
	"accessed_by" uuid NOT NULL,
	"accessed_by_email" text,
	"action" text NOT NULL,
	"reason" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"hours_logged" integer DEFAULT 0,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_sw" text,
	"description" text,
	"target_roles" text[],
	"estimated_hours" integer DEFAULT 1,
	"mandatory" boolean DEFAULT false,
	"pass_mark" integer DEFAULT 70,
	"certificate_template" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"volunteer_id" uuid,
	"user_id" uuid,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"score" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"certificate_issued_at" timestamp with time zone,
	"certificate_code" text,
	"enrolled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_enrollments_certificate_code_unique" UNIQUE("certificate_code")
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_sw" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"content_en" text,
	"content_sw" text,
	"video_url" text,
	"document_url" text,
	"display_order" integer DEFAULT 0,
	"duration_minutes" integer DEFAULT 15,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"activity_id" uuid,
	"activity_name" text,
	"check_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"check_out_at" timestamp with time zone,
	"marked_by" uuid,
	"latitude" text,
	"longitude" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_type" text DEFAULT 'fieldwork',
	"county_id" uuid,
	"constituency_id" uuid,
	"ward_id" uuid,
	"due_date" text,
	"estimated_hours" integer,
	"max_assignees" integer DEFAULT 1,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"supervisor_id" uuid,
	"priority" text DEFAULT 'normal',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"object_path" text NOT NULL,
	"change_note" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filters" jsonb NOT NULL,
	"estimated_reach" integer DEFAULT 0,
	"created_by" uuid NOT NULL,
	"last_built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"ledger" text DEFAULT 'candidate' NOT NULL,
	"total_allocated_kes" numeric(16, 2) DEFAULT '0',
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "budget_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"allocated_amount_kes" numeric(14, 2) NOT NULL,
	"spent_amount_kes" numeric(14, 2) DEFAULT '0' NOT NULL,
	"county_id" uuid,
	"fiscal_period" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"correction_body_en" text NOT NULL,
	"correction_body_sw" text,
	"published_at" timestamp with time zone,
	"published_by" uuid NOT NULL,
	"distribution_channels" jsonb DEFAULT '[]'::jsonb,
	"distribution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_fact_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"fact_checker_id" uuid NOT NULL,
	"verdict" text,
	"evidence_summary" text,
	"sources_used" jsonb DEFAULT '[]'::jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"object_path" text NOT NULL,
	"mime_type" text,
	"file_size_bytes" integer,
	"owner" uuid NOT NULL,
	"county_id" uuid,
	"language" text,
	"publishing_rights" text DEFAULT 'internal' NOT NULL,
	"expires_at" timestamp with time zone,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"current_version" integer DEFAULT 1 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"donor_full_name" text NOT NULL,
	"donor_email" text,
	"donor_phone" text,
	"donor_id_number" text,
	"donor_entity_type" text DEFAULT 'individual' NOT NULL,
	"donor_entity_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"channel" text NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"contribution_type" text DEFAULT 'one_off' NOT NULL,
	"ledger" text DEFAULT 'candidate' NOT NULL,
	"mpesa_transaction_id" uuid,
	"mpesa_receipt_number" text,
	"bank_name" text,
	"bank_branch_code" text,
	"bank_transaction_ref" text,
	"source_declaration" text,
	"is_politically_exposed" boolean DEFAULT false,
	"is_foreign_donation" boolean DEFAULT false,
	"compliance_flag" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"receipt_sent_at" timestamp with time zone,
	"receipt_email" text,
	"receipt_path" text,
	"recurring_frequency" text,
	"recurring_ends_at" timestamp with time zone,
	"parent_contribution_id" uuid,
	"recorded_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributions_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "donor_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"contribution_id" uuid,
	"donor_phone" text,
	"donor_email" text,
	"description" text NOT NULL,
	"metadata" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"downloaded_by" uuid,
	"downloaded_by_email" text,
	"ip_address" text,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"incident_type" text NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"reported_by" uuid NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_media_accreditations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"journalist_name" text NOT NULL,
	"media_house" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"id_number" text,
	"press_pass_number" text,
	"coverage_type" text DEFAULT 'print' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"qr_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_media_accreditations_qr_code_unique" UNIQUE("qr_code")
);
--> statement-breakpoint
CREATE TABLE "event_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actual_attendance" integer,
	"actual_cost_kes" numeric(14, 2),
	"budgeted_cost_kes" numeric(14, 2),
	"donations_collected_kes" numeric(14, 2) DEFAULT '0',
	"volunteer_hours" integer DEFAULT 0,
	"lessons_learned" text,
	"media_impact_notes" text,
	"incident_summary" text,
	"overall_rating" integer,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reconciliations_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"id_number" text,
	"organization" text,
	"registration_type" text DEFAULT 'general' NOT NULL,
	"qr_code" text NOT NULL,
	"checked_in" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_qr_code_unique" UNIQUE("qr_code")
);
--> statement-breakpoint
CREATE TABLE "event_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"spokesperson_id" uuid,
	"full_name" text NOT NULL,
	"title" text,
	"topic_en" text,
	"topic_sw" text,
	"allocated_minutes" integer,
	"talk_order" integer,
	"confirmed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_transport" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"route_description" text,
	"vehicle_count" integer,
	"security_briefing" text,
	"access_restricted_to_roles" jsonb DEFAULT '["security-officer","campaign-exec-director","national-campaign-manager"]'::jsonb,
	"coordinator_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenditure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"budget_line_id" uuid,
	"category_id" uuid NOT NULL,
	"requested_amount_kes" numeric(14, 2) NOT NULL,
	"approved_amount_kes" numeric(14, 2),
	"ledger" text DEFAULT 'candidate' NOT NULL,
	"payee_name" text NOT NULL,
	"payee_bank" text,
	"payee_account_number" text,
	"payee_phone" text,
	"requested_by" uuid NOT NULL,
	"first_approver_id" uuid,
	"first_approved_at" timestamp with time zone,
	"final_approver_id" uuid,
	"final_approved_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"supporting_doc_paths" jsonb DEFAULT '[]'::jsonb,
	"payment_voucher_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenditure_requests_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "finance_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"change_snapshot" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_kind_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"item_description" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text,
	"estimated_value_kes" numeric(14, 2),
	"valuation_method" text,
	"valuation_notes" text,
	"valued_by" uuid,
	"valued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_message_id" uuid NOT NULL,
	"recipient_phone" text,
	"recipient_email" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"delivered_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"category" text NOT NULL,
	"subject_en" text,
	"subject_sw" text,
	"body_en" text NOT NULL,
	"body_sw" text NOT NULL,
	"body_local" text,
	"local_language_name" text,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"max_length_sms" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"suspended_by" uuid,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "misinformation_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_text" text NOT NULL,
	"source_url" text,
	"screenshot_path" text,
	"platform" text,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'intake' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"legal_reviewer_id" uuid,
	"legal_reviewed_at" timestamp with time zone,
	"legal_clearance" boolean,
	"legal_notes" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"intake_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpesa_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_request_id" text,
	"checkout_request_id" text,
	"phone_number" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"account_reference" text,
	"transaction_desc" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"result_desc" text,
	"mpesa_receipt_number" text,
	"transaction_date" text,
	"callback_payload" jsonb,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mpesa_transactions_checkout_request_id_unique" UNIQUE("checkout_request_id")
);
--> statement-breakpoint
CREATE TABLE "payment_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_number" text NOT NULL,
	"expenditure_request_id" uuid NOT NULL,
	"payment_date" timestamp with time zone,
	"payment_method" text NOT NULL,
	"amount_kes" numeric(14, 2) NOT NULL,
	"payee_snapshot" jsonb NOT NULL,
	"ledger" text DEFAULT 'candidate' NOT NULL,
	"issued_by" uuid NOT NULL,
	"voucher_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_vouchers_voucher_number_unique" UNIQUE("voucher_number")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"emergency_suspended_by" uuid,
	"emergency_suspended_at" timestamp with time zone,
	"estimated_recipients" integer DEFAULT 0,
	"actual_recipients" integer,
	"delivered_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"opt_out_count" integer DEFAULT 0,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spokesperson_directory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"title" text NOT NULL,
	"portfolios" jsonb DEFAULT '[]'::jsonb,
	"phone" text,
	"email" text,
	"photo_path" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 10,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body_en" text NOT NULL,
	"body_sw" text,
	"body_local" text,
	"local_language_name" text,
	"change_note" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"retracted_at" timestamp with time zone,
	"retraction_reason" text,
	"correction_of" uuid,
	"spokesperson_id" uuid,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_centres" ADD CONSTRAINT "polling_centres_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_centres" ADD CONSTRAINT "polling_centres_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_centres" ADD CONSTRAINT "polling_centres_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_centre_id_polling_centres_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."polling_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_suspensions" ADD CONSTRAINT "user_suspensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_badge_id_badge_definitions_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badge_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "county_priorities" ADD CONSTRAINT "county_priorities_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "county_priorities" ADD CONSTRAINT "county_priorities_sector_id_manifesto_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."manifesto_sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifesto_items" ADD CONSTRAINT "manifesto_items_sector_id_manifesto_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."manifesto_sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_enrollment_id_training_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."training_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_volunteer_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."volunteer_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_modules" ADD CONSTRAINT "training_modules_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_attendance" ADD CONSTRAINT "volunteer_attendance_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD CONSTRAINT "audience_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_corrections" ADD CONSTRAINT "claim_corrections_claim_id_misinformation_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."misinformation_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_corrections" ADD CONSTRAINT "claim_corrections_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_fact_checks" ADD CONSTRAINT "claim_fact_checks_claim_id_misinformation_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."misinformation_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_fact_checks" ADD CONSTRAINT "claim_fact_checks_fact_checker_id_users_id_fk" FOREIGN KEY ("fact_checker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_users_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_mpesa_transaction_id_mpesa_transactions_id_fk" FOREIGN KEY ("mpesa_transaction_id") REFERENCES "public"."mpesa_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_alerts" ADD CONSTRAINT "donor_alerts_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_alerts" ADD CONSTRAINT "donor_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_records" ADD CONSTRAINT "download_records_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_records" ADD CONSTRAINT "download_records_downloaded_by_users_id_fk" FOREIGN KEY ("downloaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_incidents" ADD CONSTRAINT "event_incidents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_incidents" ADD CONSTRAINT "event_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_incidents" ADD CONSTRAINT "event_incidents_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media_accreditations" ADD CONSTRAINT "event_media_accreditations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media_accreditations" ADD CONSTRAINT "event_media_accreditations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reconciliations" ADD CONSTRAINT "event_reconciliations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reconciliations" ADD CONSTRAINT "event_reconciliations_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_spokesperson_id_spokesperson_directory_id_fk" FOREIGN KEY ("spokesperson_id") REFERENCES "public"."spokesperson_directory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_transport" ADD CONSTRAINT "event_transport_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_transport" ADD CONSTRAINT "event_transport_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_first_approver_id_users_id_fk" FOREIGN KEY ("first_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_requests" ADD CONSTRAINT "expenditure_requests_final_approver_id_users_id_fk" FOREIGN KEY ("final_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_audit_log" ADD CONSTRAINT "finance_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_kind_contributions" ADD CONSTRAINT "in_kind_contributions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_kind_contributions" ADD CONSTRAINT "in_kind_contributions_valued_by_users_id_fk" FOREIGN KEY ("valued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_scheduled_message_id_scheduled_messages_id_fk" FOREIGN KEY ("scheduled_message_id") REFERENCES "public"."scheduled_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_suspended_by_users_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misinformation_claims" ADD CONSTRAINT "misinformation_claims_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misinformation_claims" ADD CONSTRAINT "misinformation_claims_legal_reviewer_id_users_id_fk" FOREIGN KEY ("legal_reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misinformation_claims" ADD CONSTRAINT "misinformation_claims_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misinformation_claims" ADD CONSTRAINT "misinformation_claims_intake_by_users_id_fk" FOREIGN KEY ("intake_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_expenditure_request_id_expenditure_requests_id_fk" FOREIGN KEY ("expenditure_request_id") REFERENCES "public"."expenditure_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_segment_id_audience_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_emergency_suspended_by_users_id_fk" FOREIGN KEY ("emergency_suspended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spokesperson_directory" ADD CONSTRAINT "spokesperson_directory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_versions" ADD CONSTRAINT "statement_versions_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_versions" ADD CONSTRAINT "statement_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_correction_of_statements_id_fk" FOREIGN KEY ("correction_of") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_spokesperson_id_spokesperson_directory_id_fk" FOREIGN KEY ("spokesperson_id") REFERENCES "public"."spokesperson_directory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_donor_phone_idx" ON "contributions" USING btree ("donor_phone");--> statement-breakpoint
CREATE INDEX "contributions_channel_idx" ON "contributions" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "contributions_compliance_flag_idx" ON "contributions" USING btree ("compliance_flag");--> statement-breakpoint
CREATE INDEX "download_records_asset_idx" ON "download_records" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_registrations_qr_idx" ON "event_registrations" USING btree ("qr_code");--> statement-breakpoint
CREATE INDEX "message_deliveries_scheduled_message_idx" ON "message_deliveries" USING btree ("scheduled_message_id");