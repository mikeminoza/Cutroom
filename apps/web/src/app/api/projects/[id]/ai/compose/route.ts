import { pickSceneLayers } from '@cutroom/shared/ai'
import type { SceneLayer } from '@cutroom/shared/types'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { getCharacters, getProjectFull, getScenes, touchProject } from '@/server/projects'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Builds scene pictures from the Library: for every scene without an uploaded picture (and, unless
 * `redo`, without layers yet), Gemini picks a background and a character pose that fit. Characters
 * in the project come first; the Library's other characters can appear too.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { redo } = await readJson(request, z.object({ redo: z.boolean().default(false) }))
  const database = await db()
  const [scenes, characters, backgrounds, library] = await Promise.all([
    getScenes(id),
    getCharacters(id),
    database.select().from(schema.libraryBackgrounds),
    database.select().from(schema.libraryCharacters),
  ])
  if (scenes.length === 0) badRequest('Split the script into scenes first.')
  const named = (name: string) => name.trim().toLowerCase()
  const inProject = new Set(characters.map((c) => named(c.name)))
  const cast = library
    .filter((c) => c.name.trim() && c.poses.length > 0)
    .sort((a, b) => Number(inProject.has(named(b.name))) - Number(inProject.has(named(a.name))))
  const usable = backgrounds.filter((b) => b.name.trim())
  if (usable.length === 0 && cast.length === 0) {
    badRequest('Add named backgrounds or character poses in the Library first.')
  }
  const targets = scenes.filter((s) => !s.imageUrl && (redo || !s.layer))
  if (targets.length === 0) return getProjectFull(id)

  const picks = await pickSceneLayers({
    scenes: targets.map((s) => ({ narration: s.narration, visual: s.visual })),
    backgrounds: usable.map((b) => b.name.trim()),
    characters: cast.map((c) => ({
      name: c.name.trim(),
      poses: c.poses.map((p) => p.name.trim()).filter(Boolean),
    })),
  })
  for (const [i, pick] of picks.entries()) {
    const background = usable.find((b) => named(b.name) === named(pick.background))
    const character = cast.find((c) => named(c.name) === named(pick.character))
    const pose = character?.poses.find((p) => named(p.name) === named(pick.pose))
    if (!background && !pose) continue
    const layer: SceneLayer = {
      backgroundUrl: background?.url ?? null,
      background: background?.name ?? '',
      poseUrl: pose?.url ?? null,
      blinkUrl: pose?.blinkUrl ?? null,
      character: pose ? (character?.name ?? '') : '',
      pose: pose?.name ?? '',
      side: pick.side,
    }
    await database.update(schema.scenes).set({ layer }).where(eq(schema.scenes.id, targets[i].id))
  }
  await touchProject(id)
  return getProjectFull(id)
})
