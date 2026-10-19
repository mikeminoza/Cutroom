import { splitScript } from '@cutroom/shared/ai'
import { alignScenes } from '@cutroom/shared/align'
import { layoutByEstimate } from '@cutroom/shared/timing'
import { badRequest, route } from '@/server/http'
import { getCharacters, getProjectFull, getProjectRow, replaceScenes } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  if (!project.script.trim()) badRequest('Write or paste the script first.')
  const characters = await getCharacters(id)
  const drafts = await splitScript({
    script: project.script,
    pace: project.pace,
    artStyle: project.artStyle,
    format: project.format,
    characters: characters.map((c) => ({ name: c.name, description: c.description })),
  })
  let placed = layoutByEstimate(drafts)
  // A timed voice-over already exists: line the new scenes up with it straight away.
  if (project.transcript?.words.length) {
    const { times } = alignScenes(
      placed.map((s) => s.narration),
      project.transcript.words,
      project.transcript.duration,
    )
    placed = placed.map((s, i) => ({ ...s, start: times[i].start, end: times[i].end }))
  }
  await replaceScenes(id, placed)
  return getProjectFull(id)
})
