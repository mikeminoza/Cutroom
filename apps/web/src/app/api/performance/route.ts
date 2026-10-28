import { desc, isNotNull } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import type { PerformanceDTO } from '@/lib/dto'
import { refreshStats } from '@/server/analytics'
import { postDueComments } from '@/server/comments'
import { connectionSummaries } from '@/server/connections'
import { db, schema } from '@/server/db'
import { route } from '@/server/http'

export const maxDuration = 60

async function performance(notes: string[] = []): Promise<PerformanceDTO> {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.projects)
    .where(isNotNull(schema.projects.youtubeVideoId))
    .orderBy(desc(schema.projects.scheduledAt))
  const { channels } = await connectionSummaries()
  return {
    videos: rows.map((r) => ({
      id: r.id,
      title: r.post?.title || r.title,
      format: r.format,
      youtubeVideoId: r.youtubeVideoId as string,
      channelId: resolveChannel(channels, r.channelId, r.channelYoutubeId)?.id ?? null,
      seriesId: r.seriesId,
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      stats: r.stats ?? null,
      insights: r.videoInsights ?? null,
      duration: r.voiceoverDuration,
    })),
    channels,
    notes,
  }
}

export const GET = route(async () => performance())

/** Fetches fresh numbers from YouTube. */
export const POST = route(async () => {
  const summary = await refreshStats({ force: true })
  const posted = await postDueComments().catch((error) => [String(error)])
  return performance([...summary.notes, ...posted])
})
