import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { createShort } from '@/server/shorts'

export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/**
 * Creates a Short from scenes `from`..`to` (positions in playing order). The browser cuts the
 * matching stretch of the voice-over and uploads it into the new project's folder first, so the
 * new project's id is chosen by the browser.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({
      newId: z.string().uuid(),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      fit: z.enum(['cover', 'contain']),
      title: z.string().max(200).default(''),
      voiceover: z
        .object({
          url: z.string().max(2000),
          name: z.string().max(300),
          duration: z
            .number()
            .positive()
            .max(4 * 3600),
        })
        .nullable(),
    }),
  )
  const projectId = await createShort({ sourceId: id, ...body })
  return { id: projectId }
})
