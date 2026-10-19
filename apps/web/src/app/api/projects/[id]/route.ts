import { deleteFile } from '@cutroom/shared/storage'
import { readJson, route } from '@/server/http'
import { watchJob } from '@/server/jobs'
import { deleteProject, getProjectFull, getProjectRow, latestJob, updateProject } from '@/server/projects'
import { projectPatchSchema } from '@/server/validation'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  // Checking on a project also keeps its running job moving.
  const [retime, publish] = await Promise.all([latestJob(id, 'retime'), latestJob(id, 'publish')])
  await Promise.all([retime && watchJob(retime), publish && watchJob(publish)])
  return getProjectFull(id)
})

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(request, projectPatchSchema)
  const current = await getProjectRow(id)
  const update: Parameters<typeof updateProject>[1] = { ...patch }
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
