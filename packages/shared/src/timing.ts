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
 * Splits a script into scenes without AI, one scene per paragraph: a blank line in the script
 * starts a new picture, so you decide exactly where the cuts go.
 */
export function splitByParagraphs(script: string): { start: number; end: number; narration: string }[] {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return layoutByEstimate(paragraphs.map((narration) => ({ narration })))
}

/** Seconds a stretch of narration takes to say, without the floor estimateSeconds puts on it. */
const spoken = (text: string) => countWords(text) / WORDS_PER_SECOND

/** The script's sentences, in order. */
export function sentencesOf(script: string): string[] {
  return script
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=["'“(A-Z0-9¿¡])/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Runs of about equal length, none longer than `max` seconds. */
function evenRuns(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const runs = Math.max(1, Math.ceil(words.length / Math.max(1, max * WORDS_PER_SECOND)))
  const size = Math.ceil(words.length / runs)
  return Array.from({ length: runs }, (_, i) => words.slice(i * size, (i + 1) * size).join(' ')).filter(
    Boolean,
  )
}

/**
 * Cuts a sentence that is too long for one picture where a narrator pauses: after commas,
 * semicolons, colons and dashes, then before joining words (and, but, then…). Only a stretch
 * still longer than `hard` seconds is cut evenly, into runs of about `soft`.
 */
function phrasesOf(sentence: string, soft: number, hard: number): string[] {
  if (spoken(sentence) <= soft) return [sentence]
  return sentence
    .split(/(?<=[,;:—–])\s+/)
    .flatMap((part) =>
      spoken(part) <= soft
        ? [part]
        : part
            .split(/\s+(?=(?:and|but|then|so|because|when|while|until|or)\b)/i)
            .flatMap((piece) => (spoken(piece) <= hard ? [piece] : evenRuns(piece, soft))),
    )
    .filter(Boolean)
}

/** A short exclamation or question ("Nothing!", "Wait… what?"): a beat that gets its own picture. */
const isBeat = (sentence: string) => countWords(sentence) <= 4 && /[!?…]["'”’)]*$/u.test(sentence)

/**
 * Splits a script into scenes without AI, a new picture about every `pace` seconds, following
 * the script: sentences and phrases are grouped up to about the pace, long sentences are cut at
 * their natural pauses, and a short punchline or reaction gets a quick picture of its own.
 */
export function splitBySentences(
  script: string,
  pace: number,
): { start: number; end: number; narration: string }[] {
  const groups: string[] = []
  let current: string[] = []
  let seconds = 0
  const flush = () => {
    if (current.length) groups.push(current.join(' '))
    current = []
    seconds = 0
  }
  for (const sentence of sentencesOf(script)) {
    if (isBeat(sentence)) {
      flush()
      groups.push(sentence)
      continue
    }
    for (const phrase of phrasesOf(sentence, pace * 1.3, pace * 1.8)) {
      const length = spoken(phrase)
      if (current.length > 0 && seconds + length > pace * 1.25) flush()
      current.push(phrase)
      seconds += length
    }
  }
  flush()
  // A scrap of a word or two after a cut joins the picture before it (a beat stays on its own).
  const merged: string[] = []
  for (const group of groups) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && countWords(group) <= 2 && !isBeat(group) && !isBeat(previous)) {
      merged[merged.length - 1] = `${previous} ${group}`
    } else merged.push(group)
  }
  return layoutByEstimate(merged.map((narration) => ({ narration })))
}

export interface Chapter {
  start: number
  title: string
  /** The scene (index) the chapter starts at, so its time can follow the scene when it moves. */
  scene?: number
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
    result.push({ ...chapter, start: Math.floor(chapter.start), title: chapter.title.trim() })
  }
  const last = result[result.length - 1]
  if (last && duration - last.start < 10) result.pop()
  return result.length >= 3 ? result : []
}

export function chaptersToText(chapters: Chapter[]): string {
  return chapters.map((c) => `${formatChapterTime(c.start)} ${c.title}`).join('\n')
}

/**
 * Chapters follow their scenes. Post details written before the voice-over was recorded (or before
 * the scenes were matched to it) have chapter times from estimates; this moves each chapter to its
 * scene's current start and rewrites the chapter list in the description, when that list is still
 * the one Cutroom wrote (a list you edited is left alone).
 */
export function refreshChapters<P extends { description: string; chapters: Chapter[] }>(
  post: P,
  sceneStarts: number[],
  duration: number,
): P {
  if (!post.chapters.some((c) => c.scene !== undefined)) return post
  const moved = normalizeChapters(
    post.chapters.map((c) =>
      c.scene !== undefined && sceneStarts[c.scene] !== undefined ? { ...c, start: sceneStarts[c.scene] } : c,
    ),
    duration,
  )
  const before = chaptersToText(post.chapters)
  const after = chaptersToText(moved)
  if (before === after) return post
  const description =
    before && post.description.includes(before) ? post.description.replace(before, after) : post.description
  return { ...post, chapters: moved, description }
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
