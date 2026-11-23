import { describe, expect, it } from 'vitest'
import { finishedItems, isFinished, parsePartialJson } from '../src/partial-json'

/**
 * Whether `after` holds everything `before` did: lists as long or longer, objects with the same
 * keys or more, and the same finished values. Nothing written yet grows into anything.
 */
function grows(before: unknown, after: unknown): boolean {
  if (before === undefined) return true
  if (Array.isArray(before)) {
    return Array.isArray(after) && after.length >= before.length && before.every((v, i) => grows(v, after[i]))
  }
  if (before && typeof before === 'object') {
    if (!after || typeof after !== 'object' || Array.isArray(after)) return false
    return Object.entries(before).every(([key, value]) => key in after && grows(value, (after as never)[key]))
  }
  return Object.is(before, after)
}

const DOCUMENTS = [
  // Compact, as Gemini writes it.
  JSON.stringify({
    edits: [
      { original: 'Look at you', suggestion: 'Look at you, goblin', kind: 'funnier', why: 'Sharper.' },
      { original: 'It is "basic" biology.', suggestion: '', kind: 'cut', why: 'Filler\\slow.' },
    ],
    claims: [],
    score: -12.5e3,
    flags: [true, false, null, 0, 7],
  }),
  // Pretty-printed, with escapes, accents, emoji and nesting.
  `{
  "title" : "Caf\\u00e9 \\ud83d\\ude00 and café 😀",
  "lines": ["one\\nline", "tab\\there", "slash\\/"],
  "nested": { "deep": [[1, 2], [], {}], "empty": "" },
  "n": 0.25
}`,
  '[{"a":1},{"b":[true]},"x",3]',
]

describe('reading JSON while it is written', () => {
  it('never throws wherever the text is cut, only grows, and ends as JSON.parse reads it', () => {
    for (const document of DOCUMENTS) {
      let before: unknown
      for (let cut = 0; cut <= document.length; cut++) {
        const now = parsePartialJson(document.slice(0, cut))
        expect(grows(before, now), `cut at ${cut} of ${document}`).toBe(true)
        before = now
      }
      expect(before).toEqual(JSON.parse(document))
      expect(isFinished(before)).toBe(true)
    }
  })

  it('leaves out what is still being written: a string, a number, a key or a word', () => {
    expect(parsePartialJson('')).toBeUndefined()
    expect(parsePartialJson('{"title":"Why you wa')).toEqual({})
    expect(parsePartialJson('{"title":"Why"')).toEqual({ title: 'Why' })
    expect(parsePartialJson('{"tit')).toEqual({})
    expect(parsePartialJson('{"title":')).toEqual({})
    // A number may have more digits coming until something follows it.
    expect(parsePartialJson('{"score":1')).toEqual({})
    expect(parsePartialJson('{"score":10,')).toEqual({ score: 10 })
    expect(parsePartialJson('{"kept":tr')).toEqual({})
    expect(parsePartialJson('{"kept":true')).toEqual({ kept: true })
    expect(parsePartialJson('{"why":"a\\')).toEqual({})
    expect(parsePartialJson('{"why":"caf\\u00')).toEqual({})
  })

  it('says which lists and objects are finished, and which of their items', () => {
    const answer = parsePartialJson(
      '{"ideas":[{"title":"A","angle":"x"},{"title":"B","angle":"y"},{"title":"C"',
    )
    const ideas = (answer as { ideas: unknown[] }).ideas
    expect(isFinished(answer)).toBe(false)
    expect(isFinished(ideas)).toBe(false)
    expect(ideas).toHaveLength(3)
    expect(finishedItems(ideas)).toEqual([
      { title: 'A', angle: 'x' },
      { title: 'B', angle: 'y' },
    ])
    expect(finishedItems(parsePartialJson('["a","b'))).toEqual(['a'])
    expect(finishedItems(parsePartialJson('["a","b"'))).toEqual(['a', 'b'])
    expect(finishedItems(parsePartialJson('[{"a":[1,2]}]'))).toEqual([{ a: [1, 2] }])
    // Not a list (yet).
    expect(finishedItems(undefined)).toEqual([])
    expect(finishedItems({ a: 1 })).toEqual([])
  })

  it('gives what came before the problem when the text is not JSON', () => {
    expect(parsePartialJson('{"a":1,"b":nope}')).toEqual({ a: 1 })
    expect(parsePartialJson('{"a":[1,2,}')).toEqual({ a: [1, 2] })
    expect(parsePartialJson('{"a":01}')).toEqual({})
    expect(parsePartialJson('Sure! Here is')).toBeUndefined()
    expect(parsePartialJson('{"a":"line\nbreak"}')).toEqual({})
    // A key named like an object's own machinery is just a key, as JSON.parse reads it.
    const odd = parsePartialJson('{"__proto__":{"x":1}}') as Record<string, unknown>
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype)
    expect(odd).toEqual(JSON.parse('{"__proto__":{"x":1}}'))
  })
})
