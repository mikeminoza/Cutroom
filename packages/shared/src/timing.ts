// Time helpers. Every timestamp in the system is seconds as a float.

/** 75.4 -> "1:15.4", 3725 -> "1:02:05.0" */
export function formatTimecode(seconds: number, withTenths = true): string {
  const safe = Math.max(0, seconds || 0)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const sec = withTenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** YouTube chapter style: "0:00", "1:05", "1:02:05" */
export function formatChapterTime(seconds: number): string {
  return formatTimecode(Math.floor(seconds), false)
}

/** Accepts "75", "1:15", "1:15.4", "0:01:15.4". Returns null when unreadable. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export const WORDS_PER_SECOND = 2.5

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Rough narration length before a voice-over exists. */
export function estimateSeconds(text: string): number {
  return Math.max(1.5, countWords(text) / WORDS_PER_SECOND)
}

/**
 * Lays scenes end to end using estimated narration length.
 * Used right after the script is split, before the voice-over re-times them.
 */
export function layoutByEstimate<T extends { narration: string }>(
  scenes: T[],
): (T & { start: number; end: number })[] {
  let cursor = 0
  return scenes.map((scene) => {
    const length = Math.round(estimateSeconds(scene.narration) * 10) / 10
    const placed = { ...scene, start: cursor, end: cursor + length }
    cursor += length
    return placed
  })
}

/**
 * Splits a script into scenes without AI: sentences are grouped until a scene
 * reaches roughly `pace` seconds of narration.
 */
export function splitBySentences(
  script: string,
  pace: number,
): { start: number; end: number; narration: string }[] {
  const sentences = script
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=["'“(A-Z0-9¿¡])/u)
    .map((s) => s.trim())
    .filter(Boolean)
  const groups: string[] = []
  let current: string[] = []
  let seconds = 0
  for (const sentence of sentences) {
    const length = estimateSeconds(sentence)
    if (current.length > 0 && seconds + length > pace * 1.25) {
      groups.push(current.join(' '))
      current = []
      seconds = 0
    }
    current.push(sentence)
    seconds += length
  }
  if (current.length) groups.push(current.join(' '))
  return layoutByEstimate(groups.map((narration) => ({ narration })))
}

export interface Chapter {
  start: number
  title: string
}

/**
 * Makes a chapter list YouTube accepts: first chapter at 0:00, at least three,
 * each at least 10 seconds long. Returns [] when the video cannot satisfy that.
 */
export function normalizeChapters(chapters: Chapter[], duration: number): Chapter[] {
  if (duration < 30) return []
  const sorted = [...chapters]
    .filter((c) => c.title.trim() && c.start >= 0 && c.start < duration)
    .sort((a, b) => a.start - b.start)
  if (sorted.length === 0) return []
  sorted[0] = { ...sorted[0], start: 0 }
  const result: Chapter[] = []
  for (const chapter of sorted) {
    const previous = result[result.length - 1]
    if (previous && chapter.start - previous.start < 10) continue
    result.push({ start: Math.floor(chapter.start), title: chapter.title.trim() })
  }
  const last = result[result.length - 1]
  if (last && duration - last.start < 10) result.pop()
  return result.length >= 3 ? result : []
}

export function chaptersToText(chapters: Chapter[]): string {
  return chapters.map((c) => `${formatChapterTime(c.start)} ${c.title}`).join('\n')
}

export function totalDuration(scenes: { end: number }[]): number {
  return scenes.reduce((max, s) => Math.max(max, s.end), 0)
}

/** YouTube accepts Shorts up to three minutes long. */
export const SHORT_MAX_SECONDS = 180

/**
 * The stretch of a video that scenes `from`..`to` (positions in playing order) cover, as the video
 * lays them out: from where the first starts (0 for the very first) to where the next one starts
 * (the end of the video for the last).
 */
export function sceneRange(
  scenes: { start: number }[],
  from: number,
  to: number,
  duration: number,
): { start: number; end: number } {
  const start = from <= 0 ? 0 : scenes[from].start
  const end = to >= scenes.length - 1 ? duration : scenes[to + 1].start
  return { start, end: Math.max(start, end) }
}
