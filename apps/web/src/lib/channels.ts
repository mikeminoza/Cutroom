// Which YouTube channel a video posts to. Used by the server (publishing, stats, schedule) and the
// browser (Publish step), so both always agree.

interface ChannelLike {
  id: string
  youtubeId: string | null
  isDefault: boolean
}

/**
 * The project's own channel when it has one; the default channel when it never picked one.
 * A video aimed at a channel that is disconnected right now gets null: it waits for that channel
 * (found again by its YouTube id once reconnected) instead of going out on another one.
 */
export function resolveChannel<C extends ChannelLike>(
  channels: C[],
  channelId: string | null | undefined,
  youtubeId: string | null | undefined,
): C | null {
  const own = channelId ? channels.find((c) => c.id === channelId) : undefined
  if (own) return own
  if (youtubeId) return channels.find((c) => c.youtubeId === youtubeId) ?? null
  return channels.find((c) => c.isDefault) ?? channels[0] ?? null
}
