import { clientFromRefresh, reschedule } from '@cutroom/shared/google'
import { z } from 'zod'
import { getConnection } from '@/server/connections'
import { badRequest, readJson, route } from '@/server/http'
import { getProjectFull, getProjectRow, updateProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

/** Moves a scheduled video to another time — on YouTube too when it is already uploaded. */
export const PUT = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { at } = await readJson(request, z.object({ at: z.string() }))
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) badRequest('Pick a date and time.')
  if (when.getTime() < Date.now() + 15 * 60_000) badRequest('Pick a time at least 15 minutes from now.')
  const project = await getProjectRow(id)
  if (project.youtubeVideoId) {
    const youtube = await getConnection('youtube')
    if (!youtube) badRequest('Connect YouTube to move an uploaded video.')
    await reschedule(
      clientFromRefresh(youtube.refreshToken),
      project.youtubeVideoId,
      when.toISOString(),
      project.post.madeForKids,
    )
    await updateProject(id, { scheduledAt: when, status: 'scheduled' })
  } else {
    await updateProject(id, { scheduledAt: when })
  }
  return getProjectFull(id)
})
