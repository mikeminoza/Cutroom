// File storage for working files (avatars, voice-overs, scene images, thumbnails).
// Local disk in development, Vercel Blob in production (when BLOB_READ_WRITE_TOKEN is set).
// URLs stored in the database are either absolute Blob URLs or app-relative
// "/api/files/<key>" paths served by the web app in development.
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { del, put } from '@vercel/blob'

export type StorageDriver = 'local' | 'blob'

export function storageDriver(): StorageDriver {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local'
}

let cachedRoot: string | null = null

/** Repository root, found by walking up to pnpm-workspace.yaml. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRoot = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  cachedRoot = process.cwd()
  return cachedRoot
}

export function localRoot(): string {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.join(repoRoot(), '.data', 'storage')
}

export const LOCAL_PREFIX = '/api/files/'

/** Resolves a storage key to a path inside the local root, refusing traversal. */
export function localPath(key: string): string {
  const root = localRoot()
  const resolved = path.resolve(root, key)
  if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid file key')
  return resolved
}

export function safeName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
  return base.replace(/^-|-$/g, '').slice(-80) || 'file'
}

export function makeKey(folder: string, filename: string): string {
  const id = Math.random().toString(36).slice(2, 10)
  return `${folder}/${id}-${safeName(filename)}`
}

export interface StoredFile {
  key: string
  url: string
}

export async function putFile(
  key: string,
  body: Buffer | Readable | ReadableStream<Uint8Array>,
  contentType: string,
): Promise<StoredFile> {
  if (storageDriver() === 'blob') {
    const blob = await put(key, body as any, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: !Buffer.isBuffer(body),
    })
    return { key: blob.pathname, url: blob.url }
  }
  const target = localPath(key)
  await mkdir(path.dirname(target), { recursive: true })
  if (Buffer.isBuffer(body)) await writeFile(target, body)
  else {
    const source = body instanceof Readable ? body : Readable.fromWeb(body as any)
    await pipeline(source, createWriteStream(target))
  }
  return { key, url: `${LOCAL_PREFIX}${key}` }
}

export async function putLocalFile(key: string, filePath: string, contentType: string): Promise<StoredFile> {
  return putFile(key, createReadStream(filePath), contentType)
}

export async function deleteFile(url: string | null | undefined): Promise<void> {
  if (!url) return
  try {
    if (url.startsWith(LOCAL_PREFIX)) await rm(localPath(url.slice(LOCAL_PREFIX.length)), { force: true })
    else if (/^https?:\/\//.test(url) && process.env.BLOB_READ_WRITE_TOKEN) await del(url)
  } catch {
    // Deleting is best-effort; a leftover file is harmless.
  }
}

/** Absolute URL for a stored file, given the web app's base URL. */
export function absoluteUrl(url: string, appUrl: string): string {
  return /^https?:\/\//.test(url) ? url : new URL(url, appUrl).toString()
}

/** Downloads a stored file to disk. Reads local files directly when possible. */
export async function downloadTo(url: string, destination: string, appUrl: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  if (url.startsWith(LOCAL_PREFIX)) {
    const local = localPath(url.slice(LOCAL_PREFIX.length))
    if (existsSync(local)) {
      await pipeline(createReadStream(local), createWriteStream(destination))
      return
    }
  }
  const response = await fetch(absoluteUrl(url, appUrl))
  if (!response.ok || !response.body) throw new Error(`Could not download ${url} (HTTP ${response.status})`)
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(destination))
}

export async function fileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size
}

export function guessContentType(name: string): string {
  const ext = path.extname(name).toLowerCase()
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.mp4': 'video/mp4',
    '.srt': 'application/x-subrip',
    '.json': 'application/json',
  }
  return types[ext] ?? 'application/octet-stream'
}
