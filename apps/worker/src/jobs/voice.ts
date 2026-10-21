// The AI voice-over: reads the script aloud (Gemini or ElevenLabs), saves it as the project's
// voice-over, then lines the scenes up with it. The text of every part is known exactly, so the
// timing needs no transcription: ElevenLabs reports each word's time, and for Gemini the pauses
// inside each part place the words.
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { AiError, synthesizeSpeech } from '@cutroom/shared/ai'
import { type Span, segmentsFromWords, timeWords } from '@cutroom/shared/align'
import { elevenLabsSpeech } from '@cutroom/shared/elevenlabs'
import type { JobPayload, SpokenSpan } from '@cutroom/shared/protocol'
import { deleteFile, downloadTo, makeKey, putLocalFile } from '@cutroom/shared/storage'
import { formatTimecode } from '@cutroom/shared/timing'
import { DEFAULT_VOICE, type Word } from '@cutroom/shared/types'
import { detectSilences, joinSpeech, speechToWav } from '../audio'
import { runFfmpeg, throwIfAborted } from '../render/ffmpeg'
import { errorMessage } from '../util'
import type { JobContext } from './context'
import { matchScenes } from './match'

/** Silence between parts, which are cut at scene and sentence boundaries. */
export const PART_GAP = 0.35
/** Characters per request: short enough to stay reliable, long enough to sound continuous. */
const MAX_CHARS = { gemini: 1500, elevenlabs: 2500 } as const

/** What gets read: the scenes' narration when there are scenes, otherwise the script's paragraphs. */
export function textToRead(payload: Pick<JobPayload, 'scenes' | 'project'>): string[] {
  const narrations = [...payload.scenes]
    .sort((a, b) => a.index - b.index)
    .map((s) => s.narration.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (narrations.length) return narrations
  return payload.project.script
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Groups pieces into parts of at most `max` characters, splitting long pieces at sentences. */
export function chunkText(pieces: string[], max: number): string[] {
  const units: string[] = []
  for (const piece of pieces) {
    if (piece.length <= max) {
      units.push(piece)
      continue
    }
    for (const sentence of piece.split(/(?<=[.!?…])\s+/)) {
      if (sentence.length <= max) {
        units.push(sentence)
        continue
      }
      // A single sentence longer than a part: cut between words.
      let current = ''
      for (const word of sentence.split(' ')) {
        if (current && current.length + word.length + 1 > max) {
          units.push(current)
          current = ''
        }
        current = current ? `${current} ${word}` : word
      }
      if (current) units.push(current)
    }
  }
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > max) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current} ${unit}` : unit
  }
  if (current) chunks.push(current)
  return chunks
}

export async function runVoice(payload: JobPayload, ctx: JobContext): Promise<void> {
  const { project } = payload
  const voice = project.voice ?? payload.settings.voice ?? DEFAULT_VOICE
  const provider = voice.provider === 'elevenlabs' ? 'ElevenLabs' : 'Gemini'
  const output = path.join(ctx.workDir, 'voiceover.mp3')

  if (!ctx.finished('synthesize')) {
    const chunks = chunkText(textToRead(payload), MAX_CHARS[voice.provider])
    if (chunks.length === 0) throw new Error('Write the script, or split it into scenes, first.')
    await ctx.step('synthesize', 'running', `${provider} is reading the script`)
    // Parts recorded by an earlier try of this job, reused while their text is unchanged.
    const parts = [...(ctx.data.voiceParts ?? [])]
    const files: string[] = []
    const spans: SpokenSpan[] = []
    const words: Word[] = []
    let offset = 0
    for (const [i, chunk] of chunks.entries()) {
      throwIfAborted(ctx.signal)
      const name = `part-${String(i + 1).padStart(3, '0')}`
      const kept = parts[i]?.text === chunk ? parts[i] : null
      let part: NonNullable<typeof kept>
      let file: string
      if (kept) {
        ctx.progress(
          'synthesize',
          i / chunks.length,
          `Part ${i + 1} of ${chunks.length} was already recorded`,
        )
        file = path.join(ctx.workDir, `${name}.mp3`)
        await downloadTo(kept.url, file, payload.appUrl)
        part = kept
      } else {
        ctx.progress('synthesize', i / chunks.length, `Recording part ${i + 1} of ${chunks.length}`)
        let audio: { data: Buffer; mimeType: string }
        let partWords: Word[] = []
        if (voice.provider === 'elevenlabs') {
          const speech = await elevenLabsSpeech(chunk, {
            voiceId: voice.voice,
            previousText: chunks[i - 1],
            nextText: chunks[i + 1],
            signal: ctx.signal,
          })
          audio = { data: speech.audio, mimeType: 'audio/mpeg' }
          partWords = speech.words
        } else {
          audio = await patiently(
            () => synthesizeSpeech(chunk, { voice: voice.voice, style: voice.style, signal: ctx.signal }),
            ctx.signal,
            (wait) =>
              ctx.progress(
                'synthesize',
                i / chunks.length,
                `Waiting ${wait} s for Gemini's free per-minute limit (part ${i + 1} of ${chunks.length})`,
              ),
          )
        }
        const wav = await speechToWav(audio, ctx.workDir, name, ctx.signal)
        file = wav.path
        // Keep the part, so a retry after a failure later on doesn't record it again.
        const mp3 = path.join(ctx.workDir, `${name}.mp3`)
        await runFfmpeg(['-i', wav.path, '-c:a', 'libmp3lame', '-b:a', '128k', mp3], { signal: ctx.signal })
        const stored = await putLocalFile(
          makeKey(`projects/${project.id}/voiceover/parts`, `${name}.mp3`),
          mp3,
          'audio/mpeg',
        )
        await deleteFile(parts[i]?.url)
        part = { text: chunk, url: stored.url, key: stored.key, duration: wav.duration, words: partWords }
        parts[i] = part
        await ctx.result({ voiceParts: parts.slice(0, chunks.length) })
      }
      files.push(file)
      spans.push({ text: chunk, start: round(offset), end: round(offset + part.duration) })
      for (const w of part.words) {
        words.push({ text: w.text, start: round(w.start + offset), end: round(w.end + offset) })
      }
      offset += part.duration + PART_GAP
    }
    ctx.progress('synthesize', 0.97, 'Joining the parts')
    const duration = await joinSpeech(files, PART_GAP, output, ctx.signal)
    const stored = await putLocalFile(
      makeKey(`projects/${project.id}/voiceover`, 'ai-voiceover.mp3'),
      output,
      'audio/mpeg',
    )
    await ctx.result({
      voiceover: {
        url: stored.url,
        key: stored.key,
        name: `AI voice-over (${provider}, ${voice.provider === 'gemini' ? voice.voice : 'ElevenLabs voice'}).mp3`,
        duration,
      },
      voiceSpans: spans,
      voiceWords: voice.provider === 'elevenlabs' ? words : [],
    })
    // The joined voice-over is saved: the separate parts are no longer needed.
    await Promise.all(parts.map((p) => deleteFile(p?.url)))
    await ctx.result({ voiceParts: [] })
    await ctx.step('synthesize', 'done', `${formatTimecode(duration, false)} recorded with ${provider}`)
  }

  await ctx.step('align', 'running', 'Timing every word')
  const recorded = ctx.data.voiceover
  if (!recorded) throw new Error('The voice-over was not saved. Generate it again.')
  let words = ctx.data.voiceWords ?? []
  if (words.length === 0) {
    // Gemini: place each part's words around the pauses inside it.
    let silences: Span[] = []
    try {
      if (!(await exists(output))) await downloadTo(recorded.url, output, payload.appUrl)
      silences = await detectSilences(output, recorded.duration, ctx.signal)
    } catch (error) {
      if (ctx.signal.aborted) throw error
      console.warn(`[${ctx.jobId}] pause detection failed, spreading words evenly:`, errorMessage(error))
    }
    words = (ctx.data.voiceSpans ?? []).flatMap((span) => timeWords(span.text, span, silences))
  }
  if (words.length === 0) throw new Error('No words could be timed in the voice-over.')
  const transcript = { duration: recorded.duration, segments: segmentsFromWords(words), words }
  await ctx.result({ transcript })
  await matchScenes(payload, ctx, transcript)
}

/** How long to wait out Gemini's per-minute limit, and how many times. */
const RATE_WAIT_SECONDS = 65
const RATE_WAITS = 5

/**
 * Runs a request, waiting out Gemini's free per-minute limit instead of failing: the worker has
 * time to spare. The daily limit is not waited out; it says to upload a recording instead.
 */
export async function patiently<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  onWait: (seconds: number) => void,
  seconds = RATE_WAIT_SECONDS,
): Promise<T> {
  for (let waits = 0; ; waits++) {
    try {
      return await run()
    } catch (error) {
      if (error instanceof AiError && error.code === 'daily_limit') {
        throw new Error(
          `${error.message} Upload your own recording on the Voice-over step, or retry tomorrow: the parts recorded so far are kept.`,
        )
      }
      if (!(error instanceof AiError) || error.code !== 'rate_limited' || waits >= RATE_WAITS) throw error
      onWait(seconds)
      await wait(seconds * 1000, undefined, { signal })
    }
  }
}

async function exists(file: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises')
  return stat(file).then(
    (s) => s.size > 0,
    () => false,
  )
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
