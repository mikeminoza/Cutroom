import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findPassage, type PostCheckInput, postChecks } from '../src/review'
import { EMPTY_POST } from '../src/types'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  generateContent.mockReset()
})
afterEach(() => {
  delete process.env.GEMINI_API_KEY
})

const reply = (data: unknown) => generateContent.mockResolvedValueOnce({ text: JSON.stringify(data) })

describe('finding a quoted passage', () => {
  const script =
    'Look at you right now,\nscrolling in the dark like a sleepy goblin.\n\nYou slapped “snooze” three times.'

  it('finds it as written in the script, whatever the spaces, line breaks or quote marks', () => {
    expect(findPassage(script, 'scrolling in the dark')).toBe('scrolling in the dark')
    expect(findPassage(script, 'right now, scrolling in the dark')).toBe('right now,\nscrolling in the dark')
    expect(findPassage(script, 'You slapped "snooze" three times.')).toBe('You slapped “snooze” three times.')
    // A quote ending in a different punctuation mark.
    expect(findPassage(script, 'Look at you right now.')).toBe('Look at you right now')
    expect(findPassage(script, 'a sleepy dragon')).toBeNull()
    expect(findPassage(script, '  ')).toBeNull()
  })
})

describe('the final check', () => {
  const base: PostCheckInput = {
    post: {
      ...EMPTY_POST,
      title: 'Why you wake up feeling like trash',
      description: 'Why you wake up tired, and the 10-minute fix.\n\nMore.',
      tags: ['sleep'],
      chapters: [
        { start: 0, title: 'Intro' },
        { start: 40, title: 'Adenosine' },
        { start: 120, title: 'The fix' },
      ],
    },
    format: 'landscape',
    duration: 540,
    thumbnailUrl: '/api/files/thumb.png',
    musicUrl: null,
    artStyle: 'Crude MS Paint doodles',
    missingPictures: 0,
  }
  const levels = (input: PostCheckInput) => Object.fromEntries(postChecks(input).map((c) => [c.id, c.level]))

  it('passes a well-packaged video', () => {
    expect(levels(base)).toEqual({ title: 'ok', thumbnail: 'ok', description: 'ok', chapters: 'ok' })
  })

  it('flags what YouTube refuses or handles badly, worst first', () => {
    const checks = postChecks({
      ...base,
      thumbnailUrl: null,
      missingPictures: 3,
      post: {
        ...base.post,
        title: 'Why you wake up feeling like absolute trash every morning and how to fix it now',
        description: 'A capybara explains biology.',
        chapters: [
          { start: 5, title: 'Intro' },
          { start: 60, title: 'Middle' },
          { start: 90, title: 'End' },
        ],
        tags: Array.from({ length: 60 }, (_, i) => `sleep science tag ${i}`),
        madeForKids: true,
      },
      musicUrl: '/api/files/music.mp3',
      artStyle: 'Photorealistic, cinematic lighting',
    })
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(byId.thumbnail.level).toBe('fix')
    expect(byId.pictures).toMatchObject({ level: 'fix', title: '3 scenes have no picture', step: 'images' })
    expect(byId.chapters).toMatchObject({ level: 'fix', title: 'Chapters must start at 0:00' })
    expect(byId.tags.level).toBe('fix')
    expect(byId.title).toMatchObject({ level: 'look', title: 'Long title' })
    expect(byId.description.level).toBe('look')
    expect(byId.kids.level).toBe('look')
    expect(byId.music).toMatchObject({ level: 'look', step: 'preview' })
    expect(byId.synthetic.level).toBe('look')
    const order = checks.map((c) => c.level)
    expect(order.indexOf('look')).toBeGreaterThan(order.lastIndexOf('fix'))
  })

  it("knows YouTube's chapter rules and lengths", () => {
    const chapters = (list: { start: number; title: string }[]) =>
      postChecks({ ...base, post: { ...base.post, chapters: list } }).find((c) => c.id === 'chapters')
    expect(
      chapters([
        { start: 0, title: 'A' },
        { start: 30, title: 'B' },
      ])?.title,
    ).toBe('Too few chapters')
    expect(
      chapters([
        { start: 0, title: 'A' },
        { start: 5, title: 'B' },
        { start: 60, title: 'C' },
      ])?.title,
    ).toBe('Chapters too close together')
    expect(chapters([])).toMatchObject({ level: 'look', title: 'No chapters' })
    // Under 8 minutes: a nudge, not a rule; a Short over 3 minutes is refused.
    expect(levels({ ...base, duration: 300 }).length).toBe('look')
    expect(levels({ ...base, format: 'portrait', duration: 200 }).length).toBe('fix')
    expect(levels({ ...base, format: 'portrait', duration: 50 }).chapters).toBeUndefined()
    // An empty title waits for Gemini, unless Gemini is off for this video.
    expect(levels({ ...base, post: { ...base.post, title: '' } }).title).toBe('look')
    expect(levels({ ...base, post: { ...base.post, title: '', aiFill: false } }).title).toBe('fix')
  })
})

describe('the script doctor', () => {
  const script =
    'Look at you right now, scrolling in the dark.\n\nIt is basic biology. Adenosine builds up while you are awake.'
  const voice = {
    narration: 'Sarcastic older brother',
    audience: 'US adults',
    tone: 'Roasting',
    rules: ['Hook first'],
  }

  it('keeps only suggestions for words that are in the script, as written there', async () => {
    const { reviewScript } = await import('../src/ai')
    reply({
      edits: [
        {
          original: 'Look at you right now, scrolling in the dark',
          suggestion: 'Look at you, doom-scrolling in the dark',
          kind: 'funnier',
          why: 'Sharper.',
        },
        { original: 'Words that are not there', suggestion: 'x', kind: 'tighter', why: '' },
        { original: 'It is basic biology.', suggestion: 'It is basic biology.', kind: 'cut', why: 'Same.' },
        { original: 'It is basic biology.', suggestion: 'Biology.', kind: 'zany', why: 'Shorter.' },
      ],
      claims: [
        {
          quote: 'Adenosine builds up while you are awake',
          verdict: 'ok',
          note: 'Well established.',
          safer: 'ignored',
        },
        { quote: 'Not in the script', verdict: 'wrong', note: '', safer: '' },
      ],
    })
    const review = await reviewScript({ script, title: 'Why you wake up tired', voice })
    expect(review.edits).toEqual([
      {
        original: 'Look at you right now, scrolling in the dark',
        suggestion: 'Look at you, doom-scrolling in the dark',
        kind: 'funnier',
        why: 'Sharper.',
      },
      { original: 'It is basic biology.', suggestion: 'Biology.', kind: 'clearer', why: 'Shorter.' },
    ])
    expect(review.claims).toEqual([
      {
        quote: 'Adenosine builds up while you are awake',
        verdict: 'ok',
        note: 'Well established.',
        safer: '',
      },
    ])
    const prompt = String(generateContent.mock.calls.at(-1)?.[0].contents)
    expect(prompt).toContain("Narrator's voice: Sarcastic older brother")
    expect(prompt).toContain('- Hook first')
    expect(prompt).toContain('YouTube removes medical misinformation')
  })

  it('rates the hook and replaces only the real opening', async () => {
    const { checkHook } = await import('../src/ai')
    reply({
      score: 14,
      verdict: 'Strong start.',
      problems: ['A', ''],
      promise: { kept: false, note: 'The title is about mornings.' },
      replaces: 'It is basic biology.',
      openings: [{ text: 'You hit snooze three times. Bad news.', why: 'Relatable.' }],
    })
    const hook = await checkHook({
      script,
      title: 'Mornings',
      thumbnailText: 'WHY SO TIRED',
      voice,
      lessons: ['x'],
    })
    expect(hook.score).toBe(10)
    expect(hook.problems).toEqual(['A'])
    // Gemini picked a sentence from the middle: the first sentence is replaced instead.
    expect(hook.replaces).toBe('Look at you right now, scrolling in the dark.')
    expect(hook.openings).toEqual([{ text: 'You hit snooze three times. Bad news.', why: 'Relatable.' }])
    const prompt = String(generateContent.mock.calls.at(-1)?.[0].contents)
    expect(prompt).toContain('Thumbnail text: WHY SO TIRED')
    expect(prompt).toContain("Where viewers left this channel's recent videos:\n- x")
  })

  it('reviews the packaging in at most five notes', async () => {
    const { reviewPackaging } = await import('../src/ai')
    reply({
      notes: [
        { level: 'fix', text: 'The title promises a fix the opening never mentions.' },
        { level: 'great', text: 'Thumbnail and title work together.' },
        { level: 'good', text: '' },
      ],
    })
    const notes = await reviewPackaging({
      title: 'T',
      thumbnailText: '',
      thumbnailIdea: '',
      description: '',
      opening: '',
      audience: '',
    })
    expect(notes).toEqual([
      { level: 'fix', text: 'The title promises a fix the opening never mentions.' },
      { level: 'look', text: 'Thumbnail and title work together.' },
    ])
  })
})
