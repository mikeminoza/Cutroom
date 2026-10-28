// Which recent videos count as breaking out: many more views than their channel usually gets.
// Shared by the weekly search (web server) and its tests.

export const BREAKOUT = {
  /** Fewer views than this is not a breakout, however small the channel. */
  minViews: 5_000,
  /** Views over the channel's usual views per video. */
  minScore: 3,
  /** The usual views of a channel never count as fewer than this, so tiny channels don't top the list. */
  floor: 1_000,
}

/** How many times its channel's usual views a video got. */
export function breakoutScore(video: { views: number; channelAverage: number }): number {
  return video.views / Math.max(video.channelAverage, BREAKOUT.floor)
}

/**
 * The breakouts among found videos, best first: each video once, none from the channels in
 * `exclude` (your own).
 */
export function pickBreakouts<
  T extends { id: string; channelId: string; views: number; channelAverage: number },
>(videos: T[], exclude: string[] = []): (T & { score: number })[] {
  const seen = new Set<string>()
  return videos
    .filter((v) => {
      if (!v.id || seen.has(v.id) || exclude.includes(v.channelId)) return false
      seen.add(v.id)
      return v.views >= BREAKOUT.minViews && breakoutScore(v) >= BREAKOUT.minScore
    })
    .map((v) => ({ ...v, score: Math.round(breakoutScore(v) * 10) / 10 }))
    .sort((a, b) => b.score - a.score)
}
