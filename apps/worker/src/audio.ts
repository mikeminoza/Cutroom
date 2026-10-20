// Audio helpers for the voice-over jobs: finding the pauses in a recording, and turning generated
// speech (WAV, raw PCM or MP3 chunks) into one MP3 voice-over.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Span } from '@cutroom/shared/align'
import { ffmpegLog, probeDuration, runFfmpeg } from './render/ffmpeg'

/** Pauses shorter than this are the gaps inside words (stop consonants), not pauses. */
const MIN_PAUSE = 0.15

export function parseVolume(log: string): { mean: number | null; max: number | null } {
  const read = (name: string) => {
    const match = new RegExp(`${name}:\\s*(-?[\\d.]+|-inf) dB`).exec(log)
    if (!match) return null
    return match[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number(match[1])
  }
  return { mean: read('mean_volume'), max: read('max_volume') }
}

/** silencedetect's log lines -> sorted, non-overlapping spans. An unfinished silence runs to the end. */
export function parseSilences(log: string, duration: number): Span[] {
  const spans: Span[] = []
  let open: number | null = null
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (start) {
      open = Math.max(0, Number(start[1]))
      continue
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (end && open !== null) {
      spans.push({ start: open, end: Number(end[1]) })
      open = null
    }
  }
  if (open !== null && duration > open) spans.push({ start: open, end: duration })
  return spans
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start)
}

/**
 * The pauses in a recording. The silence threshold follows the recording's own loudness, so a
 * quiet home recording and a loud studio read both work: 16 dB under the average level.
 */
export async function detectSilences(path: string, duration: number, signal?: AbortSignal): Promise<Span[]> {
  const volume = parseVolume(
    await ffmpegLog(['-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], signal),
  )
  const mean = volume.mean !== null && Number.isFinite(volume.mean) ? volume.mean : -24
  const noise = Math.min(-26, Math.max(-60, Math.round(mean - 16)))
  const log = await ffmpegLog(
    ['-i', path, '-vn', '-af', `silencedetect=noise=${noise}dB:d=${MIN_PAUSE}`, '-f', 'null', '-'],
    signal,
  )
  return parseSilences(log, duration)
}

function isWav(data: Buffer) {
  return (
    data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE'
  )
}

/**
 * An ID3 tag, or an MP3 frame header: the sync bits, then Layer III (what speech services send),
 * a legal version, and a bitrate and sample rate that are neither "free" nor reserved.
 */
export function isMp3(data: Buffer) {
  if (data.length > 3 && data.toString('ascii', 0, 3) === 'ID3') return true
  if (data.length < 4 || data[0] !== 0xff || (data[1] & 0xe0) !== 0xe0) return false
  const version = (data[1] >> 3) & 0b11
  const layer = (data[1] >> 1) & 0b11
  const bitrate = data[2] >> 4
  const rate = (data[2] >> 2) & 0b11
  return version !== 0b01 && layer === 0b01 && bitrate !== 0 && bitrate !== 0b1111 && rate !== 0b11
}

/** Raw 16-bit PCM, as Gemini labels it ("audio/L16;codec=pcm;rate=24000"). */
const isRawPcm = (mimeType: string) => /\bL16\b|codec=pcm|audio\/pcm/i.test(mimeType)

/**
 * Writes one piece of generated speech as a mono 44.1 kHz WAV. Gemini returns a WAV file or raw
 * 16-bit PCM ("audio/L16;codec=pcm;rate=24000"); ElevenLabs returns MP3.
 */
export async function speechToWav(
  audio: { data: Buffer; mimeType: string },
  workDir: string,
  name: string,
  signal?: AbortSignal,
): Promise<{ path: string; duration: number }> {
  const out = join(workDir, `${name}.wav`)
  // Raw PCM can start with any bytes, including ones that look like an MP3 frame, so the label
  // decides first; the bytes are only checked when the label says WAV, MP3 or nothing useful.
  if (!isRawPcm(audio.mimeType) && (isWav(audio.data) || isMp3(audio.data))) {
    const source = join(workDir, `${name}-source${isWav(audio.data) ? '.wav' : '.mp3'}`)
    await writeFile(source, audio.data)
    await runFfmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], { signal })
  } else {
    const rate = Number(/rate=(\d+)/i.exec(audio.mimeType)?.[1] ?? 24000)
    const source = join(workDir, `${name}-source.pcm`)
    await writeFile(source, audio.data)
    await runFfmpeg(
      [
        '-f',
        's16le',
        '-ar',
        String(rate),
        '-ac',
        '1',
        '-i',
        source,
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        out,
      ],
      { signal },
    )
  }
  return { path: out, duration: await probeDuration(out, signal) }
}

/** Joins speech files with `gap` seconds of silence between them into one MP3. */
export async function joinSpeech(
  files: string[],
  gap: number,
  out: string,
  signal?: AbortSignal,
): Promise<number> {
  if (files.length === 0) throw new Error('There is no speech to join.')
  const inputs = files.flatMap((f) => ['-i', f])
  const parts: string[] = []
  const labels: string[] = []
  files.forEach((_, i) => {
    parts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[s${i}]`)
    labels.push(`[s${i}]`)
    if (i < files.length - 1 && gap > 0) {
      parts.push(`aevalsrc=0:s=44100:d=${gap},aformat=sample_fmts=fltp:channel_layouts=mono[g${i}]`)
      labels.push(`[g${i}]`)
    }
  })
  parts.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`)
  await runFfmpeg(
    [
      ...inputs,
      '-filter_complex',
      parts.join(';'),
      '-map',
      '[out]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '1',
      out,
    ],
    { signal },
  )
  return probeDuration(out, signal)
}
