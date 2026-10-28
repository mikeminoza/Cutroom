import { describe, expect, it } from 'vitest'
import { BREAKOUT, breakoutScore, pickBreakouts } from '../src/breakouts'

const video = (id: string, views: number, channelAverage: number, channelId = `ch-${id}`) => ({
  id,
  channelId,
  views,
  channelAverage,
})

describe('breakout videos', () => {
  it("scores views against the channel's usual views, never below the floor", () => {
    expect(breakoutScore(video('a', 60_000, 4_000))).toBe(15)
    // A tiny channel counts as getting at least BREAKOUT.floor views.
    expect(breakoutScore(video('b', 6_000, 50))).toBe(6_000 / BREAKOUT.floor)
  })

  it('keeps big outliers only, best first, once each, and never your own', () => {
    const picked = pickBreakouts(
      [
        video('small-hit', 4_000, 100),
        video('steady', 90_000, 60_000),
        video('hit', 60_000, 4_000),
        video('mine', 500_000, 1_000, 'UC-mine'),
        video('bigger', 400_000, 10_000),
        video('hit', 60_000, 4_000),
      ],
      ['UC-mine'],
    )
    expect(picked.map((v) => [v.id, v.score])).toEqual([
      ['bigger', 40],
      ['hit', 15],
    ])
  })
})
