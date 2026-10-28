import {
  AnalyticsUnavailable,
  channelDetails,
  channelGrowth,
  hasAnalyticsScope,
  recentUploads,
} from '@cutroom/shared/google'
import type { GrowthNumbers } from '@cutroom/shared/setup'
import type { MonetizationDTO } from '@/lib/dto'
import { route } from '@/server/http'
import { channelClient, googleFailure } from '@/server/youtube'

const DAY = 86_400_000

/**
 * How close the channel is to the Partner Program: subscribers and recent uploads from the
 * YouTube Data API, watch hours and Shorts views from YouTube Analytics (when permitted).
 */
export const GET = route(async (request): Promise<MonetizationDTO> => {
  const id = new URL(request.url).searchParams.get('channel')
  const { channel, client } = await channelClient(id)
  let details: Awaited<ReturnType<typeof channelDetails>>
  try {
    details = await channelDetails(client)
  } catch (error) {
    googleFailure(error)
  }
  const uploads = details?.uploadsPlaylistId
    ? await recentUploads(client, details.uploadsPlaylistId, 50).catch(() => [])
    : []
  const numbers: GrowthNumbers = {
    subscribers: details?.subscribers ?? 0,
    longHours: null,
    shortsViews: null,
    recentUploads: uploads.filter((u) => u.publishedAt && Date.now() - Date.parse(u.publishedAt) < 90 * DAY)
      .length,
    pace: null,
    combined: false,
  }
  if (!hasAnalyticsScope(channel.scope)) {
    return {
      numbers,
      analytics: false,
      note: 'Reconnect the channel in Settings with the analytics permission to see watch hours and Shorts views.',
      youtubeId: details?.id ?? channel.youtubeId,
    }
  }
  try {
    const growth = await channelGrowth(client)
    return {
      numbers: { ...numbers, ...growth, shortsViews: growth.combined ? null : growth.shortsViews },
      analytics: true,
      note: null,
      youtubeId: details?.id ?? channel.youtubeId,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      numbers,
      analytics: false,
      note:
        error instanceof AnalyticsUnavailable
          ? `Watch hours are unavailable (${message}). Turn on the YouTube Analytics API in Google Cloud.`
          : `Watch hours could not be read: ${message}`,
      youtubeId: details?.id ?? channel.youtubeId,
    }
  }
})
