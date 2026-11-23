// Answering viewers' comments from Cutroom (Performance → Comments to answer): which comments
// still wait for the channel's reply, and how much one check or click may do. No AI here: Gemini
// drafts replies only when asked (ai.ts draftReplies), and nothing is posted without a click.
import type { CommentThread } from './google'

export type ReplyStatus = 'waiting' | 'skipped' | 'replied'

export const REPLIES = {
  /**
   * Videos out this many days are read. Replies matter most while a video is new (Grow the
   * channel), and on a small channel nearly all of a video's comments come in its first two weeks.
   */
  days: 14,
  /** The most videos one check reads, newest first: 1 YouTube quota unit each. */
  videos: 20,
  /** Opening the page reads YouTube again once the last check is this old. */
  freshMinutes: 60,
  /** Comments one Gemini call drafts: short replies, so many fit in one answer. */
  perDraft: 30,
  /**
   * Replies one click posts. Each costs 50 of YouTube's 10,000 quota units a day, which uploads
   * (about 1,600 each) need too: 10 is 500 units.
   */
  perClick: 10,
}

const answeredBy = (thread: CommentThread, you: Set<string>) =>
  you.has(thread.authorChannelId) || thread.replyAuthors.some((author) => you.has(author))

/**
 * Comments that still wait for a reply: not your own, not in a thread you already replied in, and
 * ones YouTube takes a reply on. `you` are the YouTube ids of your connected channels: a reply from
 * any of them is yours.
 */
export function waitingComments(threads: CommentThread[], you: Iterable<string>): CommentThread[] {
  const yours = new Set([...you].filter(Boolean))
  return threads.filter((thread) => thread.canReply && thread.text.trim() && !answeredBy(thread, yours))
}

/**
 * YouTube sends only a few replies with each thread. When it has more and none of those sent are
 * yours, the rest are read (1 quota unit) before calling it unanswered.
 */
export function needsAllReplies(thread: CommentThread, you: Iterable<string>): boolean {
  const yours = new Set([...you].filter(Boolean))
  return thread.replies > thread.replyAuthors.length && !answeredBy(thread, yours)
}
