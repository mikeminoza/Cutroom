// Writing a project's script live (POST /api/projects/[id]/ai/draft): Gemini's words arrive as
// they're written, and the storyboard is made from them at the same time. The answer is one JSON
// event per line.
import { ApiError } from './api'
import type { ProjectFull } from './dto'

export type DraftEvent =
  | { type: 'title'; title: string }
  /** More of the script. */
  | { type: 'text'; add: string }
  /** Gemini started the script over: drop what came so far. */
  | { type: 'restart' }
  /** Parts of the script storyboarded so far, of the parts started. */
  | { type: 'part'; done: number; started: number }
  /** Saved. With a storyboardError the script is saved but its scenes are not. */
  | { type: 'done'; project: ProjectFull; storyboardError: string | null }
  | { type: 'error'; error: string; code?: string }

/** The HTTP status a plain request would have answered with, by the AI's error code. */
const STATUS_OF: Record<string, number> = {
  missing_key: 400,
  billing: 402,
  rate_limited: 429,
  daily_limit: 429,
  busy: 503,
  timeout: 504,
}

/** The events in a response body, one per line, as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<DraftEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    // `stream` keeps a character split between two pieces whole.
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // The last piece may be half a line: keep it until the rest arrives (or the stream ends).
    buffer = done ? '' : (lines.pop() ?? '')
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as DraftEvent
    if (done) return
  }
}

/**
 * Has Gemini write the project's script live and storyboard it, telling `onEvent` as it goes.
 * Resolves once the script (and, unless storyboardError says otherwise, its scenes) are saved.
 */
export async function writeDraft(
  projectId: string,
  notes: string,
  onEvent: (event: DraftEvent) => void = () => {},
): Promise<{ project: ProjectFull; storyboardError: string | null }> {
  const res = await fetch(`/api/projects/${projectId}/ai/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes }),
    cache: 'no-store',
  })
  if (res.status === 401) window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.error ?? `Request failed (HTTP ${res.status}).`, res.status)
  }
  for await (const event of readEvents(res.body)) {
    onEvent(event)
    if (event.type === 'done') return { project: event.project, storyboardError: event.storyboardError }
    if (event.type === 'error') throw new ApiError(event.error, STATUS_OF[event.code ?? ''] ?? 502)
  }
  throw new Error('The connection broke before the script was saved. Reload the page to see how far it got.')
}
