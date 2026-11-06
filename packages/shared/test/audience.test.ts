import { describe, expect, it } from 'vitest'
import { addCountries, audienceVerdict, countryName } from '../src/audience'
import { countriesFromRows } from '../src/google'
import { marketOf } from '../src/setup'

const us = marketOf('US')

describe('where the viewers are', () => {
  it('reads YouTube’s country report, most views first, without unknown or empty rows', () => {
    const rows = [
      ['PH', 40, 120.6],
      ['US', 90, 300],
      ['ZZ', 5, 10],
      ['', 3, 1],
      ['ca', 0, 0],
    ]
    expect(countriesFromRows(['country', 'views', 'estimatedMinutesWatched'], rows)).toEqual([
      { country: 'US', views: 90, minutes: 300 },
      { country: 'PH', views: 40, minutes: 121 },
      { country: 'ZZ', views: 5, minutes: 10 },
    ])
    expect(countriesFromRows(['views'], rows)).toEqual([])
  })

  it('names countries, and adds up several videos', () => {
    expect(countryName('US')).toBe('United States')
    expect(countryName('PH')).toBe('Philippines')
    expect(countryName('ZZ')).toBe('Unknown')
    expect(
      addCountries([
        [
          { country: 'US', views: 10, minutes: 30 },
          { country: 'PH', views: 5, minutes: 9 },
        ],
        [{ country: 'PH', views: 20, minutes: 40 }],
      ]),
    ).toEqual([
      { country: 'PH', views: 25, minutes: 49 },
      { country: 'US', views: 10, minutes: 30 },
    ])
  })

  it('says nothing until there are enough views', () => {
    expect(audienceVerdict([{ country: 'PH', views: 30, minutes: 0 }], us)).toBeNull()
    expect(audienceVerdict([], us)).toBeNull()
  })

  it('warns when the audience written for is a small share of the views', () => {
    const verdict = audienceVerdict(
      [
        { country: 'PH', views: 160, minutes: 0 },
        { country: 'US', views: 30, minutes: 0 },
        { country: 'IN', views: 10, minutes: 0 },
      ],
      us,
    )
    expect(verdict?.level).toBe('look')
    expect(verdict?.text).toMatch(
      /^Only 15% of views come from the United States, the audience you write for; the most from Philippines \(80%\)\./,
    )
  })

  it('is content when the audience written for leads, or holds a good share', () => {
    expect(
      audienceVerdict(
        [
          { country: 'US', views: 70, minutes: 0 },
          { country: 'PH', views: 30, minutes: 0 },
        ],
        us,
      ),
    ).toEqual({ level: 'ok', text: '70% of views come from the United States, the audience you write for.' })
    expect(
      audienceVerdict(
        [
          { country: 'PH', views: 55, minutes: 0 },
          { country: 'US', views: 45, minutes: 0 },
        ],
        us,
      )?.level,
    ).toBe('ok')
  })

  it('suggests picking an audience when none is set', () => {
    const verdict = audienceVerdict([{ country: 'GB', views: 80, minutes: 0 }], null)
    expect(verdict?.level).toBe('info')
    expect(verdict?.text).toMatch(/^100% of views come from United Kingdom\. Pick who your videos are for/)
  })
})
