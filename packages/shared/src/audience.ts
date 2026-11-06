// Where the channel's viewers are, next to the audience its videos are written for (the target
// audience in Channel setup). No AI: worked out from YouTube Analytics' views by country.
import type { Market } from './setup'
import type { CountryViews } from './types'

let names: Intl.DisplayNames | null = null

/** "United States" for "US"; YouTube's ZZ (and anything unknown) is "Unknown". */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return 'Unknown'
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' })
    const name = names.of(code)
    return name && name !== code && name !== 'Unknown Region' ? name : code
  } catch {
    return code
  }
}

/** Several videos' countries added up, most views first. */
export function addCountries(lists: CountryViews[][]): CountryViews[] {
  const total = new Map<string, CountryViews>()
  for (const list of lists) {
    for (const c of list) {
      const sum = total.get(c.country) ?? { country: c.country, views: 0, minutes: 0 }
      sum.views += c.views
      sum.minutes += c.minutes
      total.set(c.country, sum)
    }
  }
  return [...total.values()].sort((a, b) => b.views - a.views || a.country.localeCompare(b.country))
}

/** Fewer views than this say more about who shared the video than about the audience. */
export const ENOUGH_VIEWS = 50
/** The target country's share of views below which the channel is drifting away from it. */
export const MARKET_SHARE = 0.3

export interface AudienceVerdict {
  level: 'ok' | 'look' | 'info'
  text: string
}

const percent = (n: number) => `${Math.round(n * 100)}%`

/**
 * Whether the viewers are the audience the videos are written for. null with too few views to
 * say. `market` is the target audience from Channel setup, null when none is set.
 */
export function audienceVerdict(countries: CountryViews[], market: Market | null): AudienceVerdict | null {
  const total = countries.reduce((n, c) => n + c.views, 0)
  if (total < ENOUGH_VIEWS || countries.length === 0) return null
  const top = countries[0]
  const share = (code: string) => (countries.find((c) => c.country === code)?.views ?? 0) / total
  if (!market) {
    return {
      level: 'info',
      text: `${percent(share(top.country))} of views come from ${countryName(top.country)}. Pick who your videos are for in Channel setup, and Cutroom writes scripts, titles and ideas for that country.`,
    }
  }
  const mine = share(market.code)
  if (top.country === market.code) {
    return {
      level: 'ok',
      text: `${percent(mine)} of views come from ${market.name}, the audience you write for.`,
    }
  }
  if (mine >= MARKET_SHARE) {
    return {
      level: 'ok',
      text: `${percent(mine)} of views come from ${market.name}, the audience you write for; the most from ${countryName(top.country)} (${percent(share(top.country))}).`,
    }
  }
  return {
    level: 'look',
    text: `Only ${percent(mine)} of views come from ${market.name}, the audience you write for; the most from ${countryName(top.country)} (${percent(share(top.country))}). YouTube recommends a video to people like those who watch it, so views from elsewhere steer it away from ${market.name}, where ads also pay more per view than in most countries. Share new videos with viewers there rather than with friends and family elsewhere, and keep titles, topics and references written for them.`,
  }
}
