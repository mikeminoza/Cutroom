CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"project_id" text,
	"batch_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"inline" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_project" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_batch" ON "tasks" USING btree ("batch_id");