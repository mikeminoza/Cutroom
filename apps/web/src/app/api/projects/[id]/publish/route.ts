import { nextFreeSlot } from '@cutroom/shared/schedule'
import { and, inArray, isNotNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { startJob, workerUrl } from '@/server/jobs'
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
  if (!workerUrl()) badRequest('The worker is not set up yet. Add WORKER_URL and WORKER_SECRET.')
  if (project.youtubeVideoId) badRequest('This video is already on YouTube. Use "Post again" to start over.')
  const active = await latestJob(id, 'publish')
  if (active && ['queued', 'running', 'waiting'].includes(active.status)) return getProjectFull(id)

  let scheduledAt: Date | null = null
  if (body.when === 'custom') {
    const at = body.at ? new Date(body.at) : null
    if (!at || Number.isNaN(at.getTime())) badRequest('Pick a date and time.')
    if (at.getTime() < Date.now() + 15 * 60_000) badRequest('Pick a time at least 15 minutes from now.')
    scheduledAt = at
  } else if (body.when === 'slot') {
    const settings = await getSettings()
    const database = await db()
    const taken = await database
      .select({ at: schema.projects.scheduledAt })
      .from(schema.projects)
      .where(
        and(
          ne(schema.projects.id, id),
          isNotNull(schema.projects.scheduledAt),
          inArray(schema.projects.status, ['rendering', 'awaiting_approval', 'uploading', 'scheduled']),
        ),
      )
    scheduledAt = nextFreeSlot(
      settings.slots,
      settings.timezone,
      taken.map((t) => t.at as Date),
    )
    if (!scheduledAt)
      badRequest('No free posting slot in the next 6 weeks. Add slots in Settings or pick a time.')
  }
  await updateProject(id, { scheduledAt, ...(body.mode ? { mode: body.mode } : {}) })
  await startJob(id, 'publish')
  return getProjectFull(id)
})
