import { writeScript } from '@cutroom/shared/ai'
import { z } from 'zod'
import { badRequest, readJson, route } from '@/server/http'
import { getCharacters, getProjectFull, getProjectRow, updateProject } from '@/server/projects'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

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
    characters: (await getCharacters(id))
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), description: c.description })),
  })
  await updateProject(id, { script: result.script, title: project.title.trim() || result.title })
  return getProjectFull(id)
})
