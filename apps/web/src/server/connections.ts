// Google accounts. Google Drive is one connection; YouTube can be several channels, one of them
// the default. A project posts to its own channel, or to the default when it has none.
import { channelInfo, clientFromRefresh, hasAnalyticsScope, hasGoogleClient } from '@cutroom/shared/google'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import { db, schema } from './db'
import type { ChannelRow } from './db/schema'
import { newId } from './http'

// ---------------------------------------------------------------- Drive

export async function getDrive() {
  const database = await db()
  const [row] = await database
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.provider, 'drive'))
  return row ?? null
}

export async function saveDrive(data: {
  refreshToken: string
  email: string | null
  label: string | null
  scope: string
}) {
  const database = await db()
  await database
    .insert(schema.connections)
    .values({ provider: 'drive', ...data })
    .onConflictDoUpdate({ target: schema.connections.provider, set: { ...data, createdAt: new Date() } })
}

export async function deleteDrive() {
  const database = await db()
  await database.delete(schema.connections).where(eq(schema.connections.provider, 'drive'))
}

// ---------------------------------------------------------------- YouTube channels

export async function listChannels(): Promise<ChannelRow[]> {
  const database = await db()
  return database.select().from(schema.channels).orderBy(asc(schema.channels.createdAt))
}

export async function getChannel(id: string): Promise<ChannelRow | null> {
  const database = await db()
  const [row] = await database.select().from(schema.channels).where(eq(schema.channels.id, id))
  return row ?? null
}

export async function defaultChannel(): Promise<ChannelRow | null> {
  const channels = await listChannels()
  return channels.find((c) => c.isDefault) ?? channels[0] ?? null
}

/**
 * The channel a project posts to: its own, or the default when it never picked one. Null when its
 * channel is disconnected: the video waits for it rather than going out on another channel.
 */
export async function channelFor(
  channelId: string | null | undefined,
  youtubeId: string | null | undefined,
): Promise<ChannelRow | null> {
  return resolveChannel(await listChannels(), channelId, youtubeId)
}

/**
 * Adds a channel, or refreshes it when it is connected again. A channel carried over from before
 * multi-channel support has no YouTube id yet; it is matched by title and gets its id here.
 */
export async function saveChannel(data: {
  youtubeId: string
  title: string
  email: string | null
  refreshToken: string
  scope: string
}): Promise<ChannelRow> {
  const database = await db()
  const values = {
    youtubeId: data.youtubeId,
    title: data.title,
    email: data.email,
    refreshToken: data.refreshToken,
    scope: data.scope,
  }
  const [existing] = await database
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.youtubeId, data.youtubeId))
  const [legacy] = existing
    ? [undefined]
    : await database
        .select()
        .from(schema.channels)
        .where(and(isNull(schema.channels.youtubeId), eq(schema.channels.title, data.title)))
  const match = existing ?? legacy
  if (match) {
    const [row] = await database
      .update(schema.channels)
      .set(values)
      .where(eq(schema.channels.id, match.id))
      .returning()
    if (legacy) {
      // Projects pinned to it remember the id too, so they find it again if it is ever reconnected.
      await database
        .update(schema.projects)
        .set({ channelYoutubeId: data.youtubeId })
        .where(and(eq(schema.projects.channelId, match.id), isNull(schema.projects.channelYoutubeId)))
    }
    return row
  }
  const first = (await listChannels()).length === 0
  const [row] = await database
    .insert(schema.channels)
    .values({ id: newId(), ...values, isDefault: first })
    .returning()
  return row
}

export async function deleteChannel(id: string) {
  const database = await db()
  const channel = await getChannel(id)
  if (!channel) return
  // Projects pinned to this channel keep waiting for it (see resolveChannel). They remember its
  // YouTube id so reconnecting it brings them back; a channel carried over from before multi-channel
  // support has no id yet, so ask YouTube for it, or mark the projects so they never post elsewhere.
  let youtubeId = channel.youtubeId
  if (!youtubeId) {
    try {
      youtubeId = (await channelInfo(clientFromRefresh(channel.refreshToken)))?.id ?? null
    } catch {
      youtubeId = null
    }
  }
  await database
    .update(schema.projects)
    .set({ channelYoutubeId: youtubeId ?? `disconnected:${id}` })
    .where(and(eq(schema.projects.channelId, id), isNull(schema.projects.channelYoutubeId)))
  const [removed] = await database.delete(schema.channels).where(eq(schema.channels.id, id)).returning()
  if (removed?.isDefault) {
    const [next] = await listChannels()
    if (next) await setDefaultChannel(next.id)
  }
}

export async function setDefaultChannel(id: string) {
  const database = await db()
  if (!(await getChannel(id))) return
  // One statement, so there is never a moment with no default or two of them.
  await database.update(schema.channels).set({ isDefault: sql`${schema.channels.id} = ${id}` })
}

// ---------------------------------------------------------------- summaries for the browser

export interface ConnectionSummary {
  connected: boolean
  email: string | null
  label: string | null
  since: string | null
}

export interface ChannelSummary {
  id: string
  youtubeId: string | null
  title: string
  email: string | null
  isDefault: boolean
  /** Connected with permission to read YouTube Analytics (watch time, retention). */
  analytics: boolean
}

export function toChannelSummary(row: ChannelRow, isDefault: boolean): ChannelSummary {
  return {
    id: row.id,
    youtubeId: row.youtubeId,
    title: row.title || 'Your channel',
    email: row.email,
    isDefault,
    analytics: hasAnalyticsScope(row.scope),
  }
}

export async function connectionSummaries(): Promise<{
  youtube: ConnectionSummary
  drive: ConnectionSummary
  channels: ChannelSummary[]
}> {
  const [channels, drive] = await Promise.all([listChannels(), getDrive()])
  const main = channels.find((c) => c.isDefault) ?? channels[0] ?? null
  return {
    youtube: {
      connected: Boolean(main),
      email: main?.email ?? null,
      label: main ? main.title || 'Your channel' : null,
      since: main?.createdAt.toISOString() ?? null,
    },
    drive: {
      connected: Boolean(drive),
      email: drive?.email ?? null,
      label: drive?.label ?? null,
      since: drive?.createdAt.toISOString() ?? null,
    },
    channels: channels.map((c) => toChannelSummary(c, c.id === main?.id)),
  }
}

export { hasGoogleClient }
