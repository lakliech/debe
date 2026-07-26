CREATE TABLE "agent_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"amount_kes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"payment_ref" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_election_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"polling_station_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"arrived_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"attendance_status" text DEFAULT 'expected' NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_replacements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_agent_id" uuid NOT NULL,
	"replacement_agent_id" uuid,
	"polling_station_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sync_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"device_id" text,
	"last_seen_at" timestamp with time zone,
	"sync_status" text DEFAULT 'unknown' NOT NULL,
	"pending_submissions" integer DEFAULT 0 NOT NULL,
	"app_version" text,
	"battery_level" integer,
	"network_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sync_status_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"passing_score" integer DEFAULT 70 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"election_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_training_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"score" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"certificate_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_centre_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assigned_to" uuid,
	"created_by" uuid NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"related_station_id" uuid,
	"related_dispute_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"author_id" uuid,
	"message" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"object_path" text,
	"hash" text,
	"description" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "election_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"polling_station_id" uuid,
	"submission_id" uuid,
	"dispute_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"opened_by" uuid,
	"assigned_to" uuid,
	"deadline_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"is_auto_detected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "election_incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"polling_station_id" uuid,
	"county_id" uuid,
	"constituency_id" uuid,
	"incident_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"gps_lat" double precision,
	"gps_lon" double precision,
	"evidence_urls" text[],
	"reported_by" uuid,
	"assigned_officer" uuid,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"legal_action" text,
	"communications_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_candidate_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"candidate_id" uuid,
	"candidate_name" text NOT NULL,
	"party_abbreviation" text,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"original_value" text,
	"corrected_value" text,
	"corrected_by" uuid,
	"correction_reason" text NOT NULL,
	"evidence_url" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_form_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"image_type" text NOT NULL,
	"object_path" text,
	"image_hash" text,
	"size_bytes" integer,
	"mime_type" text,
	"page_number" integer,
	"is_required" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text
);
--> statement-breakpoint
CREATE TABLE "submission_ocr_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"suggested_value" text NOT NULL,
	"confidence" double precision,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_verification_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reviewer_id" uuid,
	"action" text NOT NULL,
	"notes" text,
	"queried_fields" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"level" text NOT NULL,
	"entity_id" uuid,
	"entity_name" text,
	"candidate_id" uuid,
	"candidate_name" text NOT NULL,
	"party_abbreviation" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"valid_votes" integer DEFAULT 0 NOT NULL,
	"registered_voters" integer DEFAULT 0 NOT NULL,
	"total_stations" integer DEFAULT 0 NOT NULL,
	"stations_reporting" integer DEFAULT 0 NOT NULL,
	"stations_verified" integer DEFAULT 0 NOT NULL,
	"stations_pending" integer DEFAULT 0 NOT NULL,
	"stations_disputed" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transparency_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"polling_station_id" uuid,
	"submission_id" uuid,
	"legal_approved_by" uuid,
	"legal_approved_at" timestamp with time zone,
	"comms_approved_by" uuid,
	"comms_approved_at" timestamp with time zone,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"redaction_notes" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_allowances" ADD CONSTRAINT "agent_allowances_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_allowances" ADD CONSTRAINT "agent_allowances_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_election_day" ADD CONSTRAINT "agent_election_day_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_election_day" ADD CONSTRAINT "agent_election_day_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_election_day" ADD CONSTRAINT "agent_election_day_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quiz_attempts" ADD CONSTRAINT "agent_quiz_attempts_course_id_agent_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."agent_training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quiz_questions" ADD CONSTRAINT "agent_quiz_questions_course_id_agent_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."agent_training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_replacements" ADD CONSTRAINT "agent_replacements_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_replacements" ADD CONSTRAINT "agent_replacements_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_replacements" ADD CONSTRAINT "agent_replacements_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_replacements" ADD CONSTRAINT "agent_replacements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_training_courses" ADD CONSTRAINT "agent_training_courses_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_training_enrollments" ADD CONSTRAINT "agent_training_enrollments_course_id_agent_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."agent_training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD CONSTRAINT "command_centre_tasks_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD CONSTRAINT "command_centre_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD CONSTRAINT "command_centre_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD CONSTRAINT "command_centre_tasks_related_station_id_polling_stations_id_fk" FOREIGN KEY ("related_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_communications" ADD CONSTRAINT "dispute_communications_dispute_id_election_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."election_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_communications" ADD CONSTRAINT "dispute_communications_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_election_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."election_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_assigned_officer_users_id_fk" FOREIGN KEY ("assigned_officer") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_candidate_votes" ADD CONSTRAINT "submission_candidate_votes_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_candidate_votes" ADD CONSTRAINT "submission_candidate_votes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_corrections" ADD CONSTRAINT "submission_corrections_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_corrections" ADD CONSTRAINT "submission_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_corrections" ADD CONSTRAINT "submission_corrections_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_form_images" ADD CONSTRAINT "submission_form_images_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_ocr_suggestions" ADD CONSTRAINT "submission_ocr_suggestions_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_ocr_suggestions" ADD CONSTRAINT "submission_ocr_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_verification_steps" ADD CONSTRAINT "submission_verification_steps_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_verification_steps" ADD CONSTRAINT "submission_verification_steps_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_polling_station_id_polling_stations_id_fk" FOREIGN KEY ("polling_station_id") REFERENCES "public"."polling_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_submission_id_result_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."result_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_legal_approved_by_users_id_fk" FOREIGN KEY ("legal_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_comms_approved_by_users_id_fk" FOREIGN KEY ("comms_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;