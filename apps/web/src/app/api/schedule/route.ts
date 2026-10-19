import { upcomingSlots } from '@cutroom/shared/schedule'
import { desc, isNotNull } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { route } from '@/server/http'
import { getSettings } from '@/server/settings'

export interface ScheduleEntry {
  at: string
  project: { id: string; title: string; status: string; format: string; youtubeVideoId: string | null } | null
}

export const GET = route(async () => {
  const settings = await getSettings()
  const database = await db()
  const rows = await database
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      status: schema.projects.status,
      format: schema.projects.format,
      youtubeVideoId: schema.projects.youtubeVideoId,
      scheduledAt: schema.projects.scheduledAt,
    })
    .from(schema.projects)
    .where(isNotNull(schema.projects.scheduledAt))
    .orderBy(desc(schema.projects.scheduledAt))
  const now = Date.now()
  const upcoming = rows.filter((r) => r.scheduledAt && r.scheduledAt.getTime() > now)
  const past = rows.filter((r) => r.scheduledAt && r.scheduledAt.getTime() <= now).slice(0, 10)
  const slots = upcomingSlots(settings.slots, settings.timezone, new Date(), 4)
  const entries: ScheduleEntry[] = slots.map((slot) => {
    const match = upcoming.find((r) => Math.abs(r.scheduledAt!.getTime() - slot.getTime()) < 60_000)
    return {
      at: slot.toISOString(),
      project: match ? ({ ...match, scheduledAt: undefined } as ScheduleEntry['project']) : null,
    }
  })
  // Videos booked at a custom time, outside the regular slots.
  for (const row of upcoming) {
    if (!entries.some((e) => e.project?.id === row.id)) {
      entries.push({
        at: row.scheduledAt!.toISOString(),
        project: row as unknown as ScheduleEntry['project'],
      })
    }
  }
  entries.sort((a, b) => a.at.localeCompare(b.at))
  return {
    timezone: settings.timezone,
    entries,
    recent: past.map((r) => ({ at: r.scheduledAt!.toISOString(), project: r })),
  }
})
