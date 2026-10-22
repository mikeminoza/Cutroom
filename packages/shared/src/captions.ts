// Caption timing shared by the browser preview and the ffmpeg render,
// so what you see in the preview is what gets burned into the video.
import type { CaptionStyle, Transcript, VideoFormat, Word } from './types'

export interface CaptionChunk {
  start: number
  end: number
  words: Word[]
}

/** Spreads each scene's narration across its time span, weighted by word length. */
export function wordsFromScenes(scenes: { start: number; end: number; narration: string }[]): Word[] {
  const words: Word[] = []
  for (const scene of scenes) {
    const tokens = scene.narration.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const span = Math.max(0.2, scene.end - scene.start)
    const weights = tokens.map((t) => t.length + 2)
    const total = weights.reduce((a, b) => a + b, 0)
    let cursor = scene.start
    tokens.forEach((text, i) => {
      const length = (weights[i] / total) * span
      words.push({ text, start: cursor, end: cursor + length })
      cursor += length
    })
  }
  return words
}

/** Real word timings when a voice-over transcript exists, estimates otherwise. */
export function captionWords(
  transcript: Transcript | null | undefined,
  scenes: { start: number; end: number; narration: string }[],
): Word[] {
  if (transcript?.words?.length) return transcript.words
  return wordsFromScenes(scenes)
}

const SENTENCE_END = /[.!?…]["')\]]?$/
const CLAUSE_END = /[,;:—–]["')\]]?$/

/**
 * Groups words into on-screen captions. Shorts get short punchy chunks,
 * long-form gets a readable line. Breaks early at sentence ends and pauses.
 */
/**
 * Stretches of speech: words with less than `gap` seconds between them run together. A layered
 * scene's character bounces through these and stays still (breathing) in the pauses.
 */
export function speechSpans(words: Word[], gap = 0.25): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    if (!(word.end > word.start)) continue
    const last = spans[spans.length - 1]
    if (last && word.start - last.end < gap) last.end = Math.max(last.end, word.end)
    else spans.push({ start: word.start, end: word.end })
  }
  return spans
}

export function chunkCaptions(words: Word[], format: VideoFormat): CaptionChunk[] {
  const maxWords = format === 'portrait' ? 3 : 7
  const maxChars = format === 'portrait' ? 22 : 42
  const chunks: CaptionChunk[] = []
  let current: Word[] = []

  const flush = () => {
    if (current.length === 0) return
    chunks.push({ start: current[0].start, end: current[current.length - 1].end, words: current })
    current = []
  }

  words.forEach((word, i) => {
    const next = words[i + 1]
    const length = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length
    if (current.length >= maxWords || (current.length > 0 && length > maxChars)) flush()
    current.push(word)
    const pause = next ? next.start - word.end : 0
    if (SENTENCE_END.test(word.text) || pause > 0.6) flush()
    else if (CLAUSE_END.test(word.text) && current.length >= 2) flush()
  })
  flush()

  // Close small gaps so captions don't flicker between words.
  for (let i = 0; i < chunks.length - 1; i++) {
    const gap = chunks[i + 1].start - chunks[i].end
    if (gap > 0 && gap < 0.35) chunks[i].end = chunks[i + 1].start
  }
  return chunks
}

export function activeChunk(chunks: CaptionChunk[], time: number): CaptionChunk | null {
  let lo = 0
  let hi = chunks.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const chunk = chunks[mid]
    if (time < chunk.start) hi = mid - 1
    else if (time >= chunk.end) lo = mid + 1
    else return chunk
  }
  return null
}

export function chunkText(chunk: CaptionChunk): string {
  return chunk.words.map((w) => w.text).join(' ')
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`
}

/** SRT file for YouTube's caption track — always the readable long-form line length. */
export function toSrt(words: Word[]): string {
  return chunkCaptions(words, 'landscape')
    .map((chunk, i) => `${i + 1}\n${srtTime(chunk.start)} --> ${srtTime(chunk.end)}\n${chunkText(chunk)}\n`)
    .join('\n')
}

export function captionsEnabled(style: CaptionStyle): boolean {
  return style !== 'off'
}

export interface Overlay {
  start: number
  end: number
  text: string
}

/** On-screen text fades in and out over this long (shorter overlays just appear). */
export const OVERLAY_FADE_SECONDS = 0.2

/**
 * Each scene's on-screen text, shown for the scene's whole time on screen as the video lays it out:
 * the first scene from 0, every scene until the next one starts, the last until the end.
 * `scenes` must be in playing order.
 */
export function overlayEvents(
  scenes: { start: number; onScreenText: string }[],
  duration: number,
): Overlay[] {
  const result: Overlay[] = []
  scenes.forEach((scene, i) => {
    const text = scene.onScreenText.replace(/\s+/g, ' ').trim()
    if (!text) return
    const start = i === 0 ? 0 : Math.max(0, scene.start)
    const end = i === scenes.length - 1 ? duration : Math.min(duration, scenes[i + 1].start)
    if (end - start >= 0.1) result.push({ start, end, text })
  })
  return result
}

/** 0..1 visibility of an overlay at `time` (fades at both ends). */
export function overlayOpacity(overlay: Overlay, time: number): number {
  if (time < overlay.start || time >= overlay.end) return 0
  const fade = overlay.end - overlay.start >= OVERLAY_FADE_SECONDS * 3 ? OVERLAY_FADE_SECONDS : 0
  if (fade === 0) return 1
  return Math.min(1, (time - overlay.start) / fade, (overlay.end - time) / fade)
}
