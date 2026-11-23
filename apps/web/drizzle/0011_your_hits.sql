ALTER TABLE "ideas" ADD COLUMN "follow_up_of" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_follow_up_of_projects_id_fk" FOREIGN KEY ("follow_up_of") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;