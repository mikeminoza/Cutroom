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

/** How a scene's picture comes in: a hard cut, a crossfade from the previous picture, or a dip through black. */
export type Transition = 'cut' | 'crossfade' | 'fade-black'

export const TRANSITIONS: Transition[] = ['cut', 'crossfade', 'fade-black']

/** Scenes written before transitions were rendered hold free text ("dissolve", "fade"...). */
export function normalizeTransition(value: string | null | undefined): Transition {
  const v = (value ?? '').trim().toLowerCase()
  if ((TRANSITIONS as string[]).includes(v)) return v as Transition
  if (/black|dip/.test(v)) return 'fade-black'
  if (/cross|dissolve|fade|blend|mix/.test(v)) return 'crossfade'
  return 'cut'
}

export type TtsProvider = 'gemini' | 'elevenlabs'

export interface VoiceSettings {
  provider: TtsProvider
  /** Gemini: a prebuilt voice name. ElevenLabs: a voice id. */
  voice: string
  /** Gemini only: delivery for the whole read, e.g. "warm, unhurried documentary narrator". */
  style: string
}

export const DEFAULT_VOICE: VoiceSettings = { provider: 'gemini', voice: 'Kore', style: '' }

/** Gemini's prebuilt voices and the character Google describes for each. */
export const GEMINI_VOICES: { name: string; character: string }[] = [
  { name: 'Kore', character: 'Firm' },
  { name: 'Charon', character: 'Informative' },
  { name: 'Puck', character: 'Upbeat' },
  { name: 'Zephyr', character: 'Bright' },
  { name: 'Fenrir', character: 'Excitable' },
  { name: 'Leda', character: 'Youthful' },
  { name: 'Orus', character: 'Firm' },
  { name: 'Aoede', character: 'Breezy' },
  { name: 'Callirrhoe', character: 'Easy-going' },
  { name: 'Autonoe', character: 'Bright' },
  { name: 'Enceladus', character: 'Breathy' },
  { name: 'Iapetus', character: 'Clear' },
  { name: 'Umbriel', character: 'Easy-going' },
  { name: 'Algieba', character: 'Smooth' },
  { name: 'Despina', character: 'Smooth' },
  { name: 'Erinome', character: 'Clear' },
  { name: 'Algenib', character: 'Gravelly' },
  { name: 'Rasalgethi', character: 'Informative' },
  { name: 'Laomedeia', character: 'Upbeat' },
  { name: 'Achernar', character: 'Soft' },
  { name: 'Alnilam', character: 'Firm' },
  { name: 'Schedar', character: 'Even' },
  { name: 'Gacrux', character: 'Mature' },
  { name: 'Pulcherrima', character: 'Forward' },
  { name: 'Achird', character: 'Friendly' },
  { name: 'Zubenelgenubi', character: 'Casual' },
  { name: 'Vindemiatrix', character: 'Gentle' },
  { name: 'Sadachbia', character: 'Lively' },
  { name: 'Sadaltager', character: 'Knowledgeable' },
  { name: 'Sulafat', character: 'Warm' },
]

/** YouTube numbers for a posted video, refreshed daily. Analytics fields need the analytics permission. */
export interface VideoStats {
  views: number
  likes: number
  comments: number
  watchMinutes: number | null
  averageViewSeconds: number | null
  averageViewPercent: number | null
  subscribersGained: number | null
  publishedAt: string | null
  fetchedAt: string
}

export interface TemplateCharacter {
  name: string
  description: string
  images: { url: string; key: string }[]
}

/** Everything a series reuses for each new episode. Files are copies owned by the series. */
export interface SeriesTemplate {
  topic: string
  audience: string
  tone: string
  language: string
  artStyle: string
  format: VideoFormat
  resolution: Resolution
  captionStyle: CaptionStyle
  mode: PostingMode
  targetMinutes: number
  pace: number
  notes: string
  textOverlays: boolean
  musicUrl: string | null
  musicName: string | null
  musicVolume: number
  voice: VoiceSettings | null
  channelId: string | null
  /** YouTube's id of that channel, so episodes still find it after a disconnect and reconnect. */
  channelYoutubeId?: string | null
  post: {
    categoryId: string
    privacy: Privacy
    madeForKids: boolean
    playlistId: string
    language: string
    tags: string[]
  }
  characters: TemplateCharacter[]
}

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

/** Where a character stands in a layered scene. */
export type LayerSide = 'left' | 'center' | 'right'
export const LAYER_SIDES: LayerSide[] = ['left', 'center', 'right']

/**
 * A scene picture built from layers: a background from the Library with a character's pose (a
 * cut-out with a transparent background) in front. A scene with its own uploaded picture shows
 * that instead. URLs point at the Library's files, shared by every video that uses them.
 */
export interface SceneLayer {
  backgroundUrl: string | null
  /** The background's name, as shown in the editor. */
  background: string
  poseUrl: string | null
  /** The same pose with the eyes closed: the character blinks now and then. */
  blinkUrl: string | null
  character: string
  pose: string
  side: LayerSide
}

/** One pose of a Library character: a cut-out, optionally with an eyes-closed twin for blinking. */
export interface CharacterPose {
  id: string
  name: string
  url: string
  key: string
  blinkUrl: string | null
  blinkKey: string | null
}

/** What viewers say in the comments on a channel's recent videos, summed up by Gemini. */
export interface CommentInsights {
  /** How viewers feel overall, in two or three sentences. */
  summary: string
  liked: string[]
  /** Videos viewers asked for, ready to become ideas. */
  requests: { title: string; angle: string }[]
  improve: string[]
  /** Questions worth answering in a pinned comment or a next video. */
  questions: string[]
}

/** True when a scene shows a picture: its own upload, or a background and/or pose. */
export function hasPicture(scene: { imageUrl: string | null; layer?: SceneLayer | null }): boolean {
  return Boolean(scene.imageUrl || scene.layer?.backgroundUrl || scene.layer?.poseUrl)
}

/** The picture to show for a scene in a strip: its own, or its background, or its pose. */
export function thumbnailOf(scene: { imageUrl: string | null; layer?: SceneLayer | null }): string | null {
  return scene.imageUrl ?? scene.layer?.backgroundUrl ?? scene.layer?.poseUrl ?? null
}

/**
 * Where a pose stands, as fractions of the frame, shared by the editor and the render so both
 * agree: it fits in a box `width` × `height`, `margin` in from the side it stands on, its bottom
 * `sink` of its own height below the frame edge (the room it bounces into without showing a gap).
 */
export function poseBox(format: VideoFormat): {
  width: number
  height: number
  margin: number
  sink: number
} {
  return format === 'portrait'
    ? { width: 0.92, height: 0.56, margin: 0.04, sink: 0.035 }
    : { width: 0.6, height: 0.8, margin: 0.06, sink: 0.035 }
}

/** An empty layer to start picking from. */
export const EMPTY_LAYER: SceneLayer = {
  backgroundUrl: null,
  background: '',
  poseUrl: null,
  blinkUrl: null,
  character: '',
  pose: '',
  side: 'center',
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
  /** Background + pose, used when the scene has no uploaded picture. */
  layer: SceneLayer | null
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
  /** `scene`: the scene index the chapter starts at (see refreshChapters). */
  chapters: { start: number; title: string; scene?: number }[]
  thumbnailIdeas: string[]
  thumbnailPrompt: string
  categoryId: string
  privacy: Privacy
  madeForKids: boolean
  playlistId: string
  language: string
  /** Gemini fills in an empty title, description and tags when publishing (on unless turned off). */
  aiFill?: boolean
  /**
   * Posted from the channel as a comment once the video is public: a question viewers want to
   * answer. '' = none.
   */
  comment?: string
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
  comment: '',
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
  /** Default voice for AI voice-overs. */
  voice: VoiceSettings
  /** Which events send a message to the channels set up in the environment. */
  notifications: NotificationPrefs
  /** What the channel is about. New videos (outside a series) start from it. */
  niche: ChannelNiche
  /** Shorts made from each long video right after it posts. */
  shorts: AutoShorts
}

export interface AutoShorts {
  /** How many Short drafts to make from each long video; 0 turns it off. */
  count: number
  /** The longest a Short may be, in seconds (YouTube allows up to 180). */
  maxSeconds: number
}

/**
 * The channel's niche: its subject, narrator, look and usual length, plus its main characters
 * (from the Library). Every new video outside a series starts from it; each video can still
 * change its own copy on the Brief step. Empty text fields change nothing.
 */
export interface ChannelNiche {
  /** What the channel is about, e.g. "Funny 2D cartoon: Cappy the capybara's everyday adventures". */
  description: string
  /** How the narration sounds, e.g. "Cappy narrates in third person: 'Capybara wants to eat.'". */
  narration: string
  audience: string
  tone: string
  artStyle: string
  /** Usual length of a regular video. Shorts stay at about a minute. */
  targetMinutes: number
  /** Seconds each picture stays on screen in a regular video. */
  pace: number
  /** Library characters added to every new video, the narrator first. */
  characterIds: string[]
}

export const EMPTY_NICHE: ChannelNiche = {
  description: '',
  narration: '',
  audience: '',
  tone: '',
  artStyle: '',
  targetMinutes: 5,
  pace: 3,
  characterIds: [],
}

export interface NotificationPrefs {
  approval: boolean
  failed: boolean
  posted: boolean
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
  voice: DEFAULT_VOICE,
  notifications: { approval: true, failed: true, posted: true },
  niche: EMPTY_NICHE,
  shorts: { count: 2, maxSeconds: 60 },
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
