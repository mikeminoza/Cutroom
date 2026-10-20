// ElevenLabs text-to-speech (paid). Its "with timestamps" endpoint returns the time of every
// character, which gives exact word timing for captions with no transcription step.
// Server-side only: the API key never reaches the browser.
import type { Word } from './types'

const API = 'https://api.elevenlabs.io'

export function hasElevenLabsKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY)
}

export function elevenLabsModel(): string {
  return process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'
}

function key(): string {
  const value = process.env.ELEVENLABS_API_KEY
  if (!value) throw new Error('Add ELEVENLABS_API_KEY to use ElevenLabs voices.')
  return value
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    detail?: string | { message?: string } | { msg?: string }[]
  } | null
  const detail = body?.detail
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail
            .map((d) => d.msg)
            .filter(Boolean)
            .join('; ')
        : detail?.message
  if (res.status === 401) return 'ElevenLabs did not accept the API key (ELEVENLABS_API_KEY).'
  return `ElevenLabs answered HTTP ${res.status}${message ? `: ${message}` : ''}`
}

export interface ElevenVoice {
  id: string
  name: string
  description: string
}

export async function elevenLabsVoices(): Promise<ElevenVoice[]> {
  const res = await fetch(`${API}/v1/voices`, {
    headers: { 'xi-api-key': key() },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(await errorText(res))
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[]
  }
  return (data.voices ?? [])
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      description: [
        v.labels?.gender,
        v.labels?.accent,
        v.labels?.description ?? v.labels?.descriptive,
        v.category,
      ]
        .filter(Boolean)
        .join(', '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/** Characters with times -> words with times (whitespace separates words). */
export function wordsFromAlignment(alignment: Alignment | null | undefined): Word[] {
  if (!alignment) return []
  const words: Word[] = []
  let text = ''
  let start = 0
  let end = 0
  const flush = () => {
    if (text) words.push({ text, start, end })
    text = ''
  }
  alignment.characters.forEach((char, i) => {
    if (/\s/.test(char)) {
      flush()
      return
    }
    if (!text) start = alignment.character_start_times_seconds[i] ?? end
    text += char
    end = alignment.character_end_times_seconds[i] ?? start
  })
  flush()
  return words
}

/** Waits `ms`, or stops early (rejecting) when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

/** One request never waits longer than this, even when the caller passes its own stop signal. */
export const ELEVENLABS_TIMEOUT_MS = 180_000
const ATTEMPTS = 4

/**
 * Reads `text` as MP3 with word times (seconds from the start of this audio). `previousText` and
 * `nextText` keep the delivery continuous when a long script is read in parts. Rate limits, server
 * errors, network failures and timeouts are retried; `signal` stops everything at once.
 */
export async function elevenLabsSpeech(
  text: string,
  options: { voiceId: string; previousText?: string; nextText?: string; signal?: AbortSignal },
): Promise<{ audio: Buffer; words: Word[] }> {
  const url = `${API}/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=mp3_44100_128`
  const body = JSON.stringify({
    text,
    model_id: elevenLabsModel(),
    ...(options.previousText ? { previous_text: options.previousText.slice(-1000) } : {}),
    ...(options.nextText ? { next_text: options.nextText.slice(0, 1000) } : {}),
  })
  let lastError = ''
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const timeout = AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key(), 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal,
      })
    } catch (error) {
      // Stopped by the caller: give up now. A timeout or a dropped connection: try again.
      if (options.signal?.aborted) throw error
      lastError = timeout.aborted
        ? `ElevenLabs did not answer within ${ELEVENLABS_TIMEOUT_MS / 1000} seconds.`
        : `Could not reach ElevenLabs: ${error instanceof Error ? error.message : String(error)}`
      if (attempt < ATTEMPTS - 1) await sleep(2000 * 2 ** attempt, options.signal)
      continue
    }
    if (res.ok) {
      const data = (await res.json()) as { audio_base64?: string; alignment?: Alignment | null }
      if (!data.audio_base64) throw new Error('ElevenLabs returned no audio.')
      return { audio: Buffer.from(data.audio_base64, 'base64'), words: wordsFromAlignment(data.alignment) }
    }
    lastError = await errorText(res)
    if (res.status !== 429 && res.status < 500) break
    if (attempt < ATTEMPTS - 1) await sleep(2000 * 2 ** attempt, options.signal)
  }
  throw new Error(lastError)
}
