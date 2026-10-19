// Matches the script's scenes to the words actually spoken in the voice-over,
// so each scene starts exactly when its narration starts.
import type { TranscriptSegment, Word } from './types'

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
