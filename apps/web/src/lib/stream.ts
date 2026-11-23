// AI answers that arrive while Gemini writes them (server/stream.ts): one JSON event per line, so
// the page can show each part as soon as it's written. Write with AI (lib/draft.ts) reads its
// script the same way.
import { ApiError } from './api'

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
export async function* readEvents<E>(body: ReadableStream<Uint8Array>): AsyncGenerator<E> {
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
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as E
    if (done) return
  }
}

type Ending = { type: 'done' } | { type: 'error'; error: string; code?: string }

/**
 * Posts `body` to a route that answers one event per line, telling `onEvent` each one as it
 * arrives. Resolves with the 'done' event; an 'error' event throws as a failed request would, and
 * so does a connection that breaks first (with `broken` as the message).
 */
export async function postForEvents<E extends { type: string }>(
  url: string,
  body: unknown,
  onEvent: (event: E) => void,
  broken: string,
): Promise<Extract<E, { type: 'done' }>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (res.status === 401) window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
  // Refused before Gemini started (no script, no key, already running): a plain JSON error.
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.error ?? `Request failed (HTTP ${res.status}).`, res.status)
  }
  for await (const event of readEvents<E | Ending>(res.body)) {
    onEvent(event as E)
    if (event.type === 'done') return event as Extract<E, { type: 'done' }>
    if (event.type === 'error') {
      const { error, code } = event as Extract<Ending, { type: 'error' }>
      throw new ApiError(error, STATUS_OF[code ?? ''] ?? 502)
    }
  }
  throw new Error(broken)
}

/** What an AI answer sent as Gemini writes it says along the way. */
export interface AnswerHandlers<P> {
  /** The answer so far, shaped like the whole one: each part shows once Gemini has written it. */
  partial?: (data: P) => void
  /** Gemini started over: drop what came so far. */
  restart?: () => void
  /** What Gemini is thinking about, in a few words (the script doctor). */
  thinking?: (text: string) => void
}

type AnswerEvent<T, P> =
  | { type: 'partial'; data: P }
  | { type: 'restart' }
  | { type: 'thinking'; text: string }
  | { type: 'done'; data: T }

/**
 * Asks an AI route for its answer as Gemini writes it, telling `on` along the way. Resolves with
 * the whole answer, the same as a plain request to the route answers.
 */
export async function streamAnswer<T, P = T>(
  url: string,
  body: unknown = {},
  on: AnswerHandlers<P> = {},
  broken = 'The connection broke before Gemini finished. Try again.',
): Promise<T> {
  const done = await postForEvents<AnswerEvent<T, P>>(
    url,
    body,
    (event) => {
      if (event.type === 'partial') on.partial?.(event.data)
      else if (event.type === 'restart') on.restart?.()
      else if (event.type === 'thinking') on.thinking?.(event.text)
    },
    broken,
  )
  return done.data
}
