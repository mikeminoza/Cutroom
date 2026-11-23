import { hasGeminiKey, type SceneDraft } from '@cutroom/shared/ai'
import { z } from 'zod'
import { assertDraftable, draftProject } from '@/server/drafting'
import { badRequest, describeError, readJson, route } from '@/server/http'
import { getProjectFull } from '@/server/projects'
import { eventStream, listChanges } from '@/server/stream'
import { startTracking } from '@/server/tasks'

// The script and its storyboard in one request: the Hobby plan allows 300 s with Fluid compute (on
// by default), and the AI's budget ends the work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Writes the script live and storyboards it as it goes, answering one JSON event per line:
 * { type: 'title', title }, { type: 'text', add } as the script is written, { type: 'restart' }
 * when Gemini starts it over, { type: 'part', done, started } as the storyboard comes along with
 * { type: 'scenes', from, items }, its scenes so far in script order as what changed, then
 * { type: 'done', project, storyboardError } or { type: 'error', error, code }. Problems found
 * before writing starts (no topic, no key) answer as usual, with an error status.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { notes } = await readJson(request, z.object({ notes: z.string().max(4000).default('') }))
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to your environment to use AI features.')
  await assertDraftable(id)
  // Recorded while it runs, so a page opened meanwhile shows Gemini still writing, and waits.
  const task = await startTracking(id, 'draft')
  return eventStream(async (send) => {
    const scenes = listChanges<SceneDraft>()
    try {
      const { storyboardError } = await draftProject(id, notes, {
        onTitle: (title) => send({ type: 'title', title }),
        onText: (add) => send({ type: 'text', add }),
        onRestart: () => {
          scenes.reset()
          send({ type: 'restart' })
        },
        onPart: (done, started) => send({ type: 'part', done, started }),
        onScenes: (list) => send({ type: 'scenes', ...scenes.to(list) }),
      })
      await task.done()
      send({ type: 'done', project: await getProjectFull(id), storyboardError })
    } catch (error) {
      await task.failed(error)
      send({ type: 'error', ...describeError(error).body })
    }
  })
})
