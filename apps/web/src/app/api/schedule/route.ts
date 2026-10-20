import { upcomingSlots } from '@cutroom/shared/schedule'
import { desc, isNotNull } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import { listChannels } from '@/server/connections'
import { db, schema } from '@/server/db'
import { route } from '@/server/http'
import { getSettings } from '@/server/settings'

interface ScheduleProject {
  id: string
  title: string
  status: string
  format: string
  youtubeVideoId: string | null
}

export interface ScheduleEntry {
  at: string
  /** The channel this slot belongs to; null when no channel is connected. */
  channelId: string | null
  project: ScheduleProject | null
}

/**
 * The next four weeks of posting slots, per channel (each channel posts on the same weekly
 * slots, and only its own videos take them), plus videos booked at a custom time.
 */
export const GET = route(async () => {
  const [settings, channels] = await Promise.all([getSettings(), listChannels()])
  const database = await db()
  const rows = await database
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      format: schema.projects.format,
      youtubeVideoId: schema.projects.youtubeVideoId,
      scheduledAt: schema.projects.scheduledAt,
      channelId: schema.projects.channelId,
      channelYoutubeId: schema.projects.channelYoutubeId,
    })
    .from(schema.projects)
    .where(isNotNull(schema.projects.scheduledAt))
    .orderBy(desc(schema.projects.scheduledAt))
  // A video for a disconnected channel has no lane (null); it is listed at its own time.
  const channelOf = (r: { channelId: string | null; channelYoutubeId: string | null }) =>
    resolveChannel(channels, r.channelId, r.channelYoutubeId)?.id ?? null
  const toProject = (r: (typeof rows)[number]): ScheduleProject => ({
    id: r.id,
    title: r.title,
    status: r.status,
    format: r.format,
    youtubeVideoId: r.youtubeVideoId,
  })
  const now = Date.now()
  const upcoming = rows.filter((r) => r.scheduledAt && r.scheduledAt.getTime() > now)
  const past = rows.filter((r) => r.scheduledAt && r.scheduledAt.getTime() <= now).slice(0, 10)
  const slots = upcomingSlots(settings.slots, settings.timezone, new Date(), 4)
  const lanes = channels.length ? channels.map((c) => c.id) : [null]
  const entries: ScheduleEntry[] = []
  const placed = new Set<string>()
  for (const lane of lanes) {
    for (const slot of slots) {
      const match = upcoming.find(
        (r) =>
          !placed.has(r.id) &&
          channelOf(r) === lane &&
          Math.abs(r.scheduledAt!.getTime() - slot.getTime()) < 60_000,
      )
      if (match) placed.add(match.id)
      entries.push({ at: slot.toISOString(), channelId: lane, project: match ? toProject(match) : null })
    }
  }
  // Videos booked at a custom time, outside the regular slots.
  for (const row of upcoming) {
    if (placed.has(row.id)) continue
    entries.push({
      at: row.scheduledAt!.toISOString(),
      channelId: channelOf(row),
      project: toProject(row),
    })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at))
  return {
    timezone: settings.timezone,
    channels: channels.map((c) => ({ id: c.id, title: c.title || 'Your channel' })),
    entries,
    recent: past.map((r) => ({
      at: r.scheduledAt!.toISOString(),
      channelId: channelOf(r),
      project: toProject(r),
    })),
  }
})
