// What viewers say: the comments on each channel's newest videos, read from YouTube and summed up
// by Gemini into what they liked, what they asked for and what to do better. Read from the
// Performance page, and once a week per channel by the daily cron. Reading comments uses the
// youtube.force-ssl permission the channel already granted, and 1 quota unit per video.
import { hasGeminiKey, summarizeComments } from '@cutroom/shared/ai'
import { clientFromRefresh, explainGoogleError, videoComments } from '@cutroom/shared/google'
import type { CommentInsights } from '@cutroom/shared/types'
import { desc, isNotNull } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import type { CommentInsightsDTO } from '@/lib/dto'
import { listChannels } from './connections'
import { db, schema } from './db'
import type { ChannelRow, ProjectRow } from './db/schema'
import { badRequest, notFound } from './http'

/** The newest videos read, and comments per video: a few hundred comments, one Gemini call. */
const VIDEOS = 10
const PER_VIDEO = 50
/** The cron reads a channel's comments again after this. */
export const INSIGHTS_EVERY_MS = 7 * 24 * 60 * 60 * 1000

const NO_COMMENTS: CommentInsights = {
  summary: 'No comments on the newest videos yet.',
  liked: [],
  requests: [],
  improve: [],
  questions: [],
}

type InsightRow = typeof schema.commentInsights.$inferSelect

const toDTO = (row: InsightRow): CommentInsightsDTO => ({
  channelId: row.channelId,
  insights: row.insights,
  videos: row.videos,
  comments: row.comments,
  updatedAt: row.updatedAt.toISOString(),
})

export async function listInsights(): Promise<CommentInsightsDTO[]> {
  const database = await db()
  const rows = await database.select().from(schema.commentInsights)
  return rows.map(toDTO)
}

/** Each channel's posted videos, newest first. */
async function postedByChannel(channels: ChannelRow[]): Promise<Map<string, ProjectRow[]>> {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.projects)
    .where(isNotNull(schema.projects.youtubeVideoId))
    .orderBy(desc(schema.projects.scheduledAt))
  const byChannel = new Map<string, ProjectRow[]>()
  for (const row of rows) {
    const channel = resolveChannel(channels, row.channelId, row.channelYoutubeId)
    if (channel) byChannel.set(channel.id, [...(byChannel.get(channel.id) ?? []), row])
  }
  return byChannel
}

/** Reads the comments on a channel's newest videos and asks Gemini what they say. */
export async function readComments(channelId: string): Promise<CommentInsightsDTO> {
  const channels = await listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) notFound('That channel')
  // Videos known to have no comments are skipped; ones not counted yet are read.
  const recent = ((await postedByChannel(channels)).get(channel.id) ?? [])
    .filter((p) => (p.stats?.comments ?? 1) > 0)
    .slice(0, VIDEOS)
  const client = clientFromRefresh(channel.refreshToken)
  const videos: { title: string; comments: { text: string; likes: number }[] }[] = []
  try {
    for (let i = 0; i < recent.length; i += 3) {
      const batch = await Promise.all(
        recent.slice(i, i + 3).map(async (p) => ({
          title: p.post?.title || p.title,
          comments: await videoComments(client, p.youtubeVideoId as string, PER_VIDEO),
        })),
      )
      videos.push(...batch)
    }
  } catch (error) {
    badRequest(
      `${channel.title}: ${explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error))}`,
    )
  }
  const comments = videos.reduce((n, v) => n + v.comments.length, 0)
  const insights = comments > 0 ? await summarizeComments({ channel: channel.title, videos }) : NO_COMMENTS
  const values = { channelId: channel.id, insights, videos: videos.length, comments, updatedAt: new Date() }
  const database = await db()
  const [row] = await database
    .insert(schema.commentInsights)
    .values(values)
    .onConflictDoUpdate({ target: schema.commentInsights.channelId, set: values })
    .returning()
  return toDTO(row)
}

/**
 * For the daily cron: reads the comments of the one channel read longest ago, once a week per
 * channel. Returns a note when it read or failed, null when nothing was due.
 */
export async function readDueComments(): Promise<string | null> {
  if (!hasGeminiKey()) return null
  const channels = await listChannels()
  const posted = await postedByChannel(channels)
  const read = await listInsights()
  const due = channels
    .filter((c) => (posted.get(c.id)?.length ?? 0) > 0)
    .map((channel) => {
      const last = read.find((r) => r.channelId === channel.id)
      return { channel, at: last ? Date.parse(last.updatedAt) : 0 }
    })
    .filter(({ at }) => Date.now() - at > INSIGHTS_EVERY_MS)
    .sort((a, b) => a.at - b.at)[0]
  if (!due) return null
  try {
    await readComments(due.channel.id)
    return `Read the comments on ${due.channel.title}.`
  } catch (error) {
    return `${due.channel.title}: comments not read (${error instanceof Error ? error.message : String(error)}).`
  }
}
