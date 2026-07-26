CREATE TABLE "aspirants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone_number" text NOT NULL,
	"national_id" text NOT NULL,
	"position" text NOT NULL,
	"county_id" uuid,
	"county_name" text,
	"constituency" text,
	"ward" text,
	"party_affiliation" text,
	"is_independent" boolean DEFAULT false NOT NULL,
	"statement_of_intent" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"consent_given" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aspirants" ADD CONSTRAINT "aspirants_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;