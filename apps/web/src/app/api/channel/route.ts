import {
  channelDetails,
  recentUploads,
  setChannelMadeForKids,
  updateChannelBranding,
  youtubeLanguages,
  youtubeRegions,
} from '@cutroom/shared/google'
import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { channelClient, googleFailure } from '@/server/youtube'

/**
 * The YouTube channel page: the channel's details and settings, its newest uploads (to pick a
 * trailer from), and the languages and countries YouTube accepts.
 */
export const GET = route(async (request) => {
  const { client } = await channelClient(new URL(request.url).searchParams.get('channel'))
  try {
    const details = await channelDetails(client)
    if (!details) return null
    // The lists only fill in dropdowns: the page still works without them.
    const [uploads, languages, regions] = await Promise.all([
      details.uploadsPlaylistId ? recentUploads(client, details.uploadsPlaylistId).catch(() => []) : [],
      youtubeLanguages(client).catch(() => []),
      youtubeRegions(client).catch(() => []),
    ])
    return { details, uploads, languages, regions }
  } catch (error) {
    googleFailure(error)
  }
})

const patchSchema = z.object({
  channel: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  defaultLanguage: z.string().min(2).max(20).optional(),
  /** A video id, or '' for no trailer. */
  trailer: z
    .string()
    .regex(/^[\w-]{0,20}$/)
    .optional(),
  madeForKids: z.boolean().optional(),
})

/** Changes only the given settings of the channel on YouTube and returns the channel as it is now. */
export const PATCH = route(async (request) => {
  const { channel: id, madeForKids, ...branding } = await readJson(request, patchSchema)
  const { client } = await channelClient(id)
  try {
    if (Object.values(branding).some((v) => v !== undefined)) await updateChannelBranding(client, branding)
    if (madeForKids !== undefined) await setChannelMadeForKids(client, madeForKids)
    return await channelDetails(client)
  } catch (error) {
    googleFailure(error)
  }
})
