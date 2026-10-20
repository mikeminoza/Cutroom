CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"youtube_id" text,
	"title" text DEFAULT '' NOT NULL,
	"email" text,
	"refresh_token" text NOT NULL,
	"scope" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_youtube_id_unique" UNIQUE("youtube_id")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"angle" text DEFAULT '' NOT NULL,
	"series_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_characters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "runner_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "text_overlays" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "voice" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "channel_youtube_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_project_id" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The YouTube connection from before multi-channel support becomes the default channel.
INSERT INTO "channels" ("id", "youtube_id", "title", "email", "refresh_token", "scope", "is_default", "created_at")
SELECT 'migrated-youtube', NULL, COALESCE("label", ''), "email", "refresh_token", "scope", true, "created_at"
FROM "connections" WHERE "provider" = 'youtube'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "connections" WHERE "provider" = 'youtube';
