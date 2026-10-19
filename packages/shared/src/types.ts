// Domain types shared by the web app and the worker.

export type VideoFormat = 'landscape' | 'portrait'
export type Resolution = '720p' | '1080p'
export type PostingMode = 'autopilot' | 'review'
export type Motion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'none'
export type ImageFit = 'cover' | 'contain'
export type CaptionStyle = 'highlight' | 'line' | 'off'
export type Privacy = 'private' | 'unlisted' | 'public'

export type ProjectStatus =
  | 'draft'
  | 'scripted'
  | 'timed'
  | 'ready'
  | 'rendering'
  | 'awaiting_approval'
  | 'rendered'
  | 'uploading'
  | 'scheduled'
  | 'published'
  | 'failed'

export const MOTIONS: Motion[] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'none']

export interface Word {
  text: string
  start: number
  end: number
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  duration: number
  segments: TranscriptSegment[]
  words: Word[]
}

export interface SceneInput {
  id: string
  index: number
  start: number
  end: number
  narration: string
  visual: string
  imagePrompt: string
  characters: string[]
  shot: string
  motion: Motion
  onScreenText: string
  transition: string
  notes: string
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
  fit: ImageFit
  focusX: number
  focusY: number
}

export interface CharacterInput {
  id: string
  name: string
  description: string
  images: { url: string; key: string }[]
}

export interface PostDetails {
  titleOptions: string[]
  title: string
  description: string
  tags: string[]
  hashtags: string[]
  chapters: { start: number; title: string }[]
  thumbnailIdeas: string[]
  thumbnailPrompt: string
  categoryId: string
  privacy: Privacy
  madeForKids: boolean
  playlistId: string
  language: string
}

export const EMPTY_POST: PostDetails = {
  titleOptions: [],
  title: '',
  description: '',
  tags: [],
  hashtags: [],
  chapters: [],
  thumbnailIdeas: [],
  thumbnailPrompt: '',
  categoryId: '22',
  privacy: 'public',
  madeForKids: false,
  playlistId: '',
  language: 'en',
}

export interface PostingSlot {
  // 0 = Sunday … 6 = Saturday
  day: number
  // "18:00", in the schedule's time zone
  time: string
}

export interface AppSettings {
  timezone: string
  slots: PostingSlot[]
  defaults: {
    privacy: Privacy
    categoryId: string
    madeForKids: boolean
    playlistId: string
    language: string
    tags: string[]
    descriptionFooter: string
    mode: PostingMode
    resolution: Resolution
    captionStyle: CaptionStyle
  }
  freeBlobAfterPosting: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: 'UTC',
  slots: [
    { day: 1, time: '18:00' },
    { day: 3, time: '18:00' },
    { day: 5, time: '18:00' },
  ],
  defaults: {
    privacy: 'public',
    categoryId: '22',
    madeForKids: false,
    playlistId: '',
    language: 'en',
    tags: [],
    descriptionFooter: '',
    mode: 'review',
    resolution: '720p',
    captionStyle: 'highlight',
  },
  freeBlobAfterPosting: true,
}

// YouTube video categories most creators use. Ids are YouTube's own.
export const YOUTUBE_CATEGORIES: { id: string; name: string }[] = [
  { id: '1', name: 'Film & Animation' },
  { id: '2', name: 'Autos & Vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets & Animals' },
  { id: '17', name: 'Sports' },
  { id: '19', name: 'Travel & Events' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News & Politics' },
  { id: '26', name: 'Howto & Style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
]

export const ART_STYLES = [
  '3D animated, soft lighting, Pixar-like',
  'Anime, clean line art, vivid colors',
  'Photorealistic, cinematic lighting, 35mm film',
  'Flat vector illustration, bold shapes',
  'Watercolor storybook illustration',
  'Comic book, inked lines, halftone shading',
]

export function outputSize(format: VideoFormat, resolution: Resolution): { width: number; height: number } {
  const long = resolution === '1080p' ? 1920 : 1280
  const short = resolution === '1080p' ? 1080 : 720
  return format === 'portrait' ? { width: short, height: long } : { width: long, height: short }
}
