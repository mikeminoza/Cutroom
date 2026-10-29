import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { editScript, getProjectFull } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

/** Accepts a suggestion from the script doctor: the new words go into the script and its scenes. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { original, replacement } = await readJson(
    request,
    z.object({ original: z.string().min(1).max(5000), replacement: z.string().max(5000) }),
  )
  const edit = await editScript(id, original, replacement)
  return { ...(await getProjectFull(id)), edit }
})
