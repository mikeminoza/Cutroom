CREATE TABLE "comment_insights" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"insights" jsonb NOT NULL,
	"videos" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_insights" ADD CONSTRAINT "comment_insights_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;