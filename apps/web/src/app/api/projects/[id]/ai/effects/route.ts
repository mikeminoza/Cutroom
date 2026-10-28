import { addProjectEffects } from '@/server/drafting'
import { route } from '@/server/http'
import { getProjectFull } from '@/server/projects'

// A long video is a few Gemini calls (AI_BUDGET_MS ends them in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** "Add effects with AI": whips, zoom-cuts and shakes for scenes that are already split. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const effects = await addProjectEffects(id)
  return { ...(await getProjectFull(id)), effects }
})
