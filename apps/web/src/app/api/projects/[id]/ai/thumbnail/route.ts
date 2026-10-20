import { deleteFile } from '@cutroom/shared/storage'
import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { generateAndStore } from '@/server/images'
import {
  getCharacters,
  getProjectFull,
  getProjectRow,
  toCharacterDTO,
  updateProject,
} from '@/server/projects'

export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/** Generates a 16:9 thumbnail from a prompt (one of the AI thumbnail ideas, or your own). */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { prompt } = await readJson(request, z.object({ prompt: z.string().trim().min(1).max(4000) }))
  const project = await getProjectRow(id)
  const characters = (await getCharacters(id)).map(toCharacterDTO)
  const image = await generateAndStore({
    projectId: id,
    folder: 'thumbnail',
    name: 'thumbnail',
    prompt,
    characters,
    aspectRatio: '16:9',
  })
  if (project.thumbnailUrl && project.thumbnailUrl !== image.url) await deleteFile(project.thumbnailUrl)
  await updateProject(id, { thumbnailUrl: image.url })
  return getProjectFull(id)
})
