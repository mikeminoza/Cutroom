CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"provider" text PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"email" text,
	"label" text,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"progress" real,
	"progress_step" text,
	"progress_detail" text,
	"heartbeat_at" timestamp with time zone,
	"kicked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"art_style" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'landscape' NOT NULL,
	"resolution" text DEFAULT '720p' NOT NULL,
	"caption_style" text DEFAULT 'highlight' NOT NULL,
	"mode" text DEFAULT 'review' NOT NULL,
	"target_minutes" real DEFAULT 3 NOT NULL,
	"pace" real DEFAULT 6 NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"voiceover_url" text,
	"voiceover_name" text,
	"voiceover_duration" real,
	"transcript" jsonb,
	"music_url" text,
	"music_name" text,
	"music_volume" real DEFAULT 0.15 NOT NULL,
	"thumbnail_url" text,
	"post" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"youtube_video_id" text,
	"drive_folder_id" text,
	"drive_folder_url" text,
	"drive_file_id" text,
	"output_url" text,
	"srt_url" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"index" integer NOT NULL,
	"start_time" real DEFAULT 0 NOT NULL,
	"end_time" real DEFAULT 0 NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"visual" text DEFAULT '' NOT NULL,
	"image_prompt" text DEFAULT '' NOT NULL,
	"characters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shot" text DEFAULT '' NOT NULL,
	"motion" text DEFAULT 'zoom-in' NOT NULL,
	"on_screen_text" text DEFAULT '' NOT NULL,
	"transition" text DEFAULT 'cut' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"image_url" text,
	"image_width" integer,
	"image_height" integer,
	"fit" text DEFAULT 'cover' NOT NULL,
	"focus_x" real DEFAULT 0.5 NOT NULL,
	"focus_y" real DEFAULT 0.5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;