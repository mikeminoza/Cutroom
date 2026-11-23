// TikTok and Instagram Reels: posting a finished Short there by hand. Nothing here talks to those
// apps: you download the video, copy a caption and post it yourself, then mark it as posted. This
// builds the captions from the post details already written for YouTube (no AI), names the file
// and says where it can be downloaded from. Shared by the Publish step, the download route and
// their tests.
import type { CrossPlatform, PostDetails } from './types'

export const CROSS_PLATFORMS: { id: CrossPlatform; name: string; short: string }[] = [
  { id: 'tiktok', name: 'TikTok', short: 'TikTok' },
  { id: 'reels', name: 'Instagram Reels', short: 'Reels' },
]

export const CAPTION = {
  /** Instagram cuts a caption off at 2,200 characters (TikTok allows more): the limit for both. */
  limit: 2200,
  /** The hook: titles are at most 100 characters; this only guards against odd data. */
  hook: 150,
  /** The line from the description: both apps fold the caption after a line or two anyway. */
  line: 150,
  hashtags: {
    // On TikTok the caption sits over the video: a few topic hashtags help its search, more of
    // them only cover the picture.
    tiktok: 4,
    // Instagram allows 5 hashtags a post since December 2025 (30 before).
    reels: 5,
  } satisfies Record<CrossPlatform, number>,
  /** Longer hashtags are hard to read, and nobody types them. */
  hashtagLength: 30,
}

/**
 * Hashtags that only mean something on YouTube: Shorts' own (#Shorts, #shortsfeed, #viralshorts…),
 * YouTube itself, and asking to subscribe. #ShortStory and the like stay.
 */
function youtubeOnly(tag: string): boolean {
  return /^(youtube|yt)|^shorts?(feed|video|videos|viral|beta)?$|^(viral|trending)shorts?$|^subscribe$/.test(
    tag.toLowerCase(),
  )
}

/**
 * The hashtags for one app: the video's own hashtags first, then its tags of one or two words
 * (a longer search phrase makes an unreadable hashtag), without YouTube-only ones or repeats.
 */
export function crossPostHashtags(
  post: Pick<PostDetails, 'hashtags' | 'tags'>,
  platform: CrossPlatform,
): string[] {
  const words = [...post.hashtags, ...post.tags.filter((tag) => tag.trim().split(/\s+/).length <= 2)].map(
    (tag) => tag.replace(/[^\p{L}\p{N}_]/gu, ''),
  )
  const seen = new Set<string>()
  const picked: string[] = []
  for (const word of words) {
    const key = word.toLowerCase()
    // Hashtags of only digits don't work on Instagram.
    if (!/\p{L}/u.test(word) || word.length > CAPTION.hashtagLength || youtubeOnly(word) || seen.has(key)) {
      continue
    }
    seen.add(key)
    picked.push(`#${word}`)
  }
  return picked.slice(0, CAPTION.hashtags[platform])
}

/** Shortened to `max` characters at a whole word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** A sentence that belongs on YouTube only: chapters, links, hashtags, asking to subscribe. */
function youtubeLine(sentence: string): boolean {
  return (
    /^chapters:?$/i.test(sentence) ||
    /^\d{1,2}:\d{2}/.test(sentence) ||
    /^(#\S+\s*)+$/.test(sentence) ||
    /https?:\/\/|www\./i.test(sentence) ||
    /\bsubscrib|\byou ?tube\b/i.test(sentence)
  )
}

/**
 * The first sentence of the description worth reading off YouTube: not the title again, and not
 * chapters, links, hashtags or the channel's subscribe line.
 */
function descriptionLine(description: string, title: string): string {
  for (const line of description.split('\n')) {
    for (const sentence of line.trim().split(/(?<=[.!?…])\s+/)) {
      const text = sentence.trim()
      if (!text || youtubeLine(text) || plain(text) === plain(title)) continue
      return clip(text, CAPTION.line)
    }
  }
  return ''
}

/**
 * A caption ready to paste into TikTok or Instagram Reels: the hook (the title) first, a line from
 * the description, then a few hashtags for that app. At most about 470 characters, well within
 * the 2,200 both apps allow.
 */
export function crossPostCaption(
  post: Pick<PostDetails, 'title' | 'description' | 'hashtags' | 'tags'>,
  platform: CrossPlatform,
): string {
  const hook = clip(post.title.trim(), CAPTION.hook)
  const parts = [
    hook,
    descriptionLine(post.description, hook),
    crossPostHashtags(post, platform).join(' '),
  ].filter(Boolean)
  // TikTok shows the caption over the video, where every line covers some of it. Instagram shows
  // it under the video, where a blank line between the parts reads easier.
  return parts.join(platform === 'tiktok' ? '\n' : '\n\n')
}

/** The finished video's file name, from its title: "Why you wake up tired?" → why-you-wake-up-tired.mp4. */
export function videoFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    // Accents off Latin letters (é → e); other scripts keep theirs.
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const max = 80
  if (slug.length <= max) return `${slug || 'video'}.mp4`
  const cut = slug.slice(0, max + 1)
  const dash = cut.lastIndexOf('-')
  return `${dash > 0 ? cut.slice(0, dash) : cut.slice(0, max)}.mp4`
}

/** Where the finished video can be downloaded from, for posting it elsewhere. */
export type VideoSource =
  /** Through the app's own route, which names the file after the title. */
  | { kind: 'file'; href: string; name: string }
  /** Removed from storage after posting to free space: the copy on Google Drive. */
  | { kind: 'drive'; href: string }
  /** Not rendered yet. */
  | { kind: 'none' }

export function videoSource(project: {
  id: string
  title: string
  post: Pick<PostDetails, 'title'>
  outputUrl: string | null
  driveFileId: string | null
}): VideoSource {
  if (project.outputUrl) {
    return {
      kind: 'file',
      // Not the stored URL itself: Blob files are on another domain, where browsers ignore a
      // link's download name and save it as "video.mp4".
      href: `/api/projects/${project.id}/video`,
      name: videoFileName(project.post.title || project.title),
    }
  }
  if (project.driveFileId) {
    return { kind: 'drive', href: `https://drive.google.com/file/d/${project.driveFileId}/view` }
  }
  return { kind: 'none' }
}

/** The apps a Short was marked as posted on, in the order the Publish step shows them. */
export function postedOn(post: Pick<PostDetails, 'crossPosts'>): CrossPlatform[] {
  return CROSS_PLATFORMS.map((p) => p.id).filter((id) => post.crossPosts?.[id])
}
