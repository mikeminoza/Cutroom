// Reviewing a video before it goes out: finding a passage the AI quoted in the script, and the
// checks on the Publish step that need no AI (title, thumbnail, description, chapters, rights).
import type { PostDetails, VideoFormat } from './types'

/** Text as a regular expression that matches it literally. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where `passage` is in `text`: the exact text found there (its own spaces and line breaks), or
 * null. Quotes from an AI often differ only in white space, curly quotes or a trailing full stop.
 */
export function findPassage(text: string, passage: string): string | null {
  const wanted = passage.trim()
  if (!wanted) return null
  if (text.includes(wanted)) return wanted
  const words = wanted
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => literal(word).replace(/"/g, '["“”]').replace(/'/g, "['‘’]"))
  if (words.length === 0) return null
  const pattern = new RegExp(words.join('\\s+'))
  const found = pattern.exec(text)?.[0]
  if (found) return found
  // Without its last punctuation mark ("…sleep." quoted for "…sleep,").
  const bare = wanted.replace(/[.,;:!?…]+$/, '')
  return bare !== wanted ? findPassage(text, bare) : null
}

export type CheckLevel = 'ok' | 'look' | 'fix'

export interface PostCheck {
  id: string
  level: CheckLevel
  title: string
  detail: string
  /** Where it is fixed: a step of the project. */
  step: 'script' | 'images' | 'preview' | 'publish'
}

export interface PostCheckInput {
  post: PostDetails
  format: VideoFormat
  /** Seconds. */
  duration: number
  thumbnailUrl: string | null
  musicUrl: string | null
  artStyle: string
  /** Scenes without a picture. */
  missingPictures: number
}

const SHORT_TITLE = 60
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )

/**
 * Everything worth checking before posting that needs no AI, worst first: what YouTube would
 * refuse or do badly (fix), what usually costs views or money (look), and what is fine (ok).
 */
export function postChecks(input: PostCheckInput): PostCheck[] {
  const { post, format, duration } = input
  const checks: PostCheck[] = []
  const add = (
    id: string,
    level: CheckLevel,
    title: string,
    detail: string,
    step: PostCheck['step'] = 'publish',
  ) => checks.push({ id, level, title, detail, step })
  const ai = post.aiFill !== false
  const isShort = format === 'portrait'

  const title = post.title.trim()
  if (!title) {
    if (ai)
      add(
        'title',
        'look',
        'No title yet',
        'Gemini writes one when the video posts. Write or pick one now to check it.',
      )
    else add('title', 'fix', 'No title', 'Write a title: with Gemini off, the video would get a basic one.')
  } else if (title.length > 100) {
    add('title', 'fix', 'Title too long', `YouTube allows 100 characters; this one has ${title.length}.`)
  } else if (title.length > SHORT_TITLE) {
    add(
      'title',
      'look',
      'Long title',
      `Phones cut titles after about ${SHORT_TITLE} characters (${title.length} now): put the hook first.`,
    )
  } else if ((title.match(/\b[A-Z]{4,}\b/g) ?? []).length >= 2) {
    add(
      'title',
      'look',
      'Several words in capitals',
      'More than one ALL-CAPS word reads as clickbait; keep one at most.',
    )
  } else {
    add('title', 'ok', 'Title', `${title.length} characters, short enough for phones.`)
  }

  if (!input.thumbnailUrl) {
    add(
      'thumbnail',
      'fix',
      'No thumbnail',
      "YouTube's own pick of a frame rarely gets clicked: make one with the thumbnail maker.",
    )
  } else {
    add('thumbnail', 'ok', 'Thumbnail', 'Set.')
  }

  const description = post.description.trim()
  const firstLine = description.split('\n')[0]?.trim() ?? ''
  if (!description) {
    if (ai) add('description', 'look', 'No description yet', 'Gemini writes one when the video posts.')
    else add('description', 'fix', 'No description', 'Write one: its first sentence is what search shows.')
  } else if (title && ![...words(title)].some((w) => words(firstLine).has(w))) {
    add(
      'description',
      'look',
      "The description's first line misses the title's words",
      'Search shows the first line: say what the video is about in the words of the title.',
    )
  } else if (firstLine.length > 160) {
    add('description', 'look', 'Long first line', 'Search shows about 150 characters: put the point first.')
  } else {
    add('description', 'ok', 'Description', 'Its first line says what the video is about.')
  }

  if (!isShort) {
    const chapters = [...post.chapters].sort((a, b) => a.start - b.start)
    const gaps = chapters.slice(1).map((c, i) => c.start - chapters[i].start)
    if (chapters.length > 0 && chapters[0].start > 0) {
      add(
        'chapters',
        'fix',
        'Chapters must start at 0:00',
        'YouTube ignores chapters whose first one is not at 0:00.',
      )
    } else if (chapters.length > 0 && chapters.length < 3) {
      add('chapters', 'fix', 'Too few chapters', 'YouTube needs at least 3 chapters to show them.')
    } else if (gaps.some((gap) => gap < 10)) {
      add(
        'chapters',
        'fix',
        'Chapters too close together',
        'Each chapter must be at least 10 seconds long, or YouTube ignores them all.',
      )
    } else if (chapters.length === 0 && duration > 180) {
      add('chapters', 'look', 'No chapters', 'Chapters help viewers find their part and can show in search.')
    } else if (chapters.length) {
      add('chapters', 'ok', 'Chapters', `${chapters.length} chapters from 0:00.`)
    }
  }

  const tagLength = post.tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0) + 1, 0)
  if (tagLength > 500)
    add('tags', 'fix', 'Too many tags', `YouTube allows 500 characters of tags; these take ${tagLength}.`)
  else if (post.tags.length === 0 && !ai)
    add('tags', 'look', 'No tags', 'A few tags help YouTube with misspellings of your topic.')

  if (input.missingPictures > 0) {
    add(
      'pictures',
      'fix',
      `${input.missingPictures} ${input.missingPictures === 1 ? 'scene has' : 'scenes have'} no picture`,
      'The picture before stays on screen meanwhile.',
      'images',
    )
  }

  if (isShort && duration > 180) {
    add(
      'length',
      'fix',
      'Too long for a Short',
      `Shorts can be at most 3 minutes; this one is ${Math.round(duration)} seconds.`,
      'script',
    )
  } else if (!isShort && duration > 0 && duration < 480) {
    add(
      'length',
      'look',
      'Under 8 minutes',
      'From 8 minutes YouTube can place ads in the middle, and longer videos add watch hours faster. Only worth it if the video stays tight.',
      'script',
    )
  }

  if (post.madeForKids) {
    add(
      'kids',
      'look',
      'Marked as made for kids',
      'That turns off comments, the notification bell and personalised ads. Only if children are the audience.',
    )
  }
  if (input.musicUrl) {
    add(
      'music',
      'look',
      'Background music',
      'Only use music you have the rights to (YouTube Audio Library or licensed): a copyright claim takes the ad money.',
      'preview',
    )
  }
  if (/photo|realistic|lifelike|cinematic|35mm/i.test(input.artStyle) && !post.syntheticMedia) {
    add(
      'synthetic',
      'look',
      'Realistic AI pictures',
      'YouTube asks for its "altered or synthetic content" label on realistic AI-made people, places or events. Turn it on under Post details if that applies.',
    )
  }

  const order: Record<CheckLevel, number> = { fix: 0, look: 1, ok: 2 }
  return checks.sort((a, b) => order[a.level] - order[b.level])
}
