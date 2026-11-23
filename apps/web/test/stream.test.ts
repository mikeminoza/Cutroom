import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/lib/api'
import { readEvents, streamAnswer } from '../src/lib/stream'

/** A response body that arrives in these pieces. */
const bodyOf = (pieces: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece))
      controller.close()
    },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading events as they arrive', () => {
  it('reads one event per line, however the lines arrive', async () => {
    const events = []
    for await (const event of readEvents(
      bodyOf([
        '{"type":"title","title":"Sle',
        'ep"}\n{"type":"text","add":"Look at you"}\n',
        '\n{"type":"part","done":1,"started":2}',
      ]),
    )) {
      events.push(event)
    }
    expect(events).toEqual([
      { type: 'title', title: 'Sleep' },
      { type: 'text', add: 'Look at you' },
      { type: 'part', done: 1, started: 2 },
    ])
  })
})

describe('an AI answer as Gemini writes it', () => {
  /** The route answers with these lines, in pieces cut anywhere. */
  const answering = (lines: unknown[], status = 200) => {
    const text = lines.map((line) => `${JSON.stringify(line)}\n`).join('')
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(bodyOf([text.slice(0, 9), text.slice(9, 40), text.slice(40)]), { status }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('hands over each part as it comes, and resolves with the whole answer', async () => {
    const fetchMock = answering([
      { type: 'thinking', text: 'Reading the script' },
      { type: 'partial', data: { notes: ['a'] } },
      { type: 'restart' },
      { type: 'partial', data: { notes: ['a', 'b'] } },
      { type: 'done', data: { notes: ['a', 'b', 'c'] } },
    ])
    const seen: string[] = []
    const result = await streamAnswer<{ notes: string[] }>(
      '/api/projects/p/ai/packaging',
      {},
      {
        partial: (data) => seen.push(`partial ${data.notes.join('')}`),
        restart: () => seen.push('restart'),
        thinking: (text) => seen.push(`thinking ${text}`),
      },
    )
    expect(result).toEqual({ notes: ['a', 'b', 'c'] })
    expect(seen).toEqual(['thinking Reading the script', 'partial a', 'restart', 'partial ab'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/p/ai/packaging')
    expect(new Headers(init?.headers).get('accept')).toBe('application/x-ndjson')
  })

  it('fails as a plain request would: on an error event, a refusal, or a broken connection', async () => {
    answering([
      { type: 'partial', data: {} },
      { type: 'error', error: 'Gemini is busy right now. Try again in a minute.', code: 'busy' },
    ])
    const busy = await streamAnswer('/api/x').catch((error) => error)
    expect(busy).toBeInstanceOf(ApiError)
    expect(busy).toMatchObject({ message: 'Gemini is busy right now. Try again in a minute.', status: 503 })

    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Write or paste the script first.' }, { status: 400 }),
    )
    await expect(streamAnswer('/api/x')).rejects.toMatchObject({
      message: 'Write or paste the script first.',
      status: 400,
    })

    answering([{ type: 'partial', data: {} }])
    await expect(streamAnswer('/api/x')).rejects.toThrow('The connection broke before Gemini finished.')
  })
})
