import { channelInfo, removeWatermark, setWatermark, type WatermarkTiming } from '@cutroom/shared/google'
import { badRequest, route } from '@/server/http'
import { channelClient, googleFailure } from '@/server/youtube'

/** YouTube Studio's own limit for the branding watermark. */
const MAX_BYTES = 1024 * 1024
const TYPES = ['image/png', 'image/jpeg']

/** When the watermark shows: the last 15 seconds, the whole video, or from a set time on. */
function timingFor(kind: string, startSeconds: number): WatermarkTiming {
  if (kind === 'end') return { type: 'offsetFromEnd', offsetMs: 15_000, durationMs: 15_000 }
  if (kind === 'custom')
    return { type: 'offsetFromStart', offsetMs: Math.round(Math.max(0, startSeconds) * 1000) }
  return { type: 'offsetFromStart', offsetMs: 0 }
}

async function youtubeId(id: string | null) {
  const { channel, client } = await channelClient(id)
  const youtube = channel.youtubeId ?? (await channelInfo(client))?.id
  if (!youtube) badRequest('That YouTube account has no channel.')
  return { client, youtube }
}

/** Sets the branding watermark shown on every video of the channel. */
export const POST = route(async (request) => {
  const form = await request.formData().catch(() => badRequest('Send the image as a form upload.'))
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) badRequest('Choose an image for the watermark.')
  if (!TYPES.includes(file.type)) badRequest('The watermark must be a PNG or JPG image.')
  if (file.size > MAX_BYTES) badRequest('The watermark image must be 1 MB or smaller.')
  const kind = String(form.get('timing') ?? 'entire')
  if (!['end', 'entire', 'custom'].includes(kind)) badRequest('Pick when the watermark shows.')
  const start = Number(form.get('start') ?? 0)
  if (kind === 'custom' && !(Number.isFinite(start) && start >= 0))
    badRequest('Enter a start time in seconds.')
  const channel = form.get('channel')
  const { client, youtube } = await youtubeId(typeof channel === 'string' && channel ? channel : null)
  try {
    await setWatermark(
      client,
      youtube,
      { mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) },
      timingFor(kind, start),
    )
  } catch (error) {
    googleFailure(error)
  }
  return { ok: true }
})

/** Removes the branding watermark from the channel's videos. */
export const DELETE = route(async (request) => {
  const { client, youtube } = await youtubeId(new URL(request.url).searchParams.get('channel'))
  try {
    await removeWatermark(client, youtube)
  } catch (error) {
    googleFailure(error)
  }
  return { ok: true }
})
