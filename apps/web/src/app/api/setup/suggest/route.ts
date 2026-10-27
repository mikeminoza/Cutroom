import { hasGeminiKey, suggestChannelSetup } from '@cutroom/shared/ai'
import { scheduleLine } from '@cutroom/shared/setup'
import { z } from 'zod'
import { defaultChannel, getChannel } from '@/server/connections'
import { badRequest, readJson, route } from '@/server/http'
import { getSettings } from '@/server/settings'

export const maxDuration = 300

/**
 * Gemini drafts the channel's About text, keywords and every-video tags from the niche in
 * Settings. Nothing is saved: the Channel setup page shows the draft to edit first.
 */
export const POST = route(async (request) => {
  const { channel: id } = await readJson(request, z.object({ channel: z.string().max(100).optional() }))
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to draft these with AI.')
  const settings = await getSettings()
  const channel = id ? await getChannel(id) : await defaultChannel()
  const { niche } = settings
  if (!niche.description.trim()) badRequest('Describe your channel in Settings → Channel niche first.')
  return suggestChannelSetup({
    channel: channel?.title ?? '',
    niche: niche.description,
    narration: niche.narration,
    audience: niche.audience,
    tone: niche.tone,
    market: niche.market,
    schedule: scheduleLine(settings.slots),
  })
})
