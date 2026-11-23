// Caption timing shared by the browser preview and the ffmpeg render,
// so what you see in the preview is what gets burned into the video.
import {
  type CaptionStyle,
  TRANSLATION_LANGUAGES,
  type Transcript,
  type VideoFormat,
  type Word,
} from './types'

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

/** A long-form caption line at most, in characters: YouTube's caption track uses it too. */
export const CAPTION_LINE_CHARS = 42

export function chunkCaptions(words: Word[], format: VideoFormat): CaptionChunk[] {
  const maxWords = format === 'portrait' ? 3 : 7
  const maxChars = format === 'portrait' ? 22 : CAPTION_LINE_CHARS
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

/** One caption on YouTube's caption track: when it shows, and what it says. */
export interface SrtCue {
  start: number
  end: number
  text: string
}

/** SRT file for YouTube's caption track — always the readable long-form line length. */
export function toSrt(words: Word[]): string {
  return cuesToSrt(
    chunkCaptions(words, 'landscape').map((chunk) => ({
      start: chunk.start,
      end: chunk.end,
      text: chunkText(chunk),
    })),
  )
}

export function cuesToSrt(cues: SrtCue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
    .join('\n')
}

const SRT_TIMES = /(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})/

/**
 * The cues of an SRT file, as toSrt wrote them: subtitles in another language reuse their times,
 * so they show exactly when the main captions do.
 */
export function parseSrt(srt: string): SrtCue[] {
  const seconds = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
  const cues: SrtCue[] = []
  for (const block of srt.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((line) => SRT_TIMES.test(line))
    if (at === -1) continue
    const t = SRT_TIMES.exec(lines[at])!
    const text = lines
      .slice(at + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text)
      cues.push({ start: seconds(t[1], t[2], t[3], t[4]), end: seconds(t[5], t[6], t[7], t[8]), text })
  }
  return cues
}

/**
 * A translated caption laid out like the main track's lines. Translations often run longer than
 * the original, so one that doesn't fit a caption line goes on two, broken at the space nearest
 * the middle so both are about as long. Scripts written without spaces (Japanese, Thai) stay on
 * one line: YouTube's player wraps them where they may break.
 */
export function subtitleText(text: string, max = CAPTION_LINE_CHARS): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  const middle = line.length / 2
  let split = -1
  for (let i = line.indexOf(' '); i !== -1; i = line.indexOf(' ', i + 1)) {
    if (split === -1 || Math.abs(i - middle) < Math.abs(split - middle)) split = i
  }
  return split === -1 ? line : `${line.slice(0, split)}\n${line.slice(split + 1)}`
}

/**
 * Languages a video gets subtitles in at most. Each is its own caption track, and adding one costs
 * 400 of the 10,000 YouTube API units a day that uploads need too. A video with its thumbnail,
 * captions and playlist takes about 2,100 (the upload itself about 1,600); two subtitle tracks
 * bring it to 2,900, so three videos still go out in a day with room left for replying to
 * comments. However many languages Settings lists, subtitles can't eat the day's uploads.
 */
export const SUBTITLE_LANGUAGES = 2

/**
 * The languages a video gets subtitles in: those it has a translated title in (YouTube shows those
 * viewers the title in their language already), most-watched first, the order Settings lists them
 * in, and at most SUBTITLE_LANGUAGES. Never the video's own language: the main captions are in it.
 */
export function subtitleLanguages(
  translations: { language: string; title: string }[] | undefined,
  own: string,
): string[] {
  const rank = (code: string) => {
    const i = TRANSLATION_LANGUAGES.findIndex((l) => l.code === code)
    return i === -1 ? TRANSLATION_LANGUAGES.length : i
  }
  const codes = new Set(
    (translations ?? [])
      .filter((t) => t.title.trim() && t.language && t.language !== own)
      .map((t) => t.language),
  )
  // Sorting is stable: languages Settings doesn't list keep their own order, after the rest.
  return [...codes].sort((a, b) => rank(a) - rank(b)).slice(0, SUBTITLE_LANGUAGES)
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
