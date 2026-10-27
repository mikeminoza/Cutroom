import {
  channelSetup,
  clientFromRefresh,
  explainGoogleError,
  updateChannelBranding,
} from '@cutroom/shared/google'
import { z } from 'zod'
import { defaultChannel, getChannel } from '@/server/connections'
import { badRequest, readJson, route } from '@/server/http'

async function pickChannel(id: string | null | undefined) {
  const channel = id ? await getChannel(id) : await defaultChannel()
  if (!channel) badRequest('Connect YouTube in Settings first.')
  return channel
}

function googleFailure(error: unknown): never {
  const reasons = ((error as { errors?: { reason?: string }[] } | null)?.errors ?? []).map((e) => e.reason)
  if (reasons.includes('insufficientPermissions')) {
    badRequest(
      'Cutroom may not change this channel yet. Reconnect it in Settings and allow every permission.',
    )
  }
  badRequest(explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error)))
}

/** The channel's own settings on YouTube that the Channel setup tips check. */
export const GET = route(async (request) => {
  const channel = await pickChannel(new URL(request.url).searchParams.get('channel'))
  try {
    return await channelSetup(clientFromRefresh(channel.refreshToken))
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
  const channel = await pickChannel(id)
  try {
    return await updateChannelBranding(clientFromRefresh(channel.refreshToken), patch)
  } catch (error) {
    googleFailure(error)
  }
})
