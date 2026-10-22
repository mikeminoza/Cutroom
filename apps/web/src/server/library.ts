// The Library's shared picture files (character poses, backgrounds). Layered scenes point at them
// directly, so they are reused by every video instead of copied into each one.
import type { CharacterPose } from '@cutroom/shared/types'
import { and, inArray, isNull, or, sql } from 'drizzle-orm'
import { db, schema } from './db'
import { badRequest } from './http'

/**
 * Refuses to delete Library files that videos not yet posted still use: their render would fail.
 * Posted videos are already rendered, so they don't count.
 */
export async function assertNotInUse(urls: string[], what: string) {
  const wanted = urls.filter(Boolean)
  if (wanted.length === 0) return
  const database = await db()
  const rows = await database
    .selectDistinct({ projectId: schema.scenes.projectId })
    .from(schema.scenes)
    .innerJoin(schema.projects, sql`${schema.projects.id} = ${schema.scenes.projectId}`)
    .where(
      and(
        isNull(schema.projects.youtubeVideoId),
        or(
          inArray(sql`${schema.scenes.layer}->>'backgroundUrl'`, wanted),
          inArray(sql`${schema.scenes.layer}->>'poseUrl'`, wanted),
          inArray(sql`${schema.scenes.layer}->>'blinkUrl'`, wanted),
        ),
      ),
    )
  if (rows.length) {
    badRequest(
      `${what} is used in ${rows.length === 1 ? 'a video' : `${rows.length} videos`} that are not posted yet. Pick another picture for those scenes first.`,
    )
  }
}

/**
 * Scenes keep a copy of their pose's name and eyes-closed picture: when either changes in the
 * Library (say, an eyes-closed version is added later), the scenes using that pose follow.
 */
export async function syncPoses(before: CharacterPose[], after: CharacterPose[]) {
  const changed = after.filter((pose) => {
    const old = before.find((p) => p.url === pose.url)
    return old && (old.name !== pose.name || old.blinkUrl !== pose.blinkUrl)
  })
  if (changed.length === 0) return
  const database = await db()
  for (const pose of changed) {
    const update = JSON.stringify({ pose: pose.name, blinkUrl: pose.blinkUrl })
    await database
      .update(schema.scenes)
      .set({ layer: sql`${schema.scenes.layer} || ${update}::jsonb` })
      .where(sql`${schema.scenes.layer}->>'poseUrl' = ${pose.url}`)
  }
}
