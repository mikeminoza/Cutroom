import { learnChannelStyle } from '@cutroom/shared/ai'
import { channelUploads, clientFromRefresh, explainGoogleError } from '@cutroom/shared/google'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { defaultChannel } from '@/server/connections'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { getSettings } from '@/server/settings'

// Gemini reads the channel's titles and a few thumbnails: the Hobby plan allows 300 s with Fluid
// compute.
export const maxDuration = 300

async function thumbnail(url: string | null): Promise<{ mimeType: string; data: string } | null> {
  if (!url) return null
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    return { mimeType, data: Buffer.from(await response.arrayBuffer()).toString('base64') }
  } catch {
    return null
  }
}

/**
 * "Learn from a channel": reads a channel's newest uploads through your connected YouTube account
 * and has Gemini describe its format for your own narrator. Nothing is saved: Settings shows the
 * suggestion, and "Use this style" saves it with the reference.
 */
export const POST = route(async (request) => {
  const { url } = await readJson(request, z.object({ url: z.string().trim().min(3).max(500) }))
  const channel = await defaultChannel()
  if (!channel) badRequest('Connect YouTube in Settings first: the channel is read through your account.')
  let reference: Awaited<ReturnType<typeof channelUploads>>
  try {
    reference = await channelUploads(clientFromRefresh(channel.refreshToken), url)
  } catch (error) {
    badRequest(explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error)))
  }
  if (reference.videos.length === 0) badRequest(`${reference.title || 'That channel'} has no videos yet.`)
  // Long videos show the format; Shorts only when that's all there is.
  const long = reference.videos.filter((v) => v.seconds > 90)
  const videos = long.length ? long : reference.videos
  const byViews = [...videos].sort((a, b) => b.views - a.views)

  const settings = await getSettings()
  const [narratorId] = settings.niche.characterIds
  const [narrator] = narratorId
    ? await (await db())
        .select()
        .from(schema.libraryCharacters)
        .where(inArray(schema.libraryCharacters.id, [narratorId]))
    : []
  const thumbnails = (await Promise.all(byViews.slice(0, 4).map((v) => thumbnail(v.thumbnail)))).filter(
    (t): t is { mimeType: string; data: string } => t !== null,
  )
  const suggestion = await learnChannelStyle({
    reference: { ...reference, videos },
    thumbnails,
    character: narrator ? { name: narrator.name, description: narrator.description } : null,
    audience: settings.niche.audience,
  })
  const lengths = videos.map((v) => v.seconds).sort((a, b) => a - b)
  const typical = lengths[Math.floor(lengths.length / 2)] ?? 0
  return {
    reference: {
      url,
      title: reference.title,
      titles: byViews.slice(0, 12).map((v) => ({ title: v.title, views: v.views })),
    },
    suggestion: { ...suggestion, targetMinutes: Math.min(30, Math.max(1, Math.round(typical / 60))) },
    videos: reference.videos.length,
  }
})
