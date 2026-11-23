CREATE TABLE "comment_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"project_id" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"status" text DEFAULT 'waiting' NOT NULL,
	"draft" text,
	"skip_reason" text,
	"reply_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "replies_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_replies" ADD CONSTRAINT "comment_replies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_replies" ADD CONSTRAINT "comment_replies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;