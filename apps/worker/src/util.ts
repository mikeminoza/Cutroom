import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { explainGoogleError } from '@cutroom/shared/google'

export async function makeWorkDir(jobId: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `cutroom-${jobId.slice(0, 8)}-`))
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

/** Media duration in seconds via ffprobe. */
export function probeSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const value = Number.parseFloat(out.trim())
      if (code === 0 && Number.isFinite(value)) resolve(value)
      else reject(new Error(`ffprobe could not read ${path.basename(filePath)}: ${err.slice(-200)}`))
    })
  })
}

/** File extension from a URL or path, without query string. Falls back to `fallback`. */
export function extensionOf(url: string, fallback: string): string {
  const clean = url.split('?')[0]
  const ext = path.extname(clean).toLowerCase()
  return ext && ext.length <= 6 ? ext : fallback
}

export function audioMime(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.m4a': 'audio/aac',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
  }
  return map[ext] ?? 'audio/mp3'
}

export function imageMime(ext: string): string {
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

/** Calls fn at most once per `ms`, always letting the final call through via flush(). */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0
  let pending: A | null = null
  const run = (...args: A) => {
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      pending = null
      fn(...args)
    } else pending = args
  }
  run.flush = () => {
    if (pending) fn(...pending)
    pending = null
  }
  return run
}

export function errorMessage(error: unknown): string {
  const explained = explainGoogleError(error)
  if (explained) return explained
  if (error instanceof Error) {
    const google = (error as { errors?: { message?: string }[] }).errors?.[0]?.message
    return google ? `${error.message} (${google})` : error.message
  }
  return String(error)
}
