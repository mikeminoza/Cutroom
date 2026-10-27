import { channelArtPrompt, generateImage, hasGeminiKey } from '@cutroom/shared/ai'
import { imageDimensions, imageExtension } from '@cutroom/shared/images'
import { deleteFile, isStoredUnder, makeKey, putFile } from '@cutroom/shared/storage'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { defaultChannel, getChannel } from '@/server/connections'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { referenceImages } from '@/server/images'
import { getSettings } from '@/server/settings'

// Image models take 10–40 seconds.
export const maxDuration = 300

const FOLDER = 'channel/art'

/**
 * Gemini draws a profile picture or a banner for the channel, around the niche's main character.
 * YouTube's API can't set either, so the page offers the file to download and upload in Studio.
 */
export const POST = route(async (request) => {
  const {
    kind,
    channel: id,
    replace,
  } = await readJson(
    request,
    z.object({
      kind: z.enum(['avatar', 'banner']),
      channel: z.string().max(100).optional(),
      /** The previous draft, deleted once the new one is stored. */
      replace: z.string().max(2000).optional(),
    }),
  )
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to make pictures with AI.')
  const settings = await getSettings()
  const channel = id ? await getChannel(id) : await defaultChannel()
  const [mainId] = settings.niche.characterIds
  const [main] = mainId
    ? await (await db())
        .select()
        .from(schema.libraryCharacters)
        .where(inArray(schema.libraryCharacters.id, [mainId]))
    : []
  const image = await generateImage({
    prompt: channelArtPrompt(kind, {
      channel: channel?.title ?? '',
      niche: settings.niche.description,
      artStyle: settings.niche.artStyle,
      character: main ? [main.name, main.description].filter((t) => t.trim()).join(': ') || null : null,
    }),
    references: main ? await referenceImages([main]) : [],
    aspectRatio: kind === 'avatar' ? '1:1' : '16:9',
  })
  const stored = await putFile(
    makeKey(FOLDER, `${kind}${imageExtension(image.mimeType)}`),
    image.data,
    image.mimeType,
  )
  if (replace && isStoredUnder(replace, FOLDER)) await deleteFile(replace)
  const size = imageDimensions(image.data)
  return { url: stored.url, width: size?.width ?? null, height: size?.height ?? null }
})
