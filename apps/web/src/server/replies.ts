// Answering viewers' comments from Cutroom (Performance → Comments to answer). Replies bring more
// comments while a video is new (Grow the channel), so Cutroom lists the comments on each
// channel's recent public videos that still wait for its reply, has Gemini draft replies when you
// ask (one Flash-Lite call per video), and posts the ones you approve when you click: never on its
// own. Drafts, skips and posted replies are kept, so a reload or a second visit pays neither
// Gemini nor YouTube again.
//
// YouTube quota (10,000 units a day, shared with uploads at about 1,600 each): reading a video's
// comments is 1 unit, plus 1 for each thread with more replies than YouTube sends along, so a check
// is about REPLIES.videos units at most. A reply is 50, so one click posts REPLIES.perClick.
import {
  type AnswerEvents,
  draftReplies,
  hasGeminiKey,
  mapPartials,
  type ReplyDraft,
} from '@cutroom/shared/ai'
import {
  type CommentThread,
  channelInfo,
  clientFromRefresh,
  explainGoogleError,
  type OAuthClient,
  replyToComment,
  threadReplyAuthors,
  videoCommentThreads,
} from '@cutroom/shared/google'
import { postedAt } from '@cutroom/shared/growth'
import { needsAllReplies, REPLIES, waitingComments } from '@cutroom/shared/replies'
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm'
import { resolveChannel } from '@/lib/channels'
import type { RepliesDTO, ReplyChange, ReplyCommentDTO, SentRepliesDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { listChannels } from './connections'
import { db, schema } from './db'
import type { ChannelRow, CommentReplyRow, ProjectRow } from './db/schema'
import { badRequest, notFound } from './http'
import { getSettings } from './settings'

const DAY = 86_400_000
/**
 * Threads per video whose other replies are read to see if one is yours (1 unit each). Past this
 * (a video with a lot going on), a thread counts as waiting, and you see it before anything posts.
 */
const MORE_REPLIES = 20

const replies = schema.commentReplies

const titleOf = (project: ProjectRow) => (project.post?.title || project.title).trim() || 'Untitled video'
const reason = (error: unknown) =>
  explainGoogleError(error) ?? (error instanceof Error ? error.message : String(error))

const toComment = (row: CommentReplyRow): ReplyCommentDTO => ({
  id: row.id,
  author: row.author,
  text: row.text,
  likes: row.likes,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  status: row.status,
  draft: row.draft,
  skipReason: row.skipReason,
  replyId: row.replyId,
})

/** When a video went public, the way Grow the channel counts it; null while it isn't. */
function wentPublic(project: ProjectRow, now: Date): Date | null {
  return postedAt(
    {
      id: project.id,
      title: project.title,
      format: project.format,
      status: project.status,
      scheduledAt: project.scheduledAt?.toISOString() ?? null,
      updatedAt: project.updatedAt.toISOString(),
      stats: project.stats
        ? {
            views: project.stats.views,
            averageViewPercent: project.stats.averageViewPercent,
            publishedAt: project.stats.publishedAt,
          }
        : null,
    },
    now,
  )
}

/**
 * The channel's videos read for replies, newest first: public ones out in the last REPLIES.days.
 * Private and unlisted videos have few viewers to answer, and videos made for kids have comments
 * turned off.
 */
async function recentVideos(channel: ChannelRow, channels: ChannelRow[]) {
  const database = await db()
  const rows = await database.select().from(schema.projects).where(isNotNull(schema.projects.youtubeVideoId))
  const now = new Date()
  return rows
    .filter((p) => resolveChannel(channels, p.channelId, p.channelYoutubeId)?.id === channel.id)
    .filter((p) => (p.post?.privacy ?? 'public') === 'public' && !p.post?.madeForKids)
    .map((project) => ({ project, at: wentPublic(project, now) }))
    .filter(
      (v): v is { project: ProjectRow; at: Date } =>
        v.at !== null && now.getTime() - v.at.getTime() <= REPLIES.days * DAY,
    )
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, REPLIES.videos)
}

async function channelById(channelId: string) {
  const channels = await listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) notFound('That channel')
  return { channel, channels }
}

/** A channel's comments to answer as last read from YouTube (no YouTube call). */
export async function listReplies(channelId: string): Promise<RepliesDTO> {
  const { channel, channels } = await channelById(channelId)
  const videos = await recentVideos(channel, channels)
  const database = await db()
  const rows = videos.length
    ? await database
        .select()
        .from(replies)
        .where(
          and(
            eq(replies.channelId, channel.id),
            inArray(
              replies.projectId,
              videos.map((v) => v.project.id),
            ),
          ),
        )
        .orderBy(asc(replies.publishedAt), asc(replies.id))
    : []
  return {
    channelId: channel.id,
    checkedAt: channel.repliesCheckedAt?.toISOString() ?? null,
    read: videos.length,
    videos: videos.flatMap(({ project, at }) => {
      const comments = rows.filter((r) => r.projectId === project.id).map(toComment)
      if (!comments.length) return []
      return [
        {
          projectId: project.id,
          title: titleOf(project),
          format: project.format,
          youtubeVideoId: project.youtubeVideoId as string,
          publishedAt: at.toISOString(),
          comments,
        },
      ]
    }),
  }
}

/**
 * Reads one video's comments and brings its stored ones up to date. Drafts, skips and replies are
 * kept: only the comment's own text and likes change.
 */
async function readVideo(client: OAuthClient, channel: ChannelRow, project: ProjectRow, you: string[]) {
  const read = await videoCommentThreads(client, project.youtubeVideoId as string)
  const { complete } = read
  // YouTube sends only a few replies with each thread: read the rest where yours could be among them.
  let lookups = 0
  const threads: CommentThread[] = []
  for (const thread of read.threads) {
    const more = needsAllReplies(thread, you) && lookups++ < MORE_REPLIES
    threads.push(more ? { ...thread, replyAuthors: await threadReplyAuthors(client, thread.id) } : thread)
  }
  const waiting = waitingComments(threads, you)
  const database = await db()
  const stored = await database.select().from(replies).where(eq(replies.projectId, project.id))
  const waitingIds = new Set(waiting.map((t) => t.id))
  const seen = new Set(threads.map((t) => t.id))
  // No longer waiting: answered on YouTube since (in Studio, say), or deleted. A reply Cutroom
  // posted stays, so its comment isn't listed again while YouTube catches up.
  const gone = stored.filter(
    (row) => row.status !== 'replied' && !waitingIds.has(row.id) && (seen.has(row.id) || complete),
  )
  if (gone.length) {
    await database.delete(replies).where(
      inArray(
        replies.id,
        gone.map((row) => row.id),
      ),
    )
  }
  if (!waiting.length) return
  await database
    .insert(replies)
    .values(
      waiting.map((thread) => ({
        id: thread.id,
        channelId: channel.id,
        projectId: project.id,
        author: thread.author,
        text: thread.text,
        likes: thread.likes,
        publishedAt: thread.publishedAt ? new Date(thread.publishedAt) : null,
      })),
    )
    .onConflictDoUpdate({
      target: replies.id,
      set: {
        author: sql`excluded.author`,
        text: sql`excluded.text`,
        likes: sql`excluded.likes`,
        publishedAt: sql`excluded.published_at`,
      },
    })
}

/**
 * Reads the comments on the channel's recent public videos from YouTube now (1 quota unit a video,
 * no AI), and returns what waits for a reply.
 */
export async function checkReplies(channelId: string): Promise<RepliesDTO> {
  const { channel, channels } = await channelById(channelId)
  const videos = await recentVideos(channel, channels)
  try {
    // Inside the try: a missing Google client setup is a message, not a crash.
    const client = clientFromRefresh(channel.refreshToken)
    // A channel carried over from before multi-channel support doesn't know its YouTube id yet.
    const own = channel.youtubeId ?? (await channelInfo(client))?.id ?? ''
    // A comment or reply from any of your channels is yours.
    const you = [own, ...channels.map((c) => c.youtubeId ?? '')].filter(Boolean)
    // Three videos at a time: quick, without a burst of requests.
    for (let i = 0; i < videos.length; i += 3) {
      await Promise.all(videos.slice(i, i + 3).map(({ project }) => readVideo(client, channel, project, you)))
    }
  } catch (error) {
    badRequest(`${channel.title}: ${reason(error)}`)
  }
  const database = await db()
  // Comments on videos no longer read (out too long, or past the newest few) are let go.
  const read = videos.map((v) => v.project.id)
  await database
    .delete(replies)
    .where(
      and(eq(replies.channelId, channel.id), read.length ? notInArray(replies.projectId, read) : undefined),
    )
  await database
    .update(schema.channels)
    .set({ repliesCheckedAt: new Date() })
    .where(eq(schema.channels.id, channel.id))
  return listReplies(channel.id)
}

/** What a draft makes of its comment: a reply to check, or skipped with why. */
function changeOf(id: string, drafted: ReplyDraft): ReplyChange {
  return 'reply' in drafted
    ? { id, status: 'waiting', draft: drafted.reply, skipReason: null }
    : { id, status: 'skipped', draft: null, skipReason: drafted.skip }
}

/**
 * Has Gemini draft replies to one video's waiting comments that have none yet: one Flash-Lite call
 * for up to REPLIES.perDraft of them, the ones waiting longest first. Comments Gemini thinks need
 * no reply are skipped, with why. Nothing is posted. With `events`, each draft is handed over as
 * soon as it's written; they are saved once all are.
 */
export async function draftVideoReplies(
  projectId: string,
  events?: AnswerEvents<{ comments: ReplyChange[] }>,
): Promise<RepliesDTO> {
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to your environment to use AI features.')
  const database = await db()
  const [project] = await database.select().from(schema.projects).where(eq(schema.projects.id, projectId))
  if (!project) notFound('That video')
  const channels = await listChannels()
  const channel = resolveChannel(channels, project.channelId, project.channelYoutubeId)
  if (!channel) badRequest("That video's channel isn't connected.")
  // Only comments with no draft yet: a draft is never paid for twice.
  const todo = await database
    .select()
    .from(replies)
    .where(and(eq(replies.projectId, project.id), eq(replies.status, 'waiting'), isNull(replies.draft)))
    .orderBy(asc(replies.publishedAt), asc(replies.id))
    .limit(REPLIES.perDraft)
  if (todo.length) {
    const settings = await getSettings()
    const drafts = await draftReplies(
      {
        channel: channel.title,
        niche: settings.niche.description,
        narration: settings.niche.narration,
        language: project.language || settings.defaults.language,
        video: { title: titleOf(project), topic: project.topic, script: project.script },
        comments: todo.map((row) => ({ author: row.author, text: row.text })),
      },
      mapPartials(events, (sofar) => ({
        comments: todo.flatMap((row, i) => {
          const drafted = sofar[i]
          return drafted ? [changeOf(row.id, drafted)] : []
        }),
      })),
    )
    for (const [i, row] of todo.entries()) {
      const drafted = drafts[i]
      if (!drafted) continue
      // Only if it still waits undrafted: what you wrote or posted meanwhile wins.
      await database
        .update(replies)
        .set('reply' in drafted ? { draft: drafted.reply } : { status: 'skipped', skipReason: drafted.skip })
        .where(and(eq(replies.id, row.id), eq(replies.status, 'waiting'), isNull(replies.draft)))
    }
  }
  return listReplies(channel.id)
}

/** Your edit to a reply before it is posted, or skipping a comment (and changing your mind). */
export async function updateReply(
  id: string,
  patch: { draft?: string; status?: 'waiting' | 'skipped' },
): Promise<ReplyCommentDTO> {
  const database = await db()
  const [row] = await database.select().from(replies).where(eq(replies.id, id))
  if (!row) notFound('That comment')
  if (row.status === 'replied') badRequest('That comment has your reply already.')
  const set: Partial<CommentReplyRow> = {}
  if (patch.draft !== undefined) set.draft = patch.draft
  if (patch.status === 'skipped' && row.status !== 'skipped') {
    set.status = 'skipped'
    set.skipReason = ''
  }
  if (patch.status === 'waiting' && row.status === 'skipped') {
    set.status = 'waiting'
    // Yours to write: an empty draft, so "Draft replies" doesn't pay Gemini for it again.
    set.draft = set.draft ?? row.draft ?? ''
  }
  if (!Object.keys(set).length) return toComment(row)
  const [updated] = await database
    .update(replies)
    .set(set)
    .where(and(eq(replies.id, id), ne(replies.status, 'replied')))
    .returning()
  if (!updated) badRequest('That comment has your reply already.')
  return toComment(updated)
}

/**
 * Posts the replies you approved, exactly as sent, each in its comment's thread: at most
 * REPLIES.perClick a click, and never one Cutroom posted before. Stops at the first error that
 * would stop the rest too (signed out, quota used up). The only place Cutroom replies to anyone.
 */
export async function sendReplies(items: { id: string; text: string }[]): Promise<SentRepliesDTO> {
  const database = await db()
  const batch = items.slice(0, REPLIES.perClick)
  const left = items.length - batch.length
  const rows = await database
    .select()
    .from(replies)
    .where(
      inArray(
        replies.id,
        batch.map((item) => item.id),
      ),
    )
  const channels = await listChannels()
  const clients = new Map<string, OAuthClient>()
  const sent: SentRepliesDTO['sent'] = []
  const notes: string[] = []
  let stopped = false
  let missing = 0
  for (const item of batch) {
    const row = rows.find((r) => r.id === item.id)
    const text = item.text.trim()
    const channel = channels.find((c) => c.id === row?.channelId)
    if (!row || !channel) missing++
    if (!row || !channel || row.status === 'replied' || !text) continue
    // Marked first, so a second click (or another tab) can't post it again.
    const [claimed] = await database
      .update(replies)
      .set({ status: 'replied', draft: text })
      .where(and(eq(replies.id, row.id), ne(replies.status, 'replied')))
      .returning()
    if (!claimed) continue
    try {
      const client = clients.get(channel.id) ?? clientFromRefresh(channel.refreshToken)
      clients.set(channel.id, client)
      const replyId = await replyToComment(client, row.id, text)
      await database.update(replies).set({ replyId }).where(eq(replies.id, row.id))
      sent.push({ id: row.id, replyId, text })
    } catch (error) {
      // Not posted: it waits again, with your text kept.
      await database.update(replies).set({ status: row.status, draft: text }).where(eq(replies.id, row.id))
      notes.push(`The reply to ${row.author || 'a viewer'} was not posted: ${reason(error)}`)
      if (explainGoogleError(error)) {
        stopped = true
        break
      }
    }
  }
  if (missing) {
    notes.push(
      `${plural(missing, 'comment')} ${missing === 1 ? 'is' : 'are'} no longer listed (deleted, or on a video out over ${REPLIES.days} days), so not answered. Check again for the latest.`,
    )
  }
  if (left > 0 && !stopped) {
    notes.push(
      `${left} approved ${left === 1 ? 'reply is' : 'replies are'} left: Cutroom posts ${REPLIES.perClick} a click, because each reply uses 50 of the 10,000 YouTube quota units a day that uploads need too. Click Post again for the rest.`,
    )
  }
  return { sent, notes }
}
