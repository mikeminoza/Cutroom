import { hasGeminiKey } from '@cutroom/shared/ai'
import { z } from 'zod'
import { assertDraftable, draftProject } from '@/server/drafting'
import { badRequest, describeError, readJson, route } from '@/server/http'
import { getProjectFull } from '@/server/projects'
import { startTracking } from '@/server/tasks'

// The script and its storyboard in one request: the Hobby plan allows 300 s with Fluid compute (on
// by default), and the AI's budget ends the work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Writes the script live and storyboards it as it goes, answering one JSON event per line:
 * { type: 'title', title }, { type: 'text', add } as the script is written, { type: 'restart' }
 * when Gemini starts it over, { type: 'part', done, started } as the storyboard comes along, then
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
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The page went away: the draft is still finished and saved.
        }
      }
      try {
        const { storyboardError } = await draftProject(id, notes, {
          onTitle: (title) => send({ type: 'title', title }),
          onText: (add) => send({ type: 'text', add }),
          onRestart: () => send({ type: 'restart' }),
          onPart: (done, started) => send({ type: 'part', done, started }),
        })
        await task.done()
        send({ type: 'done', project: await getProjectFull(id), storyboardError })
      } catch (error) {
        await task.failed(error)
        send({ type: 'error', ...describeError(error).body })
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed by the page going away.
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      // Each line as soon as it's written: no caching or compressing proxy holding them back.
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
})
