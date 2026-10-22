import { deleteFile, isStoredUnder } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, notFound, readJson, route } from '@/server/http'
import { assertNotInUse, replacedFiles, syncPoses } from '@/server/library'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(
    request,
    z
      .object({
        name: z.string().max(100),
        description: z.string().max(2000),
        images: z.array(z.object({ url: z.string().max(2000), key: z.string().max(500) })).max(6),
        poses: z
          .array(
            z.object({
              id: z.string().max(100),
              name: z.string().trim().max(60),
              url: z.string().max(2000),
              key: z.string().max(500),
              blinkUrl: z.string().max(2000).nullable(),
              blinkKey: z.string().max(500).nullable(),
            }),
          )
          .max(40),
      })
      .partial(),
  )
  const database = await db()
  const [current] = await database
    .select()
    .from(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
  if (!current) notFound('That character')
  if (patch.images) {
    // Only files in this character's own folder: removing one deletes it.
    if (patch.images.some((i) => !isStoredUnder(i.url, `library/characters/${id}`))) {
      badRequest('Upload the images to this character first.')
    }
    const kept = new Set(patch.images.map((i) => i.url))
    await Promise.all(current.images.filter((i) => !kept.has(i.url)).map((i) => deleteFile(i.url)))
  }
  if (patch.poses) {
    // Poses also live in this character's folder; one that a video still needs can't go.
    const files = patch.poses.flatMap((p) => [p.url, p.blinkUrl].filter((u): u is string => Boolean(u)))
    if (files.some((url) => !isStoredUnder(url, `library/characters/${id}`))) {
      badRequest('Upload the pose to this character first.')
    }
    const kept = new Set(files)
    const removed = current.poses
      .flatMap((p) => [p.url, p.blinkUrl])
      .filter((u): u is string => Boolean(u) && !kept.has(u as string))
    // A picture replaced in place (touched up) moves its scenes to the new file, so its old file
    // may go; any other pose a video still needs can't.
    const replaced = replacedFiles(current.poses, patch.poses)
    await assertNotInUse(
      removed.filter((url) => !replaced.has(url)),
      'That pose',
    )
    await syncPoses(current.poses, patch.poses)
    await Promise.all(removed.map((url) => deleteFile(url)))
  }
  const [row] = await database
    .update(schema.libraryCharacters)
    .set(patch)
    .where(eq(schema.libraryCharacters.id, id))
    .returning()
  if (!row) notFound('That character')
  return { ...row, createdAt: row.createdAt.toISOString() }
})

/** Projects that used the character keep their own copies. */
export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const database = await db()
  const [current] = await database
    .select()
    .from(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
  if (current) {
    await assertNotInUse(
      current.poses.flatMap((p) => [p.url, p.blinkUrl ?? '']),
      `${current.name || 'This character'}'s poses`,
    )
  }
  const [row] = await database
    .delete(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
    .returning()
  if (row) {
    const files = [...row.images.map((i) => i.url), ...row.poses.flatMap((p) => [p.url, p.blinkUrl])]
    await Promise.all(files.map((url) => deleteFile(url)))
  }
  return { ok: true }
})
