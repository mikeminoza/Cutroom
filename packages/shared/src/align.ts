// Matches the script's scenes to the words actually spoken in the voice-over,
// so each scene starts exactly when its narration starts.
import type { Transcript, TranscriptSegment, Word } from './types'

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function similar(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false
  // One edit apart (typos, plurals, number words spelled differently).
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

interface ScriptToken {
  scene: number
  text: string
}

/** Longest common subsequence with fuzzy word equality. Returns matched index pairs. */
function lcsPairs(a: ScriptToken[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const width = m + 1
  const table = new Uint16Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = similar(a[i].text, b[j])
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (similar(a[i].text, b[j])) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  return pairs
}

export interface AlignResult {
  times: { start: number; end: number }[]
  matchedRatio: number
}

/**
 * Returns new start/end times for each scene. Scenes whose words were never
 * found get times interpolated from their neighbours by word position.
 */
export function alignScenes(narrations: string[], words: Word[], duration: number): AlignResult {
  const script: ScriptToken[] = []
  narrations.forEach((text, scene) => {
    for (const raw of text.split(/\s+/)) {
      const token = normalize(raw)
      if (token) script.push({ scene, text: token })
    }
  })
  const spoken = words.map((w) => normalize(w.text))
  const sceneCount = narrations.length
  if (sceneCount === 0) return { times: [], matchedRatio: 0 }

  let pairs: [number, number][] = []
  // ~32 MB table at the cap, which covers roughly a 25-minute voice-over.
  // Longer ones fall back to spreading scenes by word position.
  if (script.length > 0 && spoken.length > 0 && script.length * spoken.length <= 16_000_000) {
    pairs = lcsPairs(script, spoken)
  }

  // First spoken time for each scene, plus each scene's first token position.
  const firstToken: number[] = new Array(sceneCount).fill(-1)
  script.forEach((token, i) => {
    if (firstToken[token.scene] === -1) firstToken[token.scene] = i
  })
  const anchor: (number | null)[] = new Array(sceneCount).fill(null)
  for (const [si, wi] of pairs) {
    const scene = script[si].scene
    if (anchor[scene] === null) {
      // Back off by the number of unmatched words before this one in the scene,
      // estimated from the spoken word rate around it.
      const lead = si - firstToken[scene]
      const word = words[wi]
      const rate = Math.max(0.15, word.end - word.start)
      anchor[scene] = Math.max(0, word.start - lead * rate)
    }
  }

  const starts: number[] = new Array(sceneCount).fill(0)
  const wordPosition = (scene: number) => {
    const index = firstToken[scene] === -1 ? 0 : firstToken[scene]
    return script.length > 0 ? index / script.length : scene / sceneCount
  }
  for (let s = 0; s < sceneCount; s++) {
    if (s === 0) {
      starts[s] = 0
      continue
    }
    if (anchor[s] !== null) {
      starts[s] = anchor[s] as number
      continue
    }
    // Interpolate between the nearest anchored scenes using word positions.
    let prev = s - 1
    while (prev > 0 && anchor[prev] === null) prev--
    let next = s + 1
    while (next < sceneCount && anchor[next] === null) next++
    const prevTime = prev === 0 ? 0 : (anchor[prev] as number)
    const nextTime = next < sceneCount ? (anchor[next] as number) : duration
    const prevPos = wordPosition(prev)
    const nextPos = next < sceneCount ? wordPosition(next) : 1
    const t = nextPos > prevPos ? (wordPosition(s) - prevPos) / (nextPos - prevPos) : 0.5
    starts[s] = prevTime + (nextTime - prevTime) * t
  }

  // Keep scenes in order and at least half a second long.
  for (let s = 1; s < sceneCount; s++) {
    starts[s] = Math.max(starts[s], starts[s - 1] + 0.5)
  }
  const times = starts.map((start, s) => {
    const end = s + 1 < sceneCount ? starts[s + 1] : Math.max(duration, start + 0.5)
    return { start: round(start), end: round(end) }
  })
  return { times, matchedRatio: script.length > 0 ? pairs.length / script.length : 0 }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * No script? Builds scenes straight from the voice-over, cutting at sentence
 * boundaries roughly every `pace` seconds.
 */
export function scenesFromSegments(
  segments: TranscriptSegment[],
  pace: number,
  duration: number,
): { start: number; end: number; narration: string }[] {
  const scenes: { start: number; end: number; narration: string }[] = []
  let current: TranscriptSegment[] = []
  const flush = () => {
    if (current.length === 0) return
    scenes.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      narration: current.map((s) => s.text.trim()).join(' '),
    })
    current = []
  }
  for (const segment of segments) {
    current.push(segment)
    const length = segment.end - current[0].start
    if (length >= pace * 0.8) flush()
  }
  flush()
  if (scenes.length > 0) {
    scenes[0].start = 0
    for (let i = 0; i < scenes.length - 1; i++) scenes[i].end = scenes[i + 1].start
    scenes[scenes.length - 1].end = Math.max(duration, scenes[scenes.length - 1].end)
  }
  return scenes.map((s) => ({ ...s, start: round(s.start), end: round(s.end) }))
}

// ---------------------------------------------------------------------------
// Word timing from pauses. A transcript only says when each sentence starts and ends, so each
// word's time is an estimate. The pauses in the recording (found with ffmpeg's silencedetect)
// make it much better: sentence edges are moved onto the real pauses, and words are spread only
// over the time someone is actually speaking, with each pause placed after the word where the
// speaker most likely paused.

export interface Span {
  start: number
  end: number
}

/** Parts of [start, end] where someone is speaking: the range minus the silences inside it. */
export function speechParts(silences: Span[], start: number, end: number, minimum = 0.04): Span[] {
  const parts: Span[] = []
  let cursor = start
  for (const silence of silences) {
    if (silence.end <= cursor || silence.start >= end) continue
    if (silence.start > cursor) parts.push({ start: cursor, end: Math.min(silence.start, end) })
    cursor = Math.max(cursor, silence.end)
    if (cursor >= end) break
  }
  if (cursor < end) parts.push({ start: cursor, end })
  return parts.filter((p) => p.end - p.start >= minimum)
}

/** Where people pause: after punctuation. */
const PAUSE_AFTER = /[.!?…,;:—–]["')\]”’]?$/

const weightOf = (token: string) => token.length + 2

/**
 * Times the words of `text` spoken somewhere in `span`, skipping the pauses inside it.
 * `silences` must be sorted and must not overlap.
 */
export function timeWords(text: string, span: Span, silences: Span[]): Word[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  let parts = speechParts(silences, span.start, span.end)
  if (parts.length === 0) parts = [{ start: span.start, end: Math.max(span.end, span.start + 0.1) }]
  // Never more stretches of speech than words: join across the shortest pauses.
  while (parts.length > tokens.length) {
    let shortest = 1
    for (let i = 2; i < parts.length; i++) {
      if (parts[i].start - parts[i - 1].end < parts[shortest].start - parts[shortest - 1].end) shortest = i
    }
    parts.splice(shortest - 1, 2, { start: parts[shortest - 1].start, end: parts[shortest].end })
  }

  const weights = tokens.map(weightOf)
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const before: number[] = [0]
  for (const w of weights) before.push(before[before.length - 1] + w)
  const speech = parts.map((p) => p.end - p.start)
  const totalSpeech = speech.reduce((a, b) => a + b, 0)

  // breaks[k - 1] = index of the first word of part k. Each pause goes after the word whose
  // estimated time is closest, preferring words that end with punctuation.
  const breaks: number[] = []
  let elapsed = 0
  for (let k = 1; k < parts.length; k++) {
    elapsed += speech[k - 1]
    const target = (elapsed / totalSpeech) * totalWeight
    const lo = (breaks[k - 2] ?? 0) + 1
    const hi = tokens.length - (parts.length - k)
    let best = lo
    let bestScore = Number.POSITIVE_INFINITY
    for (let b = lo; b <= hi; b++) {
      const score = Math.abs(before[b] - target) / totalWeight + (PAUSE_AFTER.test(tokens[b - 1]) ? 0 : 0.06)
      if (score < bestScore) {
        bestScore = score
        best = b
      }
    }
    breaks.push(best)
  }

  const words: Word[] = []
  const firsts = [0, ...breaks]
  const lasts = [...breaks, tokens.length]
  parts.forEach((part, k) => {
    const group = tokens.slice(firsts[k], lasts[k])
    const groupWeights = weights.slice(firsts[k], lasts[k])
    const total = groupWeights.reduce((a, b) => a + b, 0)
    const length = part.end - part.start
    let cursor = part.start
    group.forEach((token, j) => {
      const d = (groupWeights[j] / total) * length
      words.push({ text: token, start: round(cursor), end: round(cursor + d) })
      cursor += d
    })
  })
  return words
}

/** Distance from a moment to a span (0 inside it). */
function distanceTo(span: Span, time: number): number {
  return time < span.start ? span.start - time : time > span.end ? time - span.end : 0
}

function silenceAround(silences: Span[], time: number): Span | null {
  return silences.find((s) => s.start <= time && time <= s.end) ?? null
}

/**
 * Moves each sentence edge onto the nearest real pause (within `reach` seconds), then times every
 * word with timeWords(). Without silences it falls back to wordsFromSegments().
 */
export function refineTranscript(
  segments: TranscriptSegment[],
  silences: Span[],
  duration: number,
  reach = 0.6,
): { segments: TranscriptSegment[]; words: Word[] } {
  const pauses = [...silences].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  if (pauses.length === 0 || segments.length === 0) {
    return { segments, words: wordsFromSegments(segments) }
  }
  const out = segments.map((s) => ({ ...s }))
  for (let i = 0; i < out.length; i++) {
    const segment = out[i]
    const previous = out[i - 1]
    if (previous) {
      const boundary = (previous.end + segment.start) / 2
      let pick: Span | null = null
      for (const pause of pauses) {
        if (pause.end - pause.start < 0.12 || distanceTo(pause, boundary) > reach) continue
        if (!pick || distanceTo(pause, boundary) < distanceTo(pick, boundary)) pick = pause
      }
      if (pick && pick.start > previous.start + 0.1 && pick.end < segment.end - 0.1) {
        previous.end = pick.start
        segment.start = pick.end
      }
    }
    const lead = silenceAround(pauses, segment.start)
    if (lead && lead.end < segment.end - 0.1) segment.start = lead.end
  }
  for (const segment of out) {
    const tail = silenceAround(pauses, segment.end)
    if (tail && tail.start > segment.start + 0.1) segment.end = tail.start
    segment.start = round(Math.max(0, segment.start))
    segment.end = round(Math.min(duration > 0 ? duration : segment.end, segment.end))
  }
  const words = out.flatMap((segment) => timeWords(segment.text, segment, pauses))
  return { segments: out, words }
}

/** The part of a transcript between `start` and `end`, moved to start at 0 (for a Short). */
export function sliceTranscript(transcript: Transcript, start: number, end: number): Transcript {
  const shift = (t: number) => Math.round((t - start) * 1000) / 1000
  const words = transcript.words
    .filter((w) => w.start >= start - 0.05 && w.start < end)
    .map((w) => ({ text: w.text, start: Math.max(0, shift(w.start)), end: shift(Math.min(end, w.end)) }))
    .filter((w) => w.end > w.start)
  const segments = transcript.segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => ({
      text: s.text,
      start: Math.max(0, shift(Math.max(start, s.start))),
      end: shift(Math.min(end, s.end)),
    }))
    .filter((s) => s.end > s.start)
  return { duration: shift(end), words, segments }
}

/** Groups timed words into caption-sized transcript lines (a sentence, or 14 words at most). */
export function segmentsFromWords(words: Word[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: Word[] = []
  const flush = () => {
    if (current.length === 0) return
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((w) => w.text).join(' '),
    })
    current = []
  }
  for (const word of words) {
    current.push(word)
    if (/[.!?…]["')\]”’]?$/.test(word.text) || current.length >= 14) flush()
  }
  flush()
  return segments
}

/** Splits a segment's time span across its words, weighted by word length. */
export function wordsFromSegments(segments: TranscriptSegment[]): Word[] {
  const words: Word[] = []
  for (const segment of segments) {
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const span = Math.max(0.1, segment.end - segment.start)
    const weights = tokens.map((t) => t.length + 2)
    const total = weights.reduce((a, b) => a + b, 0)
    let cursor = segment.start
    tokens.forEach((text, i) => {
      const length = (weights[i] / total) * span
      words.push({ text, start: round(cursor), end: round(cursor + length) })
      cursor += length
    })
  }
  return words
}
