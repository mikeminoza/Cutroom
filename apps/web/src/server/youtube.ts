// Reading and changing a connected channel's own settings on YouTube (Channel setup and the
// YouTube channel page).
import { clientFromRefresh, explainGoogleError, type OAuthClient } from '@cutroom/shared/google'
import { defaultChannel, getChannel } from './connections'
import type { ChannelRow } from './db/schema'
import { badRequest } from './http'

/** The connected channel a request names, or the default one, with a client for it. */
export async function channelClient(
  id: string | null | undefined,
): Promise<{ channel: ChannelRow; client: OAuthClient }> {
  const channel = id ? await getChannel(id) : await defaultChannel()
  if (!channel) badRequest('Connect YouTube in Settings first.')
  return { channel, client: clientFromRefresh(channel.refreshToken) }
}

/** A Google error as a 400 with a message you can act on. */
export function googleFailure(error: unknown): never {
  const reasons = ((error as { errors?: { reason?: string }[] } | null)?.errors ?? []).map((e) => e.reason)
  if (reasons.includes('insufficientPermissions')) {
    badRequest(
      'Cutroom may not change this channel yet. Reconnect it in Settings and allow every permission.',
    )
  }
  badRequest(explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error)))
}
