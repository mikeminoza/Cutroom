// TikTok and Instagram Reels, posted by hand: the finished Short as a download named after its
// title, and where it has been posted (post.crossPosts). Cutroom never posts to those apps itself:
// no accounts, no API keys.
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { videoFileName } from '@cutroom/shared/cross-post'
import { isStoredUnder, keyOf, LOCAL_PREFIX, localPath } from '@cutroom/shared/storage'
import { type CrossPlatform, EMPTY_POST } from '@cutroom/shared/types'
import type { ProjectFull } from '@/lib/dto'
import { badRequest, notFound } from './http'
import { getProjectFull, getProjectRow, updateProject } from './projects'

/**
 * A download with the file's name, plus a plain-letter name for the few browsers that can't read
 * the other: a title in another script downloads as video.mp4 there.
 */
function attachment(name: string): string {
  const plain = /^[\w.-]+$/.test(name) ? name : 'video.mp4'
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * The finished video, sent as a download named after its title. Blob files are on another domain,
 * where browsers ignore a link's download name, so the file comes through here rather than
 * straight from storage. Only this project's own render, and only from our storage.
 */
export async function downloadVideo(projectId: string, request: Request): Promise<Response> {
  const project = await getProjectRow(projectId)
  const url = project.outputUrl
  if (!url || !isStoredUnder(url, `projects/${projectId}/renders`)) notFound('The finished video')
  const headers: Record<string, string> = {
    'content-type': 'video/mp4',
    'content-disposition': attachment(videoFileName(project.post?.title || project.title)),
    'cache-control': 'private, no-store',
  }
  if (url.startsWith(LOCAL_PREFIX)) {
    const file = localPath(keyOf(url))
    // Local storage only exists in development: keep the bundler from tracing the whole project.
    if (!existsSync(/*turbopackIgnore: true*/ file)) notFound('The finished video')
    const { size } = await stat(/*turbopackIgnore: true*/ file)
    const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream
    return new Response(stream, { headers: { ...headers, 'content-length': String(size) } })
  }
  // Streamed, never held in memory: Vercel's 4.5 MB response limit doesn't apply to a stream.
  const upstream = await fetch(url, { signal: request.signal })
  if (!upstream.ok || !upstream.body) notFound('The finished video')
  const length = upstream.headers.get('content-length')
  if (length) headers['content-length'] = length
  return new Response(upstream.body, { headers })
}

/** Whether `url` is a web link (the link to the post, copied from the app's Share button). */
function isLink(url: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Marks a Short as posted on TikTok or Reels (or not), with an optional link to the post. Marking
 * it again keeps the date it was first marked, so a link can be added later.
 */
export async function markCrossPost(
  projectId: string,
  input: { platform: CrossPlatform; posted: boolean; url?: string },
): Promise<ProjectFull> {
  const project = await getProjectRow(projectId)
  if (project.format !== 'portrait') {
    badRequest('TikTok and Reels take vertical videos: only Shorts can be marked as posted there.')
  }
  const post = { ...EMPTY_POST, ...project.post }
  const posts = { ...post.crossPosts }
  const current = posts[input.platform]
  if (input.posted) {
    const url = input.url === undefined ? (current?.url ?? null) : input.url.trim() || null
    if (url && !isLink(url))
      badRequest('That doesn’t look like a link. Copy it from the post’s Share button.')
    posts[input.platform] = { at: current?.at ?? new Date().toISOString(), url }
  } else {
    delete posts[input.platform]
  }
  await updateProject(projectId, { post: { ...post, crossPosts: posts } })
  return getProjectFull(projectId)
}
