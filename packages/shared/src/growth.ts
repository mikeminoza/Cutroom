// Growing the channel: where it stands (how many videos are out, how steady the posting is) and
// the few things most worth doing next, for the Grow page. Worked out from the projects, no AI.
import type { ProjectStatus, VideoFormat } from './types'

export interface GrowthProject {
  id: string
  title: string
  format: VideoFormat
  status: ProjectStatus
  /** When YouTube makes it public (ISO), for videos scheduled ahead. */
  scheduledAt: string | null
  updatedAt: string
  stats: { views: number; averageViewPercent: number | null; publishedAt: string | null } | null
}

/** A new channel's stages, by long videos out. One video's numbers say little; ten start to. */
export const STAGES = [
  {
    id: 'first',
    title: 'Get 10 videos out',
    from: 0,
    detail:
      'YouTube learns who to show your videos to from the first ones. Post on your schedule and judge nothing yet.',
  },
  {
    id: 'learn',
    title: 'Find what works',
    from: 10,
    detail: 'Compare which videos people clicked and kept watching, and make more of the best two or three.',
  },
  {
    id: 'grow',
    title: 'Grow what works',
    from: 30,
    detail: 'Turn what works into series, keep the schedule, and let Shorts bring new viewers to them.',
  },
] as const

export type StageId = (typeof STAGES)[number]['id']

/** The stage for this many long videos out: its index in STAGES. */
export function stageIndex(longVideos: number): number {
  let index = 0
  STAGES.forEach((stage, i) => {
    if (longVideos >= stage.from) index = i
  })
  return index
}

const DAY = 86_400_000
/** Out, on the way out or finished: nothing left to make. */
const MADE: ProjectStatus[] = ['scheduled', 'published', 'uploading', 'rendering', 'rendered']

/** When the video went public, or null while it isn't (yet). */
export function postedAt(project: GrowthProject, now: Date): Date | null {
  const scheduled = project.scheduledAt ? new Date(project.scheduledAt) : null
  if (project.status === 'scheduled' && scheduled && scheduled <= now) return scheduled
  if (project.status !== 'published') return null
  const at = project.stats?.publishedAt ?? project.scheduledAt ?? project.updatedAt
  return new Date(at)
}

/** Videos still being made, the most recently worked on first. */
export function inProgress(projects: GrowthProject[]): GrowthProject[] {
  return projects
    .filter((p) => !MADE.includes(p.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export interface Pace {
  /** Long videos and Shorts out in all. */
  long: number
  shorts: number
  /** Out in the last 28 days. */
  recentLong: number
  recentShorts: number
  /** Set to go public in the next 7 days. */
  upcoming: number
  /** Days since the newest video went public, null before the first. */
  daysSinceLast: number | null
}

export function pace(projects: GrowthProject[], now: Date): Pace {
  const out = projects
    .map((p) => ({ p, at: postedAt(p, now) }))
    .filter((v): v is { p: GrowthProject; at: Date } => v.at !== null)
  const recent = out.filter((v) => now.getTime() - v.at.getTime() <= 28 * DAY)
  const week = now.getTime() + 7 * DAY
  const newest = Math.max(...out.map((v) => v.at.getTime()))
  return {
    long: out.filter((v) => v.p.format === 'landscape').length,
    shorts: out.filter((v) => v.p.format === 'portrait').length,
    recentLong: recent.filter((v) => v.p.format === 'landscape').length,
    recentShorts: recent.filter((v) => v.p.format === 'portrait').length,
    upcoming: projects.filter(
      (p) =>
        p.status === 'scheduled' &&
        p.scheduledAt &&
        new Date(p.scheduledAt) > now &&
        new Date(p.scheduledAt).getTime() <= week,
    ).length,
    daysSinceLast: out.length ? Math.floor((now.getTime() - newest) / DAY) : null,
  }
}

/** Long videos out, most viewed first; equal views, the better-watched first. */
export function bestVideos(projects: GrowthProject[], now: Date, count = 3): GrowthProject[] {
  return projects
    .filter((p) => p.format === 'landscape' && postedAt(p, now) && (p.stats?.views ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.stats?.views ?? 0) - (a.stats?.views ?? 0) ||
        (b.stats?.averageViewPercent ?? 0) - (a.stats?.averageViewPercent ?? 0),
    )
    .slice(0, count)
}

export type NextMove =
  | { kind: 'connect' }
  /** A video went public in the last day: answer its comments while it is new. */
  | { kind: 'reply'; project: GrowthProject; hours: number }
  | { kind: 'finish'; project: GrowthProject }
  /** Nothing is being made: start the next video. */
  | { kind: 'start'; upcoming: number; slots: number }
  /** A one-time step for the channel, not done yet. */
  | { kind: 'todo'; id: string }
  | { kind: 'double-down'; project: GrowthProject }
  /** The niche hasn't been searched for breakouts in a week. */
  | { kind: 'breakouts'; days: number | null }

export interface GrowthInput {
  now: Date
  projects: GrowthProject[]
  /** Posting slots a week. */
  slots: number
  youtube: boolean
  /** The one-time steps in the page's order, and whether each is done. */
  foundation: { id: string; done: boolean }[]
  /** When the niche was last searched for breakouts (ISO), null = never. */
  breakoutsScannedAt: string | null
  /** Searching for breakouts needs Gemini and a connected channel. */
  canScanBreakouts: boolean
}

/**
 * The few things most worth doing now, most urgent first: comments on a video that just went
 * out, the next video, then the channel's one-time steps, doubling down once there are ten videos
 * to compare, and a look at what is breaking out in the niche.
 */
export function nextMoves(input: GrowthInput, limit = 3): NextMove[] {
  const { now, projects } = input
  const moves: NextMove[] = []
  if (!input.youtube) moves.push({ kind: 'connect' })

  const justOut = projects
    .map((project) => ({ project, at: postedAt(project, now) }))
    .filter((v) => v.at && now.getTime() - v.at.getTime() < DAY)
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))[0]
  if (justOut?.at)
    moves.push({
      kind: 'reply',
      project: justOut.project,
      hours: Math.floor((now.getTime() - justOut.at.getTime()) / 3_600_000),
    })

  const making = inProgress(projects)[0]
  const { upcoming, long } = pace(projects, now)
  if (making) moves.push({ kind: 'finish', project: making })
  else moves.push({ kind: 'start', upcoming, slots: input.slots })

  const best = bestVideos(projects, now, 1)[0]
  if (stageIndex(long) > 0 && best) moves.push({ kind: 'double-down', project: best })

  const todo = input.foundation.find((step) => !step.done)
  if (todo) moves.push({ kind: 'todo', id: todo.id })

  if (input.canScanBreakouts) {
    const days = input.breakoutsScannedAt
      ? Math.floor((now.getTime() - new Date(input.breakoutsScannedAt).getTime()) / DAY)
      : null
    if (days === null || days >= 7) moves.push({ kind: 'breakouts', days })
  }
  return moves.slice(0, limit)
}
