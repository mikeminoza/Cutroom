// Your own videos doing far better than usual (Ideas → Your hits). Found from the stats the daily
// refresh stores (shared/hits.ts), with no AI: the daily cron tells you about each new one once,
// and each can become follow-up ideas, the only Gemini call here, made when you ask for it.
import { followUpIdeas, hasGeminiKey } from '@cutroom/shared/ai'
import { findHits, type Hit, type HitCandidate } from '@cutroom/shared/hits'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import type { HitDTO, IdeaDTO } from '@/lib/dto'
import { listChannels } from './connections'
import { db, schema } from './db'
import type { ChannelRow, ProjectRow } from './db/schema'
import { badRequest, notFound } from './http'
import { notify } from './notify'
import { appUrl, getSettings } from './settings'

type Found = HitCandidate & Hit & { project: ProjectRow; channelRow: ChannelRow | null }

export const titleOf = (project: ProjectRow) =>
  (project.post?.title || project.title).trim() || 'Untitled video'

/**
 * Posted videos as the hit rule sees them. Only public ones: private and unlisted videos get views
 * from their link alone, so they'd pull the usual down. A video scheduled ahead counts from when
 * it went public, not from its upload.
 */
function candidates(projects: ProjectRow[], channels: ChannelRow[]) {
  return projects.flatMap((project) => {
    const stats = project.stats
    if (!stats || !project.youtubeVideoId || (project.post?.privacy ?? 'public') !== 'public') return []
    const times = [stats.publishedAt, project.scheduledAt?.toISOString()]
      .filter((t): t is string => Boolean(t))
      .map((t) => Date.parse(t))
    if (!times.length) return []
    const channelRow = resolveChannel(channels, project.channelId, project.channelYoutubeId)
    return [
      {
        id: project.id,
        // A disconnected channel's videos still compare with each other, by its YouTube id.
        channel: channelRow?.id ?? project.channelYoutubeId,
        format: project.format,
        views: stats.views,
        publishedAt: new Date(Math.max(...times)).toISOString(),
        fetchedAt: stats.fetchedAt,
        project,
        channelRow,
      },
    ]
  })
}

/** The posted videos as the hit rule sees them, with their projects (second chances use them too). */
export async function postedVideos() {
  const database = await db()
  const [projects, channels] = await Promise.all([
    database.select().from(schema.projects).where(isNotNull(schema.projects.youtubeVideoId)),
    listChannels(),
  ])
  return candidates(projects, channels)
}

async function currentHits(): Promise<Found[]> {
  return findHits(await postedVideos())
}

export async function listHits(): Promise<HitDTO[]> {
  return (await currentHits()).map((hit) => ({
    id: hit.id,
    title: titleOf(hit.project),
    format: hit.format,
    youtubeVideoId: hit.project.youtubeVideoId as string,
    channelTitle: hit.channelRow?.title ?? null,
    views: hit.views,
    usual: hit.usual,
    times: hit.times,
    peers: hit.peers,
    averageViewPercent: hit.project.stats?.averageViewPercent ?? null,
    publishedAt: hit.publishedAt,
    foundAt: hit.project.hitAt?.toISOString() ?? null,
  }))
}

const kindOf = (hit: Found) => (hit.format === 'portrait' ? 'Shorts' : 'videos')

/**
 * From the daily cron, after the stats refresh: marks the hits it hasn't seen before and sends one
 * message about them (if that's switched on in Settings). Each is marked even when no message goes
 * out, so switching it on later doesn't send a backlog. Returns a note, or null when none are new.
 */
export async function announceNewHits(baseUrl = appUrl()): Promise<string | null> {
  const database = await db()
  const fresh: Found[] = []
  for (const hit of await currentHits()) {
    if (hit.project.hitAt) continue
    // Only the run that marks it tells you, should two runs overlap.
    const marked = await database
      .update(schema.projects)
      .set({ hitAt: new Date() })
      .where(and(eq(schema.projects.id, hit.id), isNull(schema.projects.hitAt)))
      .returning({ id: schema.projects.id })
    if (marked.length) fresh.push(hit)
  }
  if (!fresh.length) return null
  const [first] = fresh
  const numbers = (hit: Found) =>
    `${hit.views.toLocaleString('en-US')} views, ${hit.times} times what your ${kindOf(hit)} usually get`
  notify({
    kind: 'hits',
    ...(fresh.length === 1
      ? {
          title: `Taking off: ${titleOf(first.project)}`,
          body: `${numbers(first)}. Follow it up while people are watching: Cutroom can turn what made it work into new ideas.`,
        }
      : {
          title: `${fresh.length} of your videos are taking off`,
          body: `${fresh.map((hit) => `"${titleOf(hit.project)}": ${numbers(hit)}`).join('\n')}\n\nFollow them up while people are watching: Cutroom can turn what made them work into new ideas.`,
        }),
    url: `${baseUrl}/ideas#hits`,
  })
  return `${fresh.length === 1 ? 'A new hit' : `${fresh.length} new hits`}: ${fresh.map((h) => `"${titleOf(h.project)}"`).join(', ')}.`
}

/**
 * Has Gemini write up to 3 follow-up ideas for one of your hits (one call), and adds them to the
 * New ideas, in the hit's series if it has one: the next episodes. Returns the ideas.
 */
export async function followUpHit(projectId: string): Promise<IdeaDTO[]> {
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to your environment to use AI features.')
  const database = await db()
  const [row] = await database.select().from(schema.projects).where(eq(schema.projects.id, projectId))
  if (!row) notFound('That video')
  const hit = (await currentHits()).find((h) => h.id === projectId)
  if (!hit) badRequest("That video isn't doing far better than usual right now.")
  const { project } = hit
  const [settings, made, planned] = await Promise.all([
    getSettings(),
    database.select({ title: schema.projects.title, topic: schema.projects.topic }).from(schema.projects),
    database.select({ title: schema.ideas.title }).from(schema.ideas),
  ])
  const ideas = await followUpIdeas({
    niche: settings.niche.description,
    narration: settings.niche.narration,
    language: project.language || settings.defaults.language,
    market: settings.niche.market,
    format: project.format,
    video: {
      title: titleOf(project),
      topic: project.topic,
      opening: project.script.trim().slice(0, 600),
      views: hit.views,
      usual: hit.usual,
      watched: project.stats?.averageViewPercent ?? null,
      searches: (project.videoInsights?.searchTerms ?? []).map((t) => t.term),
    },
    avoid: [titleOf(project), ...made.map((p) => p.title || p.topic), ...planned.map((i) => i.title)],
  })
  if (!ideas.length) return []
  const rows = await database
    .insert(schema.ideas)
    .values(
      ideas.map((idea) => ({
        id: crypto.randomUUID(),
        title: idea.title,
        angle: idea.angle,
        seriesId: project.seriesId,
        followUpOf: project.id,
      })),
    )
    .returning()
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}
