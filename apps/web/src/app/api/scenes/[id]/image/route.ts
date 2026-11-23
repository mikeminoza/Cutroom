import { route } from '@/server/http'
import { makeScenePicture } from '@/server/images'
import { getScene, toSceneDTO } from '@/server/projects'
import { tracked } from '@/server/tasks'

// Image models take 10–40 seconds.
// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Generates the scene's picture from its prompt (characters' reference images attached). Recorded
 * while it runs, so a reopened page shows the picture still being made and doesn't ask for it twice.
 */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const scene = await getScene(id)
  const updated = await tracked(scene.projectId, 'picture', () => makeScenePicture(id), { sceneIds: [id] })
  // The scene was deleted while its picture was being made.
  return updated ? toSceneDTO(updated) : { ok: false }
})
