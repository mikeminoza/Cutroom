import { describe, expect, it } from 'vitest'
import { readEvents } from '../src/lib/draft'

/** A response body that arrives in these pieces. */
const bodyOf = (pieces: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece))
      controller.close()
    },
  })

describe('reading a live draft', () => {
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
