import { deleteFile } from '@cutroom/shared/storage'
import { getChannel } from '@/server/connections'
import { badRequest, readJson, route } from '@/server/http'
import { watchJob } from '@/server/jobs'
import { deleteProject, getProjectFull, getProjectRow, latestJob, updateProject } from '@/server/projects'
import { getSeries } from '@/server/series'
import { projectPatchSchema } from '@/server/validation'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  // Checking on a project also keeps its running jobs moving.
  const jobs = await Promise.all([latestJob(id, 'retime'), latestJob(id, 'publish'), latestJob(id, 'voice')])
  await Promise.all(jobs.map((job) => job && watchJob(job)))
  return getProjectFull(id)
})

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(request, projectPatchSchema)
  const current = await getProjectRow(id)
  const channel = patch.channelId ? await getChannel(patch.channelId) : null
  if (patch.channelId && !channel) badRequest('That YouTube channel is not connected.')
  if (patch.seriesId && !(await getSeries(patch.seriesId))) badRequest('That series no longer exists.')
  if (patch.channelId !== undefined && patch.channelId !== current.channelId && current.youtubeVideoId) {
    badRequest('This video is already on YouTube. Start over to post it to another channel.')
  }
  const update: Parameters<typeof updateProject>[1] = { ...patch }
  // The YouTube id lets the video find its channel again if it is disconnected and reconnected.
  if (patch.channelId !== undefined) update.channelYoutubeId = channel?.youtubeId ?? null
  if (patch.voiceoverUrl !== undefined && patch.voiceoverUrl !== current.voiceoverUrl) {
    await deleteFile(current.voiceoverUrl)
    update.transcript = null
  }
  if (patch.musicUrl !== undefined && patch.musicUrl !== current.musicUrl) await deleteFile(current.musicUrl)
  if (patch.thumbnailUrl !== undefined && patch.thumbnailUrl !== current.thumbnailUrl) {
    await deleteFile(current.thumbnailUrl)
  }
  await updateProject(id, update)
  return getProjectFull(id)
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  await deleteProject(id)
  return { ok: true }
})
