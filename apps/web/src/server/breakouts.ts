// Videos breaking out in the niche. Once a week (from the daily cron) and on "Search now", the
// default channel's connection searches YouTube for recent videos matching the niche, and keeps
// the ones with far more views than their channel usually gets (shared/breakouts.ts). Each can
// become an idea for this channel, then a draft like any other idea.
import { breakoutQueries, hasGeminiKey, ideaFromBreakout } from '@cutroom/shared/ai'
import { pickBreakouts } from '@cutroom/shared/breakouts'
import {
  clientFromRefresh,
  explainGoogleError,
  type FoundVideo,
  searchRecentVideos,
} from '@cutroom/shared/google'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { BreakoutDTO } from '@/lib/dto'
import { defaultChannel, listChannels } from './connections'
import { db, schema } from './db'
import { badRequest, notFound } from './http'
import { getSettings, saveSettings } from './settings'

/** The search runs again after this long. */
const EVERY_MS = 7 * 86_400_000
/** Videos published this recently count. */
const LOOK_BACK_MS = 30 * 86_400_000
/** Breakouts left untouched this long are cleared away. */
const KEEP_MS = 60 * 86_400_000

type BreakoutRow = typeof schema.breakouts.$inferSelect

function toDTO(row: BreakoutRow): BreakoutDTO {
  return {
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    foundAt: row.foundAt.toISOString(),
  }
}

export async function listBreakouts(): Promise<BreakoutDTO[]> {
  const database = await db()
  const rows = await database.select().from(schema.breakouts).orderBy(desc(schema.breakouts.score))
  return rows.map(toDTO)
}

/**
 * What to search for: the saved searches, or (the first time) ones Gemini writes from the niche,
 * or the default tags. Gemini's are saved, so they show on the page and can be changed.
 */
async function queriesToUse(): Promise<string[]> {
  const settings = await getSettings()
  if (settings.breakouts.queries.length) return settings.breakouts.queries
  const niche = settings.niche.description.trim()
  if (niche && hasGeminiKey()) {
    const queries = await breakoutQueries({
      niche,
      audience: settings.niche.audience,
      market: settings.niche.market,
    })
    if (queries.length) {
      await saveSettings({ ...settings, breakouts: { ...settings.breakouts, queries } })
      return queries
    }
  }
  return settings.defaults.tags.slice(0, 3)
}

/**
 * Searches YouTube now (about 300 of the channel's 10,000 daily quota units) and keeps the
 * breakouts: new ones are added, ones found before get their new numbers and keep their status.
 * Returns how many are new.
 */
export async function scanBreakouts(): Promise<number> {
  const channel = await defaultChannel()
  if (!channel) badRequest('Connect YouTube in Settings to search for breakout videos.')
  const queries = await queriesToUse()
  if (queries.length === 0) {
    badRequest('Add what to search YouTube for, or describe your channel niche in Settings.')
  }
  const settings = await getSettings()
  const client = clientFromRefresh(channel.refreshToken)
  const found: (FoundVideo & { query: string })[] = []
  for (const query of queries) {
    try {
      const videos = await searchRecentVideos(client, query, {
        after: new Date(Date.now() - LOOK_BACK_MS),
        regionCode: settings.niche.market || undefined,
        language: settings.defaults.language.split('-')[0] || undefined,
      })
      found.push(...videos.map((v) => ({ ...v, query })))
    } catch (error) {
      badRequest(explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error)))
    }
  }
  const own = (await listChannels()).map((c) => c.youtubeId).filter((id): id is string => Boolean(id))
  const picked = pickBreakouts(found, own)

  const database = await db()
  const known = new Set(
    (await database.select({ id: schema.breakouts.id }).from(schema.breakouts)).map((r) => r.id),
  )
  let added = 0
  for (const video of picked) {
    // The columns hold whole numbers up to about 2 billion.
    const whole = (n: number) => Math.min(2_000_000_000, Math.round(n))
    const numbers = {
      views: whole(video.views),
      channelAverage: whole(video.channelAverage),
      score: video.score,
    }
    if (known.has(video.id)) {
      await database.update(schema.breakouts).set(numbers).where(eq(schema.breakouts.id, video.id))
      continue
    }
    await database.insert(schema.breakouts).values({
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      youtubeChannelId: video.channelId,
      seconds: video.seconds,
      thumbnailUrl: video.thumbnail,
      publishedAt: video.publishedAt ? new Date(video.publishedAt) : null,
      query: video.query,
      ...numbers,
    })
    added++
  }
  await database
    .delete(schema.breakouts)
    .where(
      and(eq(schema.breakouts.status, 'new'), lt(schema.breakouts.foundAt, new Date(Date.now() - KEEP_MS))),
    )
  const latest = await getSettings()
  await saveSettings({
    ...latest,
    breakouts: {
      queries: latest.breakouts.queries.length ? latest.breakouts.queries : queries,
      scannedAt: new Date().toISOString(),
    },
  })
  return added
}

/** The weekly search, from the daily cron. Returns a note, or null when it wasn't due. */
export async function scanDueBreakouts(): Promise<string | null> {
  const settings = await getSettings()
  const last = settings.breakouts.scannedAt ? Date.parse(settings.breakouts.scannedAt) : 0
  if (Date.now() - last < EVERY_MS) return null
  if (!(await defaultChannel())) return null
  // Nothing to search for yet: wait until the niche or the searches are set.
  if (
    !settings.breakouts.queries.length &&
    !settings.niche.description.trim() &&
    !settings.defaults.tags.length
  )
    return null
  try {
    const added = await scanBreakouts()
    return added ? `Found ${added} new ${added === 1 ? 'video' : 'videos'} breaking out in your niche.` : null
  } catch (error) {
    return `Breakout search: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Makes an idea for this channel from a breakout: Gemini takes what makes people click it and
 * makes it the channel's own (without Gemini, the idea keeps the video's title as a starting
 * point). The idea joins the New ideas; returns its id.
 */
export async function ideaFromBreakoutRow(id: string): Promise<string> {
  const database = await db()
  const [row] = await database.select().from(schema.breakouts).where(eq(schema.breakouts.id, id))
  if (!row) notFound('That video')
  if (row.ideaId) return row.ideaId
  const settings = await getSettings()
  const usual = Math.max(1, row.channelAverage)
  const idea = hasGeminiKey()
    ? await ideaFromBreakout({
        niche: settings.niche.description,
        narration: settings.niche.narration,
        language: settings.defaults.language,
        market: settings.niche.market,
        video: { title: row.title, channel: row.channelTitle, views: row.views, usual },
      })
    : {
        title: row.title,
        angle: `Your take on "${row.title}" by ${row.channelTitle}, which got ${row.views.toLocaleString('en-US')} views on a channel that usually gets ${usual.toLocaleString('en-US')}.`,
      }
  const ideaId = crypto.randomUUID()
  await database.insert(schema.ideas).values({ id: ideaId, title: idea.title, angle: idea.angle })
  await database.update(schema.breakouts).set({ status: 'used', ideaId }).where(eq(schema.breakouts.id, id))
  return ideaId
}

export async function setBreakoutStatus(id: string, status: 'new' | 'dismissed'): Promise<void> {
  const database = await db()
  const [row] = await database.select().from(schema.breakouts).where(eq(schema.breakouts.id, id))
  if (!row) notFound('That video')
  await database.update(schema.breakouts).set({ status }).where(eq(schema.breakouts.id, id))
}
