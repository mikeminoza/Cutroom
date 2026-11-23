import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { updateReply } from '@/server/replies'

type Ctx = { params: Promise<{ id: string }> }

/** Your edit to a reply before it is posted, or skipping a comment. */
export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(
    request,
    z.object({ draft: z.string().max(10_000), status: z.enum(['waiting', 'skipped']) }).partial(),
  )
  return updateReply(id, patch)
})
