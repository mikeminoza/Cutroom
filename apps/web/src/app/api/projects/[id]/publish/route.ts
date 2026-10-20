import { nextFreeSlot } from '@cutroom/shared/schedule'
import { and, inArray, isNotNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { resolveChannel } from '@/lib/channels'
import { listChannels } from '@/server/connections'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { requireWorker, startJob } from '@/server/jobs'
import { getProjectFull, getProjectRow, getScenes, latestJob, updateProject } from '@/server/projects'
import { getSettings } from '@/server/settings'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({
      when: z.enum(['slot', 'now', 'custom']),
      at: z.string().optional(),
      mode: z.enum(['autopilot', 'review']).optional(),
    }),
  )
  const project = await getProjectRow(id)
  const scenes = await getScenes(id)
  if (scenes.length === 0) badRequest('Add scenes before finishing.')
  requireWorker()
  if (project.youtubeVideoId) badRequest('This video is already on YouTube. Use "Post again" to start over.')
  const active = await latestJob(id, 'publish')
  if (active && ['queued', 'running', 'waiting'].includes(active.status)) return getProjectFull(id)

  // Fix the channel now, so a later change of the default channel can't move this video.
  const channels = await listChannels()
  const channel = resolveChannel(channels, project.channelId, project.channelYoutubeId)
  if (!channel && project.channelYoutubeId) {
    badRequest(
      'This video is set to post to a channel that is disconnected. Reconnect it in Settings, or pick another channel under Post details.',
    )
  }

  let scheduledAt: Date | null = null
  if (body.when === 'custom') {
    const at = body.at ? new Date(body.at) : null
    if (!at || Number.isNaN(at.getTime())) badRequest('Pick a date and time.')
    if (at.getTime() < Date.now() + 15 * 60_000) badRequest('Pick a time at least 15 minutes from now.')
    scheduledAt = at
  } else if (body.when === 'slot') {
    const settings = await getSettings()
    const database = await db()
    const others = await database
      .select({
        at: schema.projects.scheduledAt,
        channelId: schema.projects.channelId,
        channelYoutubeId: schema.projects.channelYoutubeId,
      })
      .from(schema.projects)
      .where(
        and(
          ne(schema.projects.id, id),
          isNotNull(schema.projects.scheduledAt),
          inArray(schema.projects.status, ['rendering', 'awaiting_approval', 'uploading', 'scheduled']),
        ),
      )
    // Each channel has its own slots: only videos going to the same channel take a slot.
    const target = channel?.id ?? null
    const taken = others
      .filter((o) => (resolveChannel(channels, o.channelId, o.channelYoutubeId)?.id ?? null) === target)
      .map((o) => o.at as Date)
    scheduledAt = nextFreeSlot(settings.slots, settings.timezone, taken)
    if (!scheduledAt)
      badRequest('No free posting slot in the next 6 weeks. Add slots in Settings or pick a time.')
  }
  await updateProject(id, {
    scheduledAt,
    channelId: channel?.id ?? null,
    channelYoutubeId: channel?.youtubeId ?? null,
    ...(body.mode ? { mode: body.mode } : {}),
  })
  await startJob(id, 'publish')
  return getProjectFull(id)
})
