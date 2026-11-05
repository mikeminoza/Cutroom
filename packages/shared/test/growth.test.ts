import { describe, expect, it } from 'vitest'
import {
  bestVideos,
  type GrowthInput,
  type GrowthProject,
  inProgress,
  nextMoves,
  pace,
  postedAt,
  stageIndex,
} from '../src/growth'

const now = new Date('2026-11-05T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

let n = 0
const video = (over: Partial<GrowthProject> = {}): GrowthProject => ({
  id: `p${++n}`,
  title: `Video ${n}`,
  format: 'landscape',
  status: 'published',
  scheduledAt: null,
  updatedAt: daysAgo(40),
  stats: null,
  ...over,
})

const input = (over: Partial<GrowthInput> = {}): GrowthInput => ({
  now,
  projects: [],
  slots: 3,
  youtube: true,
  foundation: [],
  breakoutsScannedAt: daysAgo(1),
  canScanBreakouts: true,
  ...over,
})

describe('where the channel stands', () => {
  it('counts a scheduled video as out once its time has passed', () => {
    expect(postedAt(video({ status: 'scheduled', scheduledAt: daysAgo(1) }), now)).toEqual(
      new Date(daysAgo(1)),
    )
    expect(postedAt(video({ status: 'scheduled', scheduledAt: daysAgo(-2) }), now)).toBeNull()
    expect(postedAt(video({ status: 'ready' }), now)).toBeNull()
    // YouTube's own publish time wins over the slot.
    expect(
      postedAt(
        video({
          scheduledAt: daysAgo(3),
          stats: { views: 1, averageViewPercent: null, publishedAt: daysAgo(2) },
        }),
        now,
      ),
    ).toEqual(new Date(daysAgo(2)))
  })

  it('moves to the next stage at 10 and 30 long videos', () => {
    expect([0, 9, 10, 29, 30, 200].map(stageIndex)).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('works out the pace over the last 4 weeks and the next 7 days', () => {
    const projects = [
      video({ updatedAt: daysAgo(3) }),
      video({ updatedAt: daysAgo(40) }),
      video({ format: 'portrait', updatedAt: daysAgo(10) }),
      video({ status: 'scheduled', scheduledAt: daysAgo(-2) }),
      video({ status: 'scheduled', scheduledAt: daysAgo(-9) }),
      video({ status: 'timed', updatedAt: daysAgo(0) }),
    ]
    expect(pace(projects, now)).toEqual({
      long: 2,
      shorts: 1,
      recentLong: 1,
      recentShorts: 1,
      upcoming: 1,
      daysSinceLast: 3,
    })
    expect(pace([], now).daysSinceLast).toBeNull()
  })

  it('ranks the best long videos by views, then by how much of them people watched', () => {
    const stats = (views: number, averageViewPercent: number) => ({
      views,
      averageViewPercent,
      publishedAt: null,
    })
    const a = video({ stats: stats(500, 30) })
    const b = video({ stats: stats(900, 20) })
    const c = video({ stats: stats(500, 45) })
    const short = video({ format: 'portrait', stats: stats(9000, 80) })
    const unseen = video({ stats: stats(0, 0) })
    expect(bestVideos([a, b, c, short, unseen], now).map((v) => v.id)).toEqual([b.id, c.id, a.id])
  })

  it('lists what is still being made, the latest worked on first', () => {
    const older = video({ status: 'draft', updatedAt: daysAgo(5) })
    const newer = video({ status: 'awaiting_approval', updatedAt: daysAgo(1) })
    const done = [video(), video({ status: 'rendering' }), video({ status: 'rendered' })]
    expect(inProgress([older, ...done, newer]).map((p) => p.id)).toEqual([newer.id, older.id])
  })
})

describe('what to do next', () => {
  it('starts a brand-new channel with connecting YouTube and the first video', () => {
    const moves = nextMoves(
      input({ youtube: false, canScanBreakouts: false, foundation: [{ id: 'promise', done: false }] }),
    )
    expect(moves).toEqual([
      { kind: 'connect' },
      { kind: 'start', upcoming: 0, slots: 3 },
      { kind: 'todo', id: 'promise' },
    ])
  })

  it('puts the comments on a video that just went out first, then the video being made', () => {
    const fresh = video({
      status: 'scheduled',
      scheduledAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
    })
    const making = video({ status: 'timed', updatedAt: daysAgo(0) })
    const moves = nextMoves(input({ projects: [video(), fresh, making] }))
    expect(moves[0]).toEqual({ kind: 'reply', project: fresh, hours: 5 })
    expect(moves[1]).toEqual({ kind: 'finish', project: making })
  })

  it('doubles down on the best video once ten are out, before the one-time steps', () => {
    const projects = Array.from({ length: 10 }, (_, i) =>
      video({ stats: { views: 100 * (i + 1), averageViewPercent: 40, publishedAt: daysAgo(30 + i) } }),
    )
    const moves = nextMoves(input({ projects, foundation: [{ id: 'look', done: false }] }))
    expect(moves.map((m) => m.kind)).toEqual(['start', 'double-down', 'todo'])
    expect(moves[1]).toMatchObject({ project: { id: projects[9].id } })
  })

  it('skips steps that are done and suggests breakouts once a week', () => {
    const foundation = [
      { id: 'promise', done: true },
      { id: 'series', done: false },
    ]
    expect(nextMoves(input({ foundation, breakoutsScannedAt: daysAgo(8) }))).toEqual([
      { kind: 'start', upcoming: 0, slots: 3 },
      { kind: 'todo', id: 'series' },
      { kind: 'breakouts', days: 8 },
    ])
    expect(nextMoves(input({ breakoutsScannedAt: null }))).toContainEqual({ kind: 'breakouts', days: null })
    expect(nextMoves(input({ breakoutsScannedAt: daysAgo(2) })).map((m) => m.kind)).toEqual(['start'])
  })
})
