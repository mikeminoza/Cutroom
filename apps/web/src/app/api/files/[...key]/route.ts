// Serves local-storage files in development, with Range support so audio and video can seek.
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { guessContentType, localPath, storageDriver } from '@cutroom/shared/storage'
import { isAuthorized, isWorker } from '@/server/auth'

type Ctx = { params: Promise<{ key: string[] }> }

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  if (storageDriver() !== 'local') return new Response('Not found', { status: 404 })
  if (!isWorker(request) && !(await isAuthorized(request)))
    return new Response('Unauthorized', { status: 401 })
  const { key } = await params
  let file: string
  try {
    file = localPath(key.map(decodeURIComponent).join('/'))
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!existsSync(file)) return new Response('Not found', { status: 404 })
  const { size } = await stat(file)
  const type = guessContentType(file)
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  }
  const range = request.headers.get('range')
  const match = range?.match(/bytes=(\d*)-(\d*)/)
  if (match) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    })
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
  return new Response(stream, { headers: { ...headers, 'content-length': String(size) } })
}
