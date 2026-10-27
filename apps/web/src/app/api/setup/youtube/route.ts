import { channelDetails, updateChannelBranding } from '@cutroom/shared/google'
import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { channelClient, googleFailure } from '@/server/youtube'

/** The channel's own settings on YouTube that the Channel setup tips check. */
export const GET = route(async (request) => {
  const { client } = await channelClient(new URL(request.url).searchParams.get('channel'))
  try {
    return await channelDetails(client)
  } catch (error) {
    googleFailure(error)
  }
})

const patchSchema = z.object({
  channel: z.string().max(100).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  defaultLanguage: z.string().max(20).optional(),
  description: z.string().max(1000).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
})

/** Changes only the given settings of the channel on YouTube; everything else stays as it is. */
export const PATCH = route(async (request) => {
  const { channel: id, ...patch } = await readJson(request, patchSchema)
  const { client } = await channelClient(id)
  try {
    return await updateChannelBranding(client, patch)
  } catch (error) {
    googleFailure(error)
  }
})
