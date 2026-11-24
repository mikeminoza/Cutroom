CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"ms" integer NOT NULL,
	"tries" integer NOT NULL,
	"waited_ms" integer DEFAULT 0 NOT NULL,
	"first_words_ms" integer,
	"thinking_tokens" integer,
	"written_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_calls_created" ON "ai_calls" USING btree ("created_at");