CREATE TABLE "breakouts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"channel_title" text DEFAULT '' NOT NULL,
	"youtube_channel_id" text DEFAULT '' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"channel_average" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"thumbnail_url" text,
	"published_at" timestamp with time zone,
	"query" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"idea_id" text,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "breakouts" ADD CONSTRAINT "breakouts_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;