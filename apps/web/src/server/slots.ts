// Posting slots: the next time on a channel's schedule that no other video has taken.
import { nextFreeSlot } from '@cutroom/shared/schedule'
import { and, inArray, isNotNull, ne } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import { listChannels } from './connections'
import { db, schema } from './db'
import { getSettings } from './settings'

/**
 * The next free posting slot for a project on `channelId` (null: the default channel), at or after
 * `from`. Each channel has its own slots: only videos going to the same channel take one.
 */
export async function nextOpenSlot(
  projectId: string,
  channelId: string | null,
  from = new Date(),
): Promise<Date | null> {
  const [settings, channels, database] = await Promise.all([getSettings(), listChannels(), db()])
  const others = await database
    .select({
      at: schema.projects.scheduledAt,
      channelId: schema.projects.channelId,
      channelYoutubeId: schema.projects.channelYoutubeId,
    })
    .from(schema.projects)
    .where(
      and(
        ne(schema.projects.id, projectId),
        isNotNull(schema.projects.scheduledAt),
        inArray(schema.projects.status, ['rendering', 'awaiting_approval', 'uploading', 'scheduled']),
      ),
    )
  const target = channelId ?? resolveChannel(channels, null, null)?.id ?? null
  const taken = others
    .filter((o) => (resolveChannel(channels, o.channelId, o.channelYoutubeId)?.id ?? null) === target)
    .map((o) => o.at as Date)
  return nextFreeSlot(settings.slots, settings.timezone, taken, from)
}
