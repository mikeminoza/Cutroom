import { estimateSeconds } from '@cutroom/shared/timing'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { badRequest, route } from '@/server/http'
import { getProjectFull, getProjectRow, getScenes, touchProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

/** No AI: spreads the scenes over the voice-over length in proportion to their narration. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  const scenes = await getScenes(id)
  const duration = project.voiceoverDuration
  if (!duration) badRequest('Upload a voice-over first.')
  if (scenes.length === 0) badRequest('Add scenes first.')
  const weights = scenes.map((s) => estimateSeconds(s.narration || 'x'))
  const total = weights.reduce((a, b) => a + b, 0)
  const database = await db()
  let cursor = 0
  for (const [i, scene] of scenes.entries()) {
    const length = (weights[i] / total) * duration
    const start = Math.round(cursor * 100) / 100
    const end = i === scenes.length - 1 ? duration : Math.round((cursor + length) * 100) / 100
    await database.update(schema.scenes).set({ start, end }).where(eq(schema.scenes.id, scene.id))
    cursor += length
  }
  await touchProject(id)
  return getProjectFull(id)
})
