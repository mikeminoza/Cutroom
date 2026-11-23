// AI answers sent while Gemini writes them: one JSON event per line (NDJSON), read on the page by
// lib/stream.ts. Writing is most of an AI request's wait, so the page shows each item as soon as
// it's written instead of all of them at the end.
import type { AnswerEvents } from '@cutroom/shared/ai'
import type { ListChange } from '@/lib/stream'
import type { TaskKind } from '@/lib/tasks'
import { describeError } from './http'
import { startTracking, tracked } from './tasks'

const NDJSON = 'application/x-ndjson'

/**
 * A response that sends `run`'s events as they happen, one JSON object per line. The work goes on
 * when the page goes away; events sent after that are dropped.
 */
export function eventStream(
  run: (send: (event: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The page went away: the work still finishes (and saves what it saves).
        }
      }
      try {
        await run(send)
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
      'content-type': `${NDJSON}; charset=utf-8`,
      // Each line as soon as it's written: no caching or compressing proxy holding them back.
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}

/**
 * What changed in a list that grows at its end (a storyboard's scenes), to send instead of the
 * whole list each time: a long list sent whole on every scene would add up to megabytes. A list
 * that got shorter (a part Gemini started over) is sent as where it ends now.
 */
export function listChanges<T>() {
  let sent = 0
  return {
    /** The change from the list sent last to `list`. */
    to(list: T[]): ListChange<T> {
      const from = Math.min(sent, list.length)
      sent = list.length
      return { from, items: list.slice(from) }
    },
    /** The page dropped what it had (a restart): the next change is the whole list. */
    reset() {
      sent = 0
    },
  }
}

/**
 * Answers AI work as Gemini writes it, when the page asks for that (lib/stream.ts sends
 * `accept: application/x-ndjson`): { type: 'partial', data } whenever more of the answer is
 * finished, { type: 'thinking', text } with what Gemini is thinking about, { type: 'restart' } when
 * Gemini starts over (drop what came so far), then { type: 'done', data } with what the route
 * answers otherwise, or { type: 'error', error, code }. Asked without it (other callers), `work`
 * gets no events, Gemini answers in one piece, and the route answers as usual.
 *
 * Call it once the request is checked: a problem found before (no script, no key) answers as
 * usual, with its status. With `track`, the work is recorded while it runs (server/tasks.ts), so a
 * page opened meanwhile shows it still going, streamed or not.
 */
export async function answer<T, P>(
  request: Request,
  work: (events?: AnswerEvents<P>) => Promise<T>,
  track?: { projectId: string; kind: TaskKind },
): Promise<T | Response> {
  if (!request.headers.get('accept')?.includes(NDJSON)) {
    return track ? tracked(track.projectId, track.kind, () => work()) : work()
  }
  // Refused while the same work runs: as usual, before the stream starts.
  const task = track ? await startTracking(track.projectId, track.kind) : null
  return eventStream(async (send) => {
    try {
      const data = await work({
        onPartial: (partial) => send({ type: 'partial', data: partial }),
        onRestart: () => send({ type: 'restart' }),
        onThought: (headline) => send({ type: 'thinking', text: headline }),
      })
      await task?.done()
      send({ type: 'done', data })
    } catch (error) {
      await task?.failed(error)
      send({ type: 'error', ...describeError(error).body })
    }
  })
}
