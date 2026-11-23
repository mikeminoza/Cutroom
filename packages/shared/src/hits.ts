// Which of the channel's own videos are hits: far more views than its videos usually get. Worked
// out from the stats the daily refresh stores, with no AI. Shared by the daily cron (which tells
// you about each new one), Ideas → Your hits, and their tests. The same "usual" also tells which
// videos are off to a slow start (second-chance.ts).
import type { VideoFormat } from './types'

export const HIT = {
  /** Views over the usual views. */
  minTimes: 3,
  /** Fewer views than this is never a hit, however few the others got. */
  minViews: 100,
  /** Other videos to compare with: with fewer, "usual" is a guess. */
  minPeers: 5,
  /** By this age most of a video's views are in. */
  settledDays: 28,
}

/** A posted video as the hit rule sees it. */
export interface HitCandidate {
  id: string
  /** The channel it is on (any stable key; null when unknown). */
  channel: string | null
  format: VideoFormat
  views: number
  /** When it went public (ISO). */
  publishedAt: string
  /** When `views` was counted (ISO). */
  fetchedAt: string
}

export interface Hit {
  /** The views its peers usually have: their median. */
  usual: number
  /** Views over usual, to one decimal. */
  times: number
  /** How many videos the usual is worked out from. */
  peers: number
}

const DAY = 86_400_000

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** A video next to the views its peers usually have (see withUsual). */
export interface WithUsual<T> {
  video: T
  /** Days it had been public when its views were counted. */
  age: number
  /** The median views of its peers, unrounded. */
  usual: number
  /** How many videos the usual is worked out from. */
  peers: number
}

/**
 * Each video with the views its peers usually have: the one "usual" behind both hits and slow
 * starters (second-chance.ts), so the two never disagree about what's normal for the channel.
 *
 * The usual is the median views of the other videos on the same channel in the same format (long
 * videos with long videos, Shorts with Shorts) that have been out at least as long as it has,
 * where anything out 4 weeks or more counts as settled. With fewer than 5 of those, no verdict:
 * the video is left out, as is one counted before it went public.
 *
 * Why: only today's count is stored for each video, not its history, so we can't see what the
 * others had at the same age. But views only go up, so a video out longer had at most today's
 * count back then. Past 4 weeks most views are in, so an old video is compared with every settled
 * one, and never with videos still gathering views. The median, so one earlier hit doesn't raise
 * the bar for the next; five to compare with, so one or two videos never decide it.
 */
export function withUsual<T extends HitCandidate>(videos: T[]): WithUsual<T>[] {
  const aged = videos
    .map((video) => ({ video, age: (Date.parse(video.fetchedAt) - Date.parse(video.publishedAt)) / DAY }))
    // Counted before it went public (or with no date): nothing to judge yet.
    .filter(({ age }) => Number.isFinite(age) && age >= 0)
  return aged.flatMap(({ video, age }) => {
    const bar = Math.min(age, HIT.settledDays)
    const peers = aged.filter(
      (other) =>
        other.video.id !== video.id &&
        other.video.channel === video.channel &&
        other.video.format === video.format &&
        other.age >= bar,
    )
    if (peers.length < HIT.minPeers) return []
    return [{ video, age, usual: median(peers.map((p) => p.video.views)), peers: peers.length }]
  })
}

/**
 * The hits among posted videos, newest first.
 *
 * The rule: a video is a hit when it has at least 3 times the usual views (and at least 100), the
 * usual being its peers' median (withUsual).
 *
 * Why: next to videos out at least as long, which had at most today's count when they were its
 * age, a young video is never flattered by being young. It has to beat what the others got in all
 * so far, so "not a hit" only means "not yet" (the cron looks again every day, and the bar gets
 * fairer as it ages). An old video is compared with settled ones only, never with videos still
 * gathering views, which would flatter it.
 */
export function findHits<T extends HitCandidate>(videos: T[]): (T & Hit)[] {
  const hits: (T & Hit)[] = []
  for (const { video, usual, peers } of withUsual(videos)) {
    if (video.views < HIT.minViews) continue
    const times = video.views / Math.max(usual, 1)
    if (times < HIT.minTimes) continue
    hits.push({ ...video, usual: Math.round(usual), times: Math.round(times * 10) / 10, peers })
  }
  return hits.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}
