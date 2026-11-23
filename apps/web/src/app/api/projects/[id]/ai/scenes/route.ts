import type { SceneDraft } from '@cutroom/shared/ai'
import { storyboardProject } from '@/server/drafting'
import { badRequest, route } from '@/server/http'
import { getProjectFull, getProjectRow } from '@/server/projects'
import { answer, listChanges } from '@/server/stream'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Splits the script into scenes with AI and saves them, answering the project. When the page asks,
 * the scenes are sent as Gemini writes them, in script order, as what changed since the last
 * event (server/stream.ts): a long storyboard sent whole each time would add up.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  if (!(await getProjectRow(id)).script.trim()) badRequest('Write or paste the script first.')
  return answer(
    request,
    async (events) => {
      const changes = listChanges<SceneDraft>()
      await storyboardProject(id, events && { onPartial: (scenes) => events.onPartial?.(changes.to(scenes)) })
      return getProjectFull(id)
    },
    { projectId: id, kind: 'scenes' },
  )
})
