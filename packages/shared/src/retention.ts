// Where viewers stop watching, scene by scene: YouTube's retention curve (the share still watching
// at each 1% of a video) laid over the video's own scenes. Used by the Performance page and by the
// script writer, so the next video learns from where the last ones lost people.
import { formatTimecode } from './timing'

/** The share still watching `seconds` into a video `duration` long (between YouTube's 1% points). */
export function watchingAt(retention: number[], seconds: number, duration: number): number {
  if (retention.length === 0 || !(duration > 0)) return 0
  const position = (Math.min(Math.max(seconds, 0), duration) / duration) * retention.length
  // Point i is at (i + 1) / length of the video; before the first one, its value holds.
  if (position <= 1) return retention[0]
  const below = Math.floor(position) - 1
  const above = Math.min(retention.length - 1, below + 1)
  const fraction = position - Math.floor(position)
  return retention[below] + (retention[above] - retention[below]) * fraction
}

export interface SceneDrop {
  /** Index of the scene. */
  index: number
  start: number
  end: number
  narration: string
  /** Share of the starting viewers who left during the scene. */
  lost: number
  /** How much more left than the video's usual pace would lose in the same time. */
  excess: number
}

/**
 * How many viewers each scene lost, next to the video's usual pace of losing them (the last 5% is
 * left out of the pace: end screens always lose people). Scenes run from their start to the next
 * scene's start.
 */
export function sceneDrops(
  retention: number[],
  scenes: { start: number; narration: string }[],
  duration: number,
): SceneDrop[] {
  if (retention.length === 0 || !(duration > 0)) return []
  const tail = duration * 0.95
  const pace = (watchingAt(retention, 0, duration) - watchingAt(retention, tail, duration)) / tail
  return scenes.map((scene, i) => {
    const start = i === 0 ? 0 : Math.min(scene.start, duration)
    const end = i < scenes.length - 1 ? Math.min(scenes[i + 1].start, duration) : duration
    const lost = watchingAt(retention, start, duration) - watchingAt(retention, end, duration)
    return { index: i, start, end, narration: scene.narration, lost, excess: lost - pace * (end - start) }
  })
}

/** The scenes that lost the most viewers beyond the usual pace, worst first (1% or more). */
export function biggestDrops(drops: SceneDrop[], count = 3): SceneDrop[] {
  return drops
    .filter((d) => d.excess >= 0.01)
    .sort((a, b) => b.excess - a.excess)
    .slice(0, count)
}

/** The share still watching after the opening `seconds` (or at the end of a shorter video). */
export function hookHold(retention: number[], duration: number, seconds = 30): number {
  return watchingAt(retention, Math.min(seconds, duration), duration)
}

const percent = (n: number) => `${Math.round(n * 100)}%`
const excerpt = (text: string, words = 12) => {
  const all = text.trim().split(/\s+/).filter(Boolean)
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ')
}

/**
 * One line for the script writer about where a posted video lost viewers, e.g.
 * `"Why cats knock things over" (3:10): 61% still watching at 0:30. Most left at 0:42 ("…", 9% left).`
 */
export function retentionLesson(video: {
  title: string
  duration: number
  retention: number[]
  scenes: { start: number; narration: string }[]
}): string {
  const opening = Math.min(30, video.duration)
  const parts = [
    `"${video.title || 'Untitled'}" (${formatTimecode(video.duration, false)}): ${percent(hookHold(video.retention, video.duration))} still watching at ${formatTimecode(opening, false)}.`,
  ]
  const worst = biggestDrops(sceneDrops(video.retention, video.scenes, video.duration), 2)
  if (worst.length) {
    parts.push(
      `Most left at ${worst
        .map((d) => `${formatTimecode(d.start, false)} ("${excerpt(d.narration)}", ${percent(d.lost)} left)`)
        .join(' and ')}.`,
    )
  }
  return parts.join(' ')
}

/** Search terms of several videos, added up: the searches that find the channel, most views first. */
export function topSearchTerms(
  lists: { term: string; views: number }[][],
  count = 15,
): { term: string; views: number }[] {
  const totals = new Map<string, { term: string; views: number }>()
  for (const list of lists) {
    for (const { term, views } of list) {
      const key = term.trim().toLowerCase()
      if (!key) continue
      const entry = totals.get(key) ?? { term: term.trim(), views: 0 }
      entry.views += views
      totals.set(key, entry)
    }
  }
  return [...totals.values()].sort((a, b) => b.views - a.views).slice(0, count)
}
