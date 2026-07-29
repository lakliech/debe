ALTER TABLE "agent_training_enrollments" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_audit" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "data_breach_register" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "vendor_register" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_training_enrollments" ADD CONSTRAINT "agent_training_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_centre_tasks" ADD CONSTRAINT "command_centre_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_disputes" ADD CONSTRAINT "election_disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_incident_reports" ADD CONSTRAINT "election_incident_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transparency_publications" ADD CONSTRAINT "transparency_publications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_audit" ADD CONSTRAINT "consent_audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_breach_register" ADD CONSTRAINT "data_breach_register_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_register" ADD CONSTRAINT "vendor_register_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;