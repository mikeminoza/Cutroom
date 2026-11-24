import type { SceneDraft } from '@cutroom/shared/ai'
import { storyboardProject } from '@/server/drafting'
import { badRequest, route } from '@/server/http'
import { getProjectFull, getProjectRow } from '@/server/projects'
import { appUrl } from '@/server/settings'
import { answer, listChanges } from '@/server/stream'
import { resumeTasks } from '@/server/task-runner'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Splits the script into scenes with AI and saves them, answering the project. When the page asks,
 * the scenes are sent as Gemini writes them, in script order, as what changed since the last
 * event (server/stream.ts): a long storyboard sent whole each time would add up. A script too long
 * for one request answers the project with `continuing: true`: its scenes come in the background.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  if (!(await getProjectRow(id)).script.trim()) badRequest('Write or paste the script first.')
  return answer(
    request,
    async (events) => {
      const changes = listChanges<SceneDraft>()
      const continuing = await storyboardProject(
        id,
        events && { onPartial: (scenes) => events.onPartial?.(changes.to(scenes)) },
      )
      // A long script that ran out of time goes on in a run of its own, queued with the parts done:
      // answered with `continuing`, and the page shows the scenes once that run has saved them.
      if (!continuing) return getProjectFull(id)
      await resumeTasks(appUrl(request))
      return { ...(await getProjectFull(id)), continuing: true }
    },
    { projectId: id, kind: 'scenes' },
  )
})
