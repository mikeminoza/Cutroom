import { z } from 'zod'
import { markCrossPost } from '@/server/cross-posts'
import { readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

/** Marks the Short as posted on TikTok or Reels by hand (or not), with an optional link to the post. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const input = await readJson(
    request,
    z.object({
      platform: z.enum(['tiktok', 'reels']),
      posted: z.boolean(),
      url: z.string().max(500).optional(),
    }),
  )
  return markCrossPost(id, input)
})
