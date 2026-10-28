import { describe, expect, it } from 'vitest'
import { retentionFromRows } from '../src/google'
import {
  biggestDrops,
  hookHold,
  retentionLesson,
  sceneDrops,
  topSearchTerms,
  watchingAt,
} from '../src/retention'

/**
 * A 100-second video: viewers leave slowly (0.3% a second), except 2% a second from 0:30 to 0:40.
 * Point i is at i + 1 seconds.
 */
const watching = (t: number) =>
  t <= 30 ? 1 - 0.003 * t : t <= 40 ? 0.91 - 0.02 * (t - 30) : 0.71 - 0.003 * (t - 40)
const curve = Array.from({ length: 100 }, (_, i) => watching(i + 1))
const scenes = [
  { start: 0, narration: 'Here is the hook.' },
  { start: 30, narration: 'Now a long, boring list of facts nobody asked for at all, really.' },
  { start: 40, narration: 'And the rest of the video.' },
]

describe('the retention curve', () => {
  it('reads between the 1% points', () => {
    expect(watchingAt(curve, 30, 100)).toBeCloseTo(0.91)
    expect(watchingAt(curve, 35, 100)).toBeCloseTo(0.81)
    expect(watchingAt(curve, 30.5, 100)).toBeCloseTo(0.9)
    // Before the first point its value holds; past the end, the last one.
    expect(watchingAt(curve, 0, 100)).toBeCloseTo(watching(1))
    expect(watchingAt(curve, 500, 100)).toBeCloseTo(watching(100))
    expect(hookHold(curve, 100)).toBeCloseTo(0.91)
  })

  it('finds the scene that lost the most beyond the usual pace', () => {
    const drops = sceneDrops(curve, scenes, 100)
    expect(drops.map((d) => [d.start, d.end])).toEqual([
      [0, 30],
      [30, 40],
      [40, 100],
    ])
    expect(drops[1].lost).toBeCloseTo(0.2)
    const [worst, ...rest] = biggestDrops(drops)
    expect(worst.index).toBe(1)
    expect(worst.excess).toBeGreaterThan(0.1)
    // The slow scenes lose less than the video's average pace: not flagged.
    expect(rest).toEqual([])
  })

  it('sums a video up for the script writer', () => {
    expect(retentionLesson({ title: 'Why you wake at 3 AM', duration: 100, retention: curve, scenes })).toBe(
      '"Why you wake at 3 AM" (1:40): 91% still watching at 0:30. Most left at 0:30 ("Now a long, boring list of facts nobody asked for at all,…", 20% left).',
    )
  })

  it('adds up search terms across videos, ignoring case', () => {
    expect(
      topSearchTerms([
        [
          { term: 'why cant i sleep', views: 30 },
          { term: '3am wake up', views: 10 },
        ],
        [{ term: 'Why cant I sleep ', views: 5 }],
      ]),
    ).toEqual([
      { term: 'why cant i sleep', views: 35 },
      { term: '3am wake up', views: 10 },
    ])
  })

  it("turns YouTube's report rows into 100 points, filling gaps", () => {
    const columns = ['elapsedVideoTimeRatio', 'audienceWatchRatio', 'relativeRetentionPerformance']
    const rows = [
      [0.01, 1.02, 0.6],
      [0.02, 0.98, 0.55],
      [0.04, 0.9, 0.5],
      [1, 0.4, 0.45],
    ]
    const parsed = retentionFromRows(columns, rows)
    expect(parsed?.retention).toHaveLength(100)
    expect(parsed?.retention.slice(0, 4)).toEqual([1.02, 0.98, 0.98, 0.9])
    expect(parsed?.retention[99]).toBe(0.4)
    expect(parsed?.relative?.[0]).toBe(0.6)
    expect(retentionFromRows(columns, [])).toBeNull()
  })
})
