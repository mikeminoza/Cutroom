import { generateIdeas } from '@cutroom/shared/ai'
import { desc } from 'drizzle-orm'
import { z } from 'zod'
import type { IdeaDTO } from '@/lib/dto'
import { topTitles } from '@/server/analytics'
import { db, schema } from '@/server/db'
import { newId, notFound, readJson, route } from '@/server/http'
import { getSeries } from '@/server/series'
import { getSettings } from '@/server/settings'

export const maxDuration = 60

async function listIdeas(): Promise<IdeaDTO[]> {
  const database = await db()
  const rows = await database.select().from(schema.ideas).orderBy(desc(schema.ideas.createdAt))
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

export const GET = route(async () => listIdeas())

/** Asks Gemini for new ideas and adds them to the backlog. */
export const POST = route(async (request) => {
  const body = await readJson(
    request,
    z.object({
      niche: z.string().max(500).default(''),
      seriesId: z.string().max(100).nullable().default(null),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
      count: z.number().int().min(1).max(20).default(8),
      direction: z.string().max(1000).default(''),
    }),
  )
  const series = body.seriesId ? await getSeries(body.seriesId) : null
  if (body.seriesId && !series) notFound('That series')
  const database = await db()
  const [projects, ideas, settings] = await Promise.all([
    database.select({ title: schema.projects.title, topic: schema.projects.topic }).from(schema.projects),
    database.select({ title: schema.ideas.title }).from(schema.ideas),
    getSettings(),
  ])
  const template = series?.template
  // Without a series, ideas fit the channel's niche from Settings.
  const channel = series ? null : settings.niche
  const generated = await generateIdeas({
    niche: [
      body.niche || channel?.description || '',
      channel?.narration ? `Narration: ${channel.narration}` : '',
      series ? `${series.name}${series.description ? `: ${series.description}` : ''}` : '',
    ]
      .filter(Boolean)
      .join('. '),
    audience: template?.audience ?? channel?.audience ?? '',
    tone: template?.tone ?? channel?.tone ?? '',
    language: template?.language ?? settings.defaults.language,
    format: template?.format ?? body.format,
    count: body.count,
    direction: body.direction,
    avoid: [...projects.map((p) => p.title || p.topic), ...ideas.map((i) => i.title)],
    topTitles: await topTitles(template?.channelId ?? null, template?.channelYoutubeId ?? null),
  })
  if (generated.length) {
    await database.insert(schema.ideas).values(
      generated.map((idea) => ({
        id: newId(),
        title: idea.title,
        angle: idea.angle,
        seriesId: series?.id ?? null,
      })),
    )
  }
  return listIdeas()
})
