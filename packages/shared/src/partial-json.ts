// Reading Gemini's JSON answer while it is still being written, so a page can show each item as
// soon as it's done instead of waiting for the whole answer.

/** Objects and lists the text ended inside of: more of them may still come. */
const unfinished = new WeakSet<object>()

/** What a value the text ends inside of reads as: nothing yet. */
const CUT = Symbol('cut')

/** A number as JSON writes it, all of it. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}
const WORDS: Record<string, unknown> = { true: true, false: false, null: null }

/**
 * What JSON text cut off anywhere holds so far. Strings, numbers, true, false and null are only in
 * it once written in full (a number once something follows it, since more digits may come), and an
 * object's key only with its value, so a longer cut of the same text only ever adds to it. Objects
 * and lists are in it from their first character, with their finished parts: isFinished says
 * whether they are closed. Never throws: text that isn't JSON gives what came before the problem.
 */
export function parsePartialJson(text: string): unknown {
  let i = 0
  /** Where reading stops: the end of the text, or the first thing that isn't JSON. */
  let end = text.length
  /** Stops reading at something that isn't JSON, keeping what came before it. */
  const invalid = <T>(sofar: T): T => {
    end = i
    return sofar
  }
  /** The same, for a value that isn't JSON: it reads as nothing. */
  const stop = (): typeof CUT => {
    end = i
    return CUT
  }
  const space = () => {
    while (i < end && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++
  }

  const value = (): unknown => {
    space()
    if (i >= end) return CUT
    const c = text[i]
    if (c === '{') return object()
    if (c === '[') return list()
    if (c === '"') return string()
    if (c === '-' || (c >= '0' && c <= '9')) return number()
    if (c === 't' || c === 'f' || c === 'n') return word()
    return stop()
  }

  const object = () => {
    i++
    const result: Record<string, unknown> = {}
    unfinished.add(result)
    space()
    if (text[i] === '}' && i < end) {
      i++
      unfinished.delete(result)
      return result
    }
    for (;;) {
      space()
      if (i >= end) return result
      if (text[i] !== '"') return invalid(result)
      const key = string()
      if (key === CUT) return result
      space()
      if (i >= end) return result
      if (text[i] !== ':') return invalid(result)
      i++
      const item = value()
      if (item === CUT) return result
      // As JSON.parse sets it: an own key, even one named like __proto__.
      Object.defineProperty(result, key as string, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      })
      space()
      if (i >= end) return result
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] !== '}') return invalid(result)
      i++
      unfinished.delete(result)
      return result
    }
  }

  const list = () => {
    i++
    const result: unknown[] = []
    unfinished.add(result)
    space()
    if (text[i] === ']' && i < end) {
      i++
      unfinished.delete(result)
      return result
    }
    for (;;) {
      const item = value()
      if (item === CUT) return result
      result.push(item)
      space()
      if (i >= end) return result
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] !== ']') return invalid(result)
      i++
      unfinished.delete(result)
      return result
    }
  }

  const string = (): string | typeof CUT => {
    const start = i
    i++
    let result = ''
    for (;;) {
      // Plain characters up to the next quote or escape, in one piece.
      let run = i
      while (run < end && text[run] !== '"' && text[run] !== '\\' && text[run] >= ' ') run++
      result += text.slice(i, run)
      i = run
      if (i >= end) return CUT
      const c = text[i]
      if (c === '"') {
        i++
        return result
      }
      // A raw line break or other control character: not JSON.
      if (c !== '\\') return stop()
      if (i + 1 >= end) return CUT
      const escaped = text[i + 1]
      if (escaped === 'u') {
        if (i + 6 > end) return CUT
        const hex = text.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return stop()
        result += String.fromCharCode(Number.parseInt(hex, 16))
        i += 6
      } else if (escaped in ESCAPES) {
        result += ESCAPES[escaped]
        i += 2
      } else {
        i = start
        return stop()
      }
    }
  }

  const number = () => {
    const start = i
    while (i < end && /[-+.eE0-9]/.test(text[i])) i++
    // More digits may still come.
    if (i >= end) return CUT
    const token = text.slice(start, i)
    if (!NUMBER.test(token)) {
      i = start
      return stop()
    }
    return Number(token)
  }

  const word = () => {
    for (const [spelled, meaning] of Object.entries(WORDS)) {
      if (text.startsWith(spelled, i) && i + spelled.length <= end) {
        i += spelled.length
        return meaning
      }
      // Still being written.
      if (end - i < spelled.length && spelled.startsWith(text.slice(i, end))) return CUT
    }
    return stop()
  }

  const result = value()
  return result === CUT ? undefined : result
}

/** Whether a value from parsePartialJson is written in full: anything but an open object or list. */
export function isFinished(value: unknown): boolean {
  return !(typeof value === 'object' && value !== null && unfinished.has(value))
}

/** The items of a list from parsePartialJson that are written in full: all but one still coming. */
export function finishedItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(isFinished) : []
}
