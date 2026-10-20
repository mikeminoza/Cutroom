// File storage for working files (avatars, voice-overs, scene images, thumbnails).
// Local disk in development, Vercel Blob in production (when a Blob store is connected:
// BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID for stores that authenticate with Vercel OIDC).
// URLs stored in the database are either absolute Blob URLs or app-relative
// "/api/files/<key>" paths served by the web app in development.
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { copy, del, put } from '@vercel/blob'

export type StorageDriver = 'local' | 'blob'

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
}

export function storageDriver(): StorageDriver {
  return blobConfigured() ? 'blob' : 'local'
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
  // Keys are plain relative paths. '..' or '.' segments could point at another project's files
  // even while staying inside the storage root, so they are refused outright.
  if (!isPlainKey(key)) throw new Error('Invalid file key')
  const root = localRoot()
  const resolved = path.resolve(root, key)
  if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid file key')
  return resolved
}

/** A relative key made of ordinary segments: no '..', '.', empty segments or backslashes. */
export function isPlainKey(key: string): boolean {
  if (!key || key.includes('\\') || key.includes('\0')) return false
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
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
    else if (/^https?:\/\//.test(url) && blobConfigured()) await del(url)
  } catch {
    // Deleting is best-effort; a leftover file is harmless.
  }
}

/** The storage key of a stored file's URL (the part after the Blob host, or after /api/files/). */
export function keyOf(url: string): string {
  try {
    if (url.startsWith(LOCAL_PREFIX)) return decodeURIComponent(url.slice(LOCAL_PREFIX.length))
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  } catch {
    // A malformed %-escape or URL: not a key anything can match.
    return ''
  }
}

/**
 * True when `url` is a file this app stored, inside `folder`: a local /api/files/ URL in
 * development, or a URL on a Vercel Blob store when Blob is the storage. Keys with '..' and URLs
 * on other hosts are refused, so a URL can't pass as one project's file while naming another's.
 */
export function isStoredUnder(url: string, folder: string): boolean {
  const prefix = `${folder.replace(/\/+$/, '')}/`
  if (url.startsWith(LOCAL_PREFIX)) {
    const key = keyOf(url)
    return isPlainKey(key) && key.startsWith(prefix)
  }
  if (storageDriver() !== 'blob') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.blob.vercel-storage.com')) return false
  const key = keyOf(url)
  return isPlainKey(key) && key.startsWith(prefix)
}

/**
 * Copies a stored file into `folder` (a new key), so two owners never share one file: posting a
 * video deletes its working files, which must not take a series' or the library's copy with it.
 */
export async function copyStoredFile(url: string, folder: string): Promise<StoredFile> {
  const name = keyOf(url).split('/').pop() ?? 'file'
  // Keys end in "<random>-<name>"; keep the readable part.
  const key = makeKey(folder, name.replace(/^[a-z0-9]{8}-/, ''))
  if (url.startsWith(LOCAL_PREFIX)) {
    const source = localPath(keyOf(url))
    const target = localPath(key)
    await mkdir(path.dirname(target), { recursive: true })
    // Local storage only exists in development: keep the bundler from tracing the whole project.
    await pipeline(createReadStream(/*turbopackIgnore: true*/ source), createWriteStream(target))
    return { key, url: `${LOCAL_PREFIX}${key}` }
  }
  if (storageDriver() === 'blob') {
    const blob = await copy(url, key, { access: 'public', addRandomSuffix: false, allowOverwrite: true })
    return { key: blob.pathname, url: blob.url }
  }
  // An absolute URL while storing locally: fetch it.
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not copy ${url} (HTTP ${response.status})`)
  return putFile(
    key,
    Buffer.from(await response.arrayBuffer()),
    response.headers.get('content-type') ?? guessContentType(name),
  )
}

/** Reads a stored file into memory (reference images for image generation). */
export async function readStoredFile(
  url: string,
  appUrl: string,
): Promise<{ data: Buffer; contentType: string }> {
  if (url.startsWith(LOCAL_PREFIX)) {
    const local = localPath(keyOf(url))
    // Local storage only exists in development: keep the bundler from tracing the whole project.
    if (existsSync(/*turbopackIgnore: true*/ local)) {
      return { data: await readFile(/*turbopackIgnore: true*/ local), contentType: guessContentType(local) }
    }
  }
  const response = await fetch(absoluteUrl(url, appUrl), { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Could not read ${url} (HTTP ${response.status})`)
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')?.split(';')[0] || guessContentType(url),
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
