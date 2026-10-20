-- Before the index: if a project somehow has more than one active job, keep only the newest.
UPDATE "jobs" SET "status" = 'failed', "error" = 'Replaced by a newer job.', "runner_id" = NULL, "finished_at" = now()
WHERE "status" IN ('queued', 'running', 'waiting') AND EXISTS (
	SELECT 1 FROM "jobs" AS "newer"
	WHERE "newer"."project_id" = "jobs"."project_id"
		AND "newer"."status" IN ('queued', 'running', 'waiting')
		AND ("newer"."created_at", "newer"."id") > ("jobs"."created_at", "jobs"."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_per_project" ON "jobs" USING btree ("project_id") WHERE "jobs"."status" in ('queued', 'running', 'waiting');--> statement-breakpoint
-- Videos already on YouTube went to the one channel connected before multi-channel support. Pin
-- them to it, so making another channel the default never moves them.
UPDATE "projects" SET "channel_id" = 'migrated-youtube'
WHERE "channel_id" IS NULL AND "youtube_video_id" IS NOT NULL
	AND EXISTS (SELECT 1 FROM "channels" WHERE "id" = 'migrated-youtube');
