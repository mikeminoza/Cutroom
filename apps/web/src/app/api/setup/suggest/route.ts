import { hasGeminiKey, suggestChannelSetup } from '@cutroom/shared/ai'
import { channelDetails, clientFromRefresh, recentUploads } from '@cutroom/shared/google'
import { scheduleLine } from '@cutroom/shared/setup'
import { z } from 'zod'
import { defaultChannel, getChannel } from '@/server/connections'
import { badRequest, readJson, route } from '@/server/http'
import { getSettings } from '@/server/settings'

export const maxDuration = 300

/** The newest uploads to pick a trailer from; none when YouTube isn't connected or can't be read. */
async function uploadsOf(refreshToken: string | null) {
  if (!refreshToken) return []
  try {
    const client = clientFromRefresh(refreshToken)
    const details = await channelDetails(client)
    return details?.uploadsPlaylistId ? await recentUploads(client, details.uploadsPlaylistId, 30) : []
  } catch {
    return []
  }
}

/**
 * Gemini drafts the whole channel setup from the niche in Settings: YouTube's About text, keywords
 * and trailer, and the tags, footer, category, made-for-kids default and posting rhythm for every
 * video. Nothing is saved: the page shows the draft to pick from first.
 */
export const POST = route(async (request) => {
  const { channel: id } = await readJson(request, z.object({ channel: z.string().max(100).optional() }))
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to draft these with AI.')
  const settings = await getSettings()
  const { niche } = settings
  if (!niche.description.trim()) badRequest('Describe your channel in Settings → Channel niche first.')
  const channel = id ? await getChannel(id) : await defaultChannel()
  return suggestChannelSetup({
    channel: channel?.title ?? '',
    niche: niche.description,
    narration: niche.narration,
    audience: niche.audience,
    tone: niche.tone,
    market: niche.market,
    targetMinutes: niche.targetMinutes,
    schedule: scheduleLine(settings.slots),
    uploads: await uploadsOf(channel?.refreshToken ?? null),
  })
})
