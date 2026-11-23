// Second-chance titles: which of the channel's own videos are off to a slow start, so another
// title (one of the options Cutroom wrote, or your own) could get YouTube to try it with viewers
// again. Worked out from the stats the daily refresh stores, next to the same "usual" as hits
// (hits.ts), with no AI. Shared by the Grow page, the Publish step and their tests. Nothing here
// changes anything on YouTube: that only happens when you click (google.ts, retitleVideo).
import { HIT, type HitCandidate, withUsual } from './hits'
import type { PostDetails, TitleChange } from './types'

export const SLOW = {
  /**
   * A slow start is views under this share of the usual: a third. Not half, because the usual is
   * what the others have now, after up to 4 weeks out, while this one may have had 2 days (only
   * today's count is kept, not what they had at its age). Many videos have well under half their
   * first month's views on day 2, so half would flag a normal start; under a third is a video
   * YouTube has mostly stopped showing. The bar is the same at every age, so it only gets fairer
   * as the video ages, and a video that catches up drops off the list by itself.
   */
  share: 1 / 3,
  /** Public this long (in days) when its views were counted: before that, it is too early to say. */
  minDays: 2,
  /** By 4 weeks most of its views are in, and a new title rarely brings it back. */
  maxDays: HIT.settledDays,
  /** A usual below this is a handful of views, where a few either way would decide it. */
  minUsual: 30,
  /** After a title change, wait for views counted this many days later before offering again. */
  restDays: 7,
}

/** A posted video as the slow-start rule sees it. */
export interface SlowCandidate extends HitCandidate {
  /** When its title was last changed from Cutroom (ISO); null = never. */
  titleChangedAt: string | null
}

export interface SlowStart {
  /** The views its peers usually have: their median (hits.ts, withUsual). */
  usual: number
  /** How many videos the usual is worked out from. */
  peers: number
}

const DAY = 86_400_000

/**
 * The videos off to a slow start, newest first: public for at least 2 days and under 4 weeks when
 * their views were counted, with under a third of the usual views (see SLOW). A video whose title
 * was changed in the last week is left to the new title, judged again on views counted a week
 * after the change. Public videos only: the caller leaves out the others, as for hits.
 */
export function findSlowStarters<T extends SlowCandidate>(videos: T[]): (T & SlowStart)[] {
  return withUsual(videos)
    .filter(({ video, age, usual }) => {
      if (age < SLOW.minDays || age >= SLOW.maxDays || usual < SLOW.minUsual) return false
      if (video.titleChangedAt) {
        const since = (Date.parse(video.fetchedAt) - Date.parse(video.titleChangedAt)) / DAY
        if (!(since >= SLOW.restDays)) return false
      }
      return video.views / usual < SLOW.share
    })
    .map(({ video, usual, peers }) => ({ ...video, usual: Math.round(usual), peers }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

/** The title changes made on this upload; none when it isn't on YouTube. */
export function titleChangesOf(
  post: Pick<PostDetails, 'titleChanges'>,
  videoId: string | null,
): TitleChange[] {
  if (!videoId) return []
  return (post.titleChanges ?? []).filter((change) => change.videoId === videoId)
}

/**
 * Why YouTube would refuse this title, or null when it's fine: it needs one, of at most 100
 * characters, without < or >.
 */
export function titleProblem(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return 'Write a title.'
  if (trimmed.length > 100) return `YouTube allows 100 characters; this one has ${trimmed.length}.`
  if (/[<>]/.test(trimmed)) return "YouTube doesn't allow < or > in titles."
  return null
}
