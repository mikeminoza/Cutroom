// How posted videos are doing: views, likes and comments from the YouTube Data API, plus watch
// time, retention and the searches that found them from YouTube Analytics when the channel granted
// that permission. Refreshed by the daily cron and the Refresh button on the Performance page.
import {
  AnalyticsUnavailable,
  clientFromRefresh,
  explainGoogleError,
  hasAnalyticsScope,
  type VideoAnalytics,
  videoAnalytics,
  videoRetention,
  videoSearchTerms,
  videoStatistics,
} from '@cutroom/shared/google'
import { retentionLesson, topSearchTerms } from '@cutroom/shared/retention'
import type { VideoFormat, VideoInsights, VideoStats } from '@cutroom/shared/types'
import { asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import { listChannels } from './connections'
import { db, schema } from './db'
import type { ChannelRow, ProjectRow } from './db/schema'
import { getSettings } from './settings'

/** Stats younger than this are not fetched again by the daily refresh. */
const FRESH_MS = 6 * 60 * 60 * 1000

async function postedProjects(): Promise<ProjectRow[]> {
  const database = await db()
  return database.select().from(schema.projects).where(isNotNull(schema.projects.youtubeVideoId))
}

/** Each project's channel, resolved the way publishing resolves it. */
const channelOf = (channels: ChannelRow[], project: ProjectRow) =>
  resolveChannel(channels, project.channelId, project.channelYoutubeId)

export interface RefreshSummary {
  checked: number
  updated: number
  notes: string[]
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

const day = (iso: string) => iso.slice(0, 10)

/** The refresh stops starting new videos after this, so it fits in a 60-second serverless call. */
const DEADLINE_MS = 45_000

const fetchedAt = (project: ProjectRow) => (project.stats ? Date.parse(project.stats.fetchedAt) || 0 : 0)

export async function refreshStats(
  options: { force?: boolean; deadlineMs?: number } = {},
): Promise<RefreshSummary> {
  const deadline = Date.now() + (options.deadlineMs ?? DEADLINE_MS)
  const [projects, channels] = await Promise.all([postedProjects(), listChannels()])
  const now = Date.now()
  // Stalest first, so videos left over when time runs out are first in line next time.
  const due = projects
    .filter((p) => options.force || !p.stats || now - fetchedAt(p) > FRESH_MS)
    .sort((a, b) => fetchedAt(a) - fetchedAt(b))
  const notes: string[] = []
  const groups = new Map<string, { channel: ChannelRow; projects: ProjectRow[] }>()
  for (const project of due) {
    // Videos on a disconnected channel keep their last numbers until it is reconnected.
    const channel = channelOf(channels, project)
    if (!channel) continue
    const group = groups.get(channel.id) ?? { channel, projects: [] }
    group.projects.push(project)
    groups.set(channel.id, group)
  }
  if (due.length && groups.size === 0)
    notes.push('Connect YouTube in Settings to see how your videos are doing.')

  const database = await db()
  let updated = 0
  let outOfTime = false
  for (const { channel, projects: list } of groups.values()) {
    if (Date.now() > deadline) {
      outOfTime = true
      break
    }
    const client = clientFromRefresh(channel.refreshToken)
    let counters: Awaited<ReturnType<typeof videoStatistics>>
    try {
      counters = await videoStatistics(
        client,
        list.map((p) => p.youtubeVideoId as string),
      )
    } catch (error) {
      notes.push(
        `${channel.title}: ${explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error))}`,
      )
      continue
    }
    const withAnalytics = hasAnalyticsScope(channel.scope)
    if (!withAnalytics)
      notes.push(`${channel.title}: reconnect it in Settings to also see watch time and retention.`)
    let unavailable: string | null = null
    await mapLimit(list, 3, async (project) => {
      const id = project.youtubeVideoId as string
      const c = counters.get(id)
      if (!c) return
      if (Date.now() > deadline) {
        outOfTime = true
        return
      }
      let a: VideoAnalytics | null = null
      let insights: VideoInsights | null = project.videoInsights ?? null
      if (withAnalytics && !unavailable && c.privacy !== 'private' && c.publishedAt) {
        const range = [day(c.publishedAt), day(new Date().toISOString())] as const
        try {
          a = await videoAnalytics(client, id, ...range)
          // Each part keeps its last value when YouTube can't give it this time.
          const [curve, terms] = await Promise.all([
            videoRetention(client, id, ...range).catch(() => undefined),
            videoSearchTerms(client, id, ...range).catch(() => undefined),
          ])
          insights = {
            retention: curve === undefined ? (insights?.retention ?? null) : (curve?.retention ?? null),
            relative: curve === undefined ? (insights?.relative ?? null) : (curve?.relative ?? null),
            searchTerms: terms ?? insights?.searchTerms ?? [],
            fetchedAt: new Date().toISOString(),
          }
        } catch (error) {
          if (error instanceof AnalyticsUnavailable) unavailable = error.message
        }
      }
      const stats: VideoStats = {
        views: c.views,
        likes: c.likes,
        comments: c.comments,
        watchMinutes: a?.watchMinutes ?? project.stats?.watchMinutes ?? null,
        averageViewSeconds: a?.averageViewSeconds ?? project.stats?.averageViewSeconds ?? null,
        averageViewPercent: a?.averageViewPercent ?? project.stats?.averageViewPercent ?? null,
        subscribersGained: a?.subscribersGained ?? project.stats?.subscribersGained ?? null,
        publishedAt: c.publishedAt,
        fetchedAt: new Date().toISOString(),
      }
      // Saved one by one, so a timeout keeps what was already fetched. Not through updateProject:
      // stats refreshing must not bump "Edited …" on the dashboard.
      await database
        .update(schema.projects)
        .set({ stats, videoInsights: insights })
        .where(eq(schema.projects.id, project.id))
      updated++
    })
    if (unavailable) {
      notes.push(
        `${channel.title}: watch time is unavailable (${unavailable}). Turn on the YouTube Analytics API in Google Cloud.`,
      )
    }
  }
  if (outOfTime) notes.push('Some videos were left for the next refresh, to finish in time.')
  return { checked: due.length, updated, notes: [...new Set(notes)] }
}

/** The channel's most-watched titles, for the post-details prompt. */
export async function topTitles(
  channelId: string | null,
  youtubeId: string | null,
  limit = 5,
): Promise<{ title: string; views: number }[]> {
  const [projects, channels, settings] = await Promise.all([postedProjects(), listChannels(), getSettings()])
  const target = resolveChannel(channels, channelId, youtubeId)?.id ?? null
  const own = projects
    .filter((p) => p.stats && p.stats.views > 0 && (channelOf(channels, p)?.id ?? null) === target)
    .sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
    .slice(0, limit)
    .map((p) => ({ title: (p.post?.title || p.title).trim(), views: p.stats?.views ?? 0 }))
    .filter((t) => t.title)
  // A new channel learns from the channel whose style it follows until it has hits of its own.
  if (own.length >= 3) return own
  return [...own, ...(settings.niche.reference?.titles ?? [])].slice(0, limit)
}

/** The posted videos of one channel (resolved like publishing does), newest first. */
async function channelVideos(channelId: string | null, youtubeId: string | null): Promise<ProjectRow[]> {
  const [projects, channels] = await Promise.all([postedProjects(), listChannels()])
  const target = resolveChannel(channels, channelId, youtubeId)?.id ?? null
  const published = (p: ProjectRow) => p.stats?.publishedAt ?? p.scheduledAt?.toISOString() ?? ''
  return projects
    .filter((p) => (channelOf(channels, p)?.id ?? null) === target)
    .sort((a, b) => published(b).localeCompare(published(a)))
}

/** The YouTube searches that bring viewers to a channel's videos, added up, most views first. */
export async function searchTermsFor(
  channelId: string | null,
  youtubeId: string | null,
  limit = 15,
): Promise<{ term: string; views: number }[]> {
  const videos = await channelVideos(channelId, youtubeId)
  return topSearchTerms(
    videos.map((p) => p.videoInsights?.searchTerms ?? []),
    limit,
  )
}

/**
 * Where a channel's latest videos of this format lost viewers, one line each (see
 * retentionLesson), for the script writer.
 */
export async function retentionLessons(
  channelId: string | null,
  youtubeId: string | null,
  format: VideoFormat,
  limit = 3,
): Promise<string[]> {
  const videos = (await channelVideos(channelId, youtubeId))
    .filter((p) => p.format === format && p.videoInsights?.retention?.length)
    .slice(0, limit)
  if (videos.length === 0) return []
  const database = await db()
  const scenes = await database
    .select()
    .from(schema.scenes)
    .where(
      inArray(
        schema.scenes.projectId,
        videos.map((p) => p.id),
      ),
    )
    .orderBy(asc(schema.scenes.index))
  return videos.flatMap((p) => {
    const own = scenes.filter((s) => s.projectId === p.id)
    const duration = p.voiceoverDuration ?? Math.max(0, ...own.map((s) => s.end))
    if (!(duration > 0)) return []
    return [
      retentionLesson({
        title: p.post?.title || p.title,
        duration,
        retention: p.videoInsights?.retention ?? [],
        scenes: own,
      }),
    ]
  })
}
