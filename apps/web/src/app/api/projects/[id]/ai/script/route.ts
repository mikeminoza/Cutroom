import { writeScript } from '@cutroom/shared/ai'
import { z } from 'zod'
import { badRequest, readJson, route } from '@/server/http'
import { getProjectFull, getProjectRow, updateProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { notes } = await readJson(request, z.object({ notes: z.string().max(4000).default('') }))
  const project = await getProjectRow(id)
  if (!project.topic.trim()) badRequest('Add a topic on the Brief step first.')
  const result = await writeScript({
    topic: project.topic,
    audience: project.audience,
    tone: project.tone,
    language: project.language,
    minutes: project.targetMinutes,
    format: project.format,
    notes: notes || project.notes,
  })
  await updateProject(id, { script: result.script, title: project.title.trim() || result.title })
  return getProjectFull(id)
})
