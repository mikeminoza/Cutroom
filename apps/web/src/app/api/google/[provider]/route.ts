import { clientFromRefresh, driveUsage, type GoogleProvider, listPlaylists } from '@cutroom/shared/google'
import { deleteConnection, getConnection } from '@/server/connections'
import { badRequest, route } from '@/server/http'

type Ctx = { params: Promise<{ provider: string }> }

function provider(value: string): GoogleProvider {
  if (value !== 'youtube' && value !== 'drive') badRequest('Unknown Google service.')
  return value
}

/** YouTube: your playlists. Drive: storage used. */
export const GET = route(async (_request, { params }: Ctx) => {
  const which = provider((await params).provider)
  const connection = await getConnection(which)
  if (!connection) return which === 'youtube' ? { playlists: [] } : { usage: null }
  const client = clientFromRefresh(connection.refreshToken)
  if (which === 'youtube') return { playlists: await listPlaylists(client) }
  return { usage: await driveUsage(client) }
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  await deleteConnection(provider((await params).provider))
  return { ok: true }
})
