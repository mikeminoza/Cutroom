import { z } from 'zod'
import { badRequest, readJson, route } from '@/server/http'
import { checkReplies, listReplies } from '@/server/replies'

// Reads a few videos' comments from YouTube; no AI.
export const maxDuration = 60

/** A channel's comments waiting for a reply, as last read (no YouTube call). */
export const GET = route(async (request) => {
  const channel = new URL(request.url).searchParams.get('channel')
  if (!channel) badRequest('Say which channel.')
  return listReplies(channel)
})

/** Reads the comments on the channel's recent videos from YouTube now. */
export const POST = route(async (request) => {
  const { channelId } = await readJson(request, z.object({ channelId: z.string().min(1).max(100) }))
  return checkReplies(channelId)
})
