ALTER TABLE "contact_messages" ADD COLUMN "reply_note" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "replied_by" uuid;