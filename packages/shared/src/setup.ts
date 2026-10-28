// Channel setup: the viewers a channel is made for, posting-slot presets, the description footer
// and channel keywords. Used by the Channel setup page, the AI prompts and the YouTube helpers.
import type { PostingSlot } from './types'

export interface Market {
  /** ISO country code, as YouTube's channel country takes it. */
  code: string
  /** "United States", for pickers. */
  label: string
  /** "the United States", for sentences. */
  name: string
  /** YouTube language code for uploads and the channel. */
  language: string
  /** Where the posting slots are set, so they follow that country's daylight saving. */
  timezone: string
  /** Short name of that time zone in tips, e.g. "ET". */
  zone: string
  /** How scripts, titles and descriptions are written for these viewers. */
  writing: string
}

export const MARKETS: Market[] = [
  {
    code: 'US',
    label: 'United States',
    name: 'the United States',
    language: 'en',
    timezone: 'America/New_York',
    zone: 'ET',
    writing:
      'American English spelling, US units (dollars, miles, pounds, °F) and references US viewers know',
  },
  {
    code: 'GB',
    label: 'United Kingdom',
    name: 'the United Kingdom',
    language: 'en',
    timezone: 'Europe/London',
    zone: 'UK time',
    writing: 'British English spelling, pounds sterling, miles, °C and references UK viewers know',
  },
  {
    code: 'CA',
    label: 'Canada',
    name: 'Canada',
    language: 'en',
    timezone: 'America/Toronto',
    zone: 'ET',
    writing: 'Canadian English spelling, metric units, Canadian dollars and references Canadian viewers know',
  },
  {
    code: 'AU',
    label: 'Australia',
    name: 'Australia',
    language: 'en',
    timezone: 'Australia/Sydney',
    zone: 'Sydney time',
    writing:
      'Australian English spelling, metric units, Australian dollars and references Australian viewers know',
  },
]

export function marketOf(code: string | null | undefined): Market | null {
  return MARKETS.find((m) => m.code === code) ?? null
}

/** The line every writing prompt gets, or '' when no market is set. */
export function marketNote(code: string | null | undefined): string {
  const market = marketOf(code)
  return market ? `Write for viewers in ${market.name}: ${market.writing}.` : ''
}

/** Videos a week the schedule presets offer. */
export const CADENCES = [2, 3, 5, 7] as const
export type Cadence = (typeof CADENCES)[number]

/**
 * Days for each cadence (0 = Sunday). Weekends first: in the largest study of US uploads they did
 * a few percent better than weekdays, while the hour barely mattered.
 */
const PRESET_DAYS: Record<Cadence, number[]> = {
  2: [0, 6],
  3: [0, 4, 6],
  5: [0, 1, 3, 4, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
}

/** Posting slots for a cadence, all at one time (in the schedule's time zone). */
export function presetSlots(perWeek: Cadence, time = '15:00'): PostingSlot[] {
  return PRESET_DAYS[perWeek].map((day) => ({ day, time }))
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Thursday, Saturday and Sunday": the slots' days in week order, Monday first. */
export function slotDays(slots: PostingSlot[], short = false): string {
  const days = [...new Set(slots.map((s) => s.day))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const names = days.map((d) => (short ? DAY_NAMES[d].slice(0, 3) : DAY_NAMES[d]))
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "New videos every Thursday, Saturday and Sunday.", or '' without slots. */
export function scheduleLine(slots: PostingSlot[]): string {
  if (slots.length === 0) return ''
  const days = new Set(slots.map((s) => s.day))
  return days.size === 7 ? 'New videos every day.' : `New videos every ${slotDays(slots)}.`
}

/** "15:00" -> "3:00 PM". */
export function clockLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The channel as YouTube has it: shown and edited on the YouTube channel page, checked on Channel setup. */
export interface ChannelDetails {
  id: string
  title: string
  /** ISO country code, or '' when not set. */
  country: string
  defaultLanguage: string
  description: string
  keywords: string[]
  /**
   * 'allowed' once the account is verified, which custom thumbnails and videos over 15 minutes
   * need; 'eligible' or 'disallowed' before that.
   */
  longUploads: string | null
  /** "@name", or '' when the channel has no handle. */
  handle: string
  publishedAt: string | null
  /** The profile picture. */
  thumbnail: string | null
  /** null when the channel hides its subscriber count. */
  subscribers: number | null
  views: number
  videos: number
  /** Id of the video shown to people who haven't subscribed, or ''. */
  trailer: string
  /** YouTube's final say, which its own review can set even when the channel declared otherwise. */
  madeForKids: boolean | null
  /** What the channel declared. */
  selfDeclaredMadeForKids: boolean | null
  privacy: string | null
  /** What YouTube thinks the channel is about, e.g. "Entertainment". */
  topics: string[]
  uploadsPlaylistId: string | null
}

/** "https://en.wikipedia.org/wiki/Video_game_culture" -> "Video game culture". */
export function topicName(url: string): string {
  const last = url.split('/').filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(last).replace(/_/g, ' ')
  } catch {
    return last.replace(/_/g, ' ')
  }
}

/** YouTube caps the channel keywords at 500 characters. */
export const KEYWORDS_LIMIT = 500

/** Channel keywords as YouTube stores them: space-separated, multi-word ones in quotes. */
export function formatChannelKeywords(keywords: string[]): string {
  let text = ''
  const seen = new Set<string>()
  for (const raw of keywords) {
    const keyword = raw.replace(/"/g, '').replace(/\s+/g, ' ').trim()
    if (!keyword || seen.has(keyword.toLowerCase())) continue
    const piece = keyword.includes(' ') ? `"${keyword}"` : keyword
    const next = text ? `${text} ${piece}` : piece
    if (next.length > KEYWORDS_LIMIT) break
    seen.add(keyword.toLowerCase())
    text = next
  }
  return text
}

export function parseChannelKeywords(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// The road to monetization: the YouTube Partner Program's thresholds and how close a channel is.

/** What a channel has so far, toward the Partner Program. */
export interface GrowthNumbers {
  subscribers: number
  /** Watch hours on long videos (not Shorts) over the last 365 days; null = unknown. */
  longHours: number | null
  /** Shorts views over the last 90 days; null = unknown. */
  shortsViews: number | null
  /** Uploads over the last 90 days. */
  recentUploads: number
  /** Gained over the last 28 days, for the pace; null = unknown. */
  pace: { subscribers: number; longHours: number; shortsViews: number } | null
  /** YouTube couldn't split long videos from Shorts: the hours include Shorts. */
  combined: boolean
}

export interface Goal {
  label: string
  have: number | null
  need: number
  /** Days to reach it at the pace of the last 28 days: 0 = reached, null = not at this pace or can't tell. */
  days: number | null
  /**
   * For a total over a rolling window (watch hours over 12 months, Shorts views over 90 days):
   * where it levels off if the pace of the last 28 days holds, as old views drop out. null otherwise.
   */
  ceiling: number | null
}

export interface MonetizationPath {
  label: string
  goals: Goal[]
  ready: boolean
  /** Days until every goal is reached at the current pace, null when one can't tell. */
  days: number | null
}

export interface MonetizationTier {
  id: 'early' | 'ads'
  name: string
  unlocks: string
  paths: MonetizationPath[]
  ready: boolean
}

/** Days to go from `have` to `need` gaining `per28` every 28 days (0 when there, null when stuck). */
function daysTo(have: number | null, need: number, per28: number | null | undefined): number | null {
  if (have === null) return null
  if (have >= need) return 0
  if (!per28 || per28 <= 0) return null
  return Math.ceil(((need - have) / per28) * 28)
}

/**
 * The same for a total over the last `window` days. If the pace holds, each day adds the pace and
 * drops one of the older days (taken as average days of the window so far), so the total moves
 * toward pace × window and never passes it: below `need`, it isn't reached at this pace (null).
 */
function windowDays(have: number | null, need: number, per28: number | null | undefined, window: number) {
  const ceiling =
    have !== null && per28 !== null && per28 !== undefined ? Math.round((per28 / 28) * window) : null
  if (have === null) return { days: null, ceiling }
  if (have >= need) return { days: 0, ceiling }
  if (ceiling === null || ceiling < need) return { days: null, ceiling }
  const daily = (per28 as number) / 28 - have / window
  return { days: daily > 0 ? Math.ceil((need - have) / daily) : null, ceiling }
}

/**
 * The Partner Program's two levels and their two ways in each (long videos or Shorts), as YouTube
 * sets them: 1,000 subscribers with 4,000 public watch hours in a year or 10 million Shorts views in
 * 90 days for ad revenue; 500 subscribers, 3 uploads in 90 days and 3,000 hours or 3 million Shorts
 * views for memberships, Super Thanks and Shopping.
 */
export function monetizationTiers(n: GrowthNumbers): MonetizationTier[] {
  const subscribers = (need: number): Goal => ({
    label: 'Subscribers',
    have: n.subscribers,
    need,
    days: daysTo(n.subscribers, need, n.pace?.subscribers),
    ceiling: null,
  })
  const hours = (need: number): Goal => ({
    label: n.combined ? 'Watch hours, last 12 months' : 'Watch hours on long videos, last 12 months',
    have: n.longHours,
    need,
    ...windowDays(n.longHours, need, n.pace?.longHours, 365),
  })
  const shorts = (need: number): Goal => ({
    label: 'Shorts views, last 90 days',
    have: n.shortsViews,
    need,
    ...windowDays(n.shortsViews, need, n.pace?.shortsViews, 90),
  })
  const uploads: Goal = {
    label: 'Uploads, last 90 days',
    have: n.recentUploads,
    need: 3,
    days: n.recentUploads >= 3 ? 0 : null,
    ceiling: null,
  }
  const path = (label: string, goals: Goal[]): MonetizationPath => {
    const ready = goals.every((g) => g.have !== null && g.have >= g.need)
    const days = goals.some((g) => g.days === null)
      ? null
      : Math.max(0, ...goals.map((g) => g.days as number))
    return { label, goals, ready, days }
  }
  const tier = (id: MonetizationTier['id'], name: string, unlocks: string, paths: MonetizationPath[]) => ({
    id,
    name,
    unlocks,
    paths,
    ready: paths.some((p) => p.ready),
  })
  return [
    tier(
      'early',
      'Early access',
      'Channel memberships, Super Thanks, Super Chat and Shopping. No ad money yet.',
      [
        path('With long videos', [subscribers(500), uploads, hours(3_000)]),
        path('With Shorts', [subscribers(500), uploads, shorts(3_000_000)]),
      ],
    ),
    tier(
      'ads',
      'Ad revenue',
      'A share of the ads on your videos and of YouTube Premium, plus everything above.',
      [
        path('With long videos', [subscribers(1_000), hours(4_000)]),
        path('With Shorts', [subscribers(1_000), shorts(10_000_000)]),
      ],
    ),
  ]
}
