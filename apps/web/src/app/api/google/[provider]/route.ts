import { clientFromRefresh, driveUsage, type GoogleProvider, listPlaylists } from '@cutroom/shared/google'
import { z } from 'zod'
import {
  channelFor,
  deleteChannel,
  deleteDrive,
  getChannel,
  getDrive,
  setDefaultChannel,
} from '@/server/connections'
import { badRequest, notFound, readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ provider: string }> }

function provider(value: string): GoogleProvider {
  if (value !== 'youtube' && value !== 'drive') badRequest('Unknown Google service.')
  return value
}

/** YouTube: the playlists of ?channel= (or the default channel). Drive: storage used. */
export const GET = route(async (request, { params }: Ctx) => {
  const which = provider((await params).provider)
  if (which === 'youtube') {
    const channel = await channelFor(new URL(request.url).searchParams.get('channel'), null)
    if (!channel) return { playlists: [] }
    return { playlists: await listPlaylists(clientFromRefresh(channel.refreshToken)) }
  }
  const drive = await getDrive()
  if (!drive) return { usage: null }
  return { usage: await driveUsage(clientFromRefresh(drive.refreshToken)) }
})

/** YouTube: make ?channel= the default channel. */
export const PATCH = route(async (request, { params }: Ctx) => {
  if (provider((await params).provider) !== 'youtube') badRequest('Only YouTube channels have a default.')
  const { channel } = await readJson(request, z.object({ channel: z.string().max(100) }))
  if (!(await getChannel(channel))) notFound('That channel')
  await setDefaultChannel(channel)
  return { ok: true }
})

/** YouTube: disconnect ?channel=. Drive: disconnect Drive. */
export const DELETE = route(async (request, { params }: Ctx) => {
  const which = provider((await params).provider)
  if (which === 'drive') {
    await deleteDrive()
    return { ok: true }
  }
  const id = new URL(request.url).searchParams.get('channel')
  if (!id) badRequest('Say which channel to disconnect.')
  await deleteChannel(id)
  return { ok: true }
})
