import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { sendReplies } from '@/server/replies'

// A few replies posted one after another.
export const maxDuration = 60

/** Posts the replies you approved, exactly as sent (a few per click). */
export const POST = route(async (request) => {
  const { replies } = await readJson(
    request,
    z.object({
      replies: z
        .array(z.object({ id: z.string().min(1).max(200), text: z.string().trim().min(1).max(10_000) }))
        .min(1)
        .max(200),
    }),
  )
  return sendReplies(replies)
})
