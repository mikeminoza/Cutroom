import { describe, expect, it } from 'vitest'
import { localizationsOf } from '../src/google'
import { languageName, translationBasis } from '../src/types'

describe('titles and descriptions in other languages', () => {
  it("become YouTube's localizations, without the video's own language or empty ones", () => {
    expect(
      localizationsOf(
        [
          { language: 'es', title: 'Por qué despiertas a las 3', description: 'Hola' },
          { language: 'en', title: 'Why you wake at 3', description: 'Hi' },
          { language: 'fr', title: '  ', description: 'Vide' },
          { language: 'de', title: 'x'.repeat(120), description: 'y'.repeat(6000) },
        ],
        'en',
      ),
    ).toEqual({
      es: { title: 'Por qué despiertas a las 3', description: 'Hola' },
      de: { title: 'x'.repeat(100), description: 'y'.repeat(5000) },
    })
    expect(localizationsOf([], 'en')).toBeNull()
    expect(localizationsOf(undefined, 'en')).toBeNull()
  })

  it('know when a translation was made from other text', () => {
    expect(translationBasis('Title', 'Text')).toBe(translationBasis('Title', 'Text'))
    expect(translationBasis('Title', 'Text')).not.toBe(translationBasis('Title!', 'Text'))
    expect(translationBasis('Title', 'Text')).not.toBe(translationBasis('Title', 'Text.'))
    expect(languageName('fil')).toBe('Filipino')
    expect(languageName('xx')).toBe('xx')
  })
})
