ALTER TABLE "projects" ADD COLUMN "sound_effects" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "accent" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "accent_word" text DEFAULT '' NOT NULL;