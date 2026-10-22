import { z } from 'zod'
import { listInsights, readComments } from '@/server/comments'
import { readJson, route } from '@/server/http'

// Gemini reads a few hundred comments: the Hobby plan allows 300 s with Fluid compute.
export const maxDuration = 300

/** The latest read of each channel's comments. */
export const GET = route(async () => listInsights())

/** Reads a channel's comments now. */
export const POST = route(async (request) => {
  const { channelId } = await readJson(request, z.object({ channelId: z.string().min(1).max(100) }))
  return readComments(channelId)
})
