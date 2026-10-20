// Thin wrappers around the ffmpeg / ffprobe binaries: spawning (never through a shell),
// progress parsing, abort handling and the few probes the renderer needs.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

/** A failed ffmpeg/ffprobe run. `stderr` holds the tail of the tool's error output. */
export class FfmpegError extends Error {
  readonly exitCode: number | null
  readonly stderr: string

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message)
    this.name = 'FfmpegError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

/** Same shape as the DOMException fetch() throws on abort: `error.name === 'AbortError'`. */
export function abortError(signal?: AbortSignal): Error {
  const error = new Error('Render aborted', { cause: signal?.reason })
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

const STDERR_TAIL_BYTES = 16 * 1024

/** Node reports a bad cwd as ENOENT too, which would otherwise read as "ffmpeg is not installed". */
function spawnErrorMessage(bin: string, error: NodeJS.ErrnoException, cwd?: string): string {
  if (error.code !== 'ENOENT') return `Could not start ${bin}: ${error.message}`
  if (cwd && !existsSync(cwd)) return `Could not start ${bin}: working directory ${cwd} does not exist`
  if (cwd && process.platform === 'win32' && cwd.length > 240) {
    return `Could not start ${bin}: working directory path is too long for Windows (${cwd.length} chars): ${cwd}`
  }
  return `${bin} was not found. Install ffmpeg or set FFMPEG_PATH / FFPROBE_PATH.`
}

interface SpawnOptions {
  cwd?: string
  signal?: AbortSignal
  /** Called with each complete stdout line (used for `-progress pipe:1`). */
  onLine?: (line: string) => void
  /** Keep the whole stdout (ffprobe JSON). */
  collectStdout?: boolean
  /** Keep the whole log instead of its tail (filters like silencedetect report there). */
  collectStderr?: boolean
}

const STDERR_MAX_BYTES = 8 * 1024 * 1024

function runTool(
  bin: string,
  args: string[],
  options: SpawnOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { signal } = options
  if (signal?.aborted) return Promise.reject(abortError(signal))

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let pending = ''
    let stderrTail = ''
    let stderrAll = ''
    let aborted = false
    let settled = false

    const onAbort = () => {
      aborted = true
      // The output is useless once aborted, so don't let ffmpeg finalize it.
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({ stdout, stderr: options.collectStderr ? stderrAll : stderrTail })
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (options.collectStdout) stdout += chunk
      if (!options.onLine) return
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) options.onLine(line.trimEnd())
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail += chunk
      if (stderrTail.length > STDERR_TAIL_BYTES) stderrTail = stderrTail.slice(-STDERR_TAIL_BYTES)
      if (options.collectStderr && stderrAll.length < STDERR_MAX_BYTES) stderrAll += chunk
    })

    // A failed spawn on Windows also errors the stdio pipes (ENOTCONN); unhandled, that would
    // crash the process. The real cause arrives on the child's 'error' event below.
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        aborted ? abortError(signal) : new FfmpegError(spawnErrorMessage(bin, error, options.cwd), null, ''),
      )
    })

    child.on('close', (code) => {
      if (pending && options.onLine) options.onLine(pending.trimEnd())
      if (aborted) return finish(abortError(signal))
      if (code === 0) return finish(null)
      const lines = stderrTail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const summary = lines.slice(-8).join('\n') || 'no error output'
      finish(new FfmpegError(`${bin} exited with code ${code}:\n${summary}`, code, stderrTail))
    })
  })
}

export interface FfmpegRunOptions {
  /** Working directory. Filters that take file names (ass=, subtitles=) should use names relative to it. */
  cwd?: string
  signal?: AbortSignal
  /** Expected output length in seconds; turns ffmpeg's out_time into a 0..1 fraction. */
  duration?: number
  onProgress?: (fraction: number) => void
}

/** Parses one `-progress` line. Returns output time in seconds, 'end', or null. */
export function parseProgressLine(line: string): number | 'end' | null {
  const eq = line.indexOf('=')
  if (eq < 0) return null
  const key = line.slice(0, eq).trim()
  const value = line.slice(eq + 1).trim()
  if (key === 'progress') return value === 'end' ? 'end' : null
  // out_time_ms is microseconds too (a long-standing ffmpeg quirk).
  if (key === 'out_time_us' || key === 'out_time_ms') {
    const us = Number(value)
    return Number.isFinite(us) && us >= 0 ? us / 1_000_000 : null
  }
  return null
}

/** Runs ffmpeg with `args` (inputs/filters/outputs). Adds quiet logging, overwrite and progress flags. */
export async function runFfmpeg(args: string[], options: FfmpegRunOptions = {}): Promise<void> {
  const { duration, onProgress } = options
  const base = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error']
  const progress = onProgress ? ['-nostats', '-progress', 'pipe:1'] : ['-nostats']
  let last = -1
  await runTool(ffmpegPath(), [...base, ...progress, ...args], {
    cwd: options.cwd,
    signal: options.signal,
    onLine: onProgress
      ? (line) => {
          const parsed = parseProgressLine(line)
          if (parsed === null) return
          const fraction =
            parsed === 'end' ? 1 : duration && duration > 0 ? Math.min(1, Math.max(0, parsed / duration)) : 0
          if (fraction > last) {
            last = fraction
            onProgress(fraction)
          }
        }
      : undefined,
  })
}

export async function runFfprobe(args: string[], options: { cwd?: string; signal?: AbortSignal } = {}) {
  const { stdout } = await runTool(ffprobePath(), ['-hide_banner', '-v', 'error', ...args], {
    ...options,
    collectStdout: true,
  })
  return stdout
}

/** Container duration in seconds. */
export async function probeDuration(path: string, signal?: AbortSignal): Promise<number> {
  const out = await runFfprobe(
    ['-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { signal },
  )
  const seconds = Number.parseFloat(out.trim())
  if (!Number.isFinite(seconds)) throw new FfmpegError(`Could not read the duration of ${path}`, null, out)
  return seconds
}

/** Display size of an image (or a video's first stream), with 90°/270° rotation applied. */
export async function probeImageSize(
  path: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  const out = await runFfprobe(
    [
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:stream_side_data=rotation',
      '-of',
      'json',
      path,
    ],
    { signal },
  )
  const stream = JSON.parse(out).streams?.[0] as
    | { width?: number; height?: number; side_data_list?: { rotation?: number }[] }
    | undefined
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  if (!(width > 0 && height > 0)) throw new FfmpegError(`${path} is not a readable image`, null, out)
  const rotation = stream?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? 0
  return Math.abs(rotation) % 180 === 90 ? { width: height, height: width } : { width, height }
}

/** Stream summary, e.g. [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', ... }]. */
export async function probeStreams(
  path: string,
  signal?: AbortSignal,
): Promise<{ codec_type: string; codec_name: string; duration?: string }[]> {
  const out = await runFfprobe(
    ['-show_entries', 'stream=codec_type,codec_name,duration', '-of', 'json', path],
    {
      signal,
    },
  )
  return JSON.parse(out).streams ?? []
}

/** CPU limit from the cgroup (containers like Render report the host's cores to os.*). */
function cgroupCpuLimit(): number | null {
  if (process.platform !== 'linux') return null
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/)
    if (quota !== 'max' && Number(period) > 0) return Number(quota) / Number(period)
  } catch {}
  try {
    const quota = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'))
    const period = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'))
    if (quota > 0 && period > 0) return quota / period
  } catch {}
  return null
}

let cachedThreads: number | null = null

/**
 * Encoder/filter thread count. FFMPEG_THREADS overrides. Otherwise the usable cores, capped at 4:
 * more x264 threads mostly add memory (each frame thread holds its own buffers), which matters
 * far more than speed on a 512 MB instance.
 */
export function defaultThreads(): number {
  const fromEnv = Number(process.env.FFMPEG_THREADS)
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv
  if (cachedThreads !== null) return cachedThreads
  let cores = availableParallelism()
  const limit = cgroupCpuLimit()
  if (limit !== null) cores = Math.min(cores, Math.max(1, Math.ceil(limit)))
  cachedThreads = Math.max(1, Math.min(cores, 4))
  return cachedThreads
}

/**
 * Runs ffmpeg at info log level and returns its whole log, for analysis filters that report there
 * (silencedetect, volumedetect). `args` are the inputs, filters and output (usually `-f null -`).
 */
export async function ffmpegLog(args: string[], signal?: AbortSignal): Promise<string> {
  const { stderr } = await runTool(
    ffmpegPath(),
    ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info', ...args],
    { signal, collectStderr: true },
  )
  return stderr
}
