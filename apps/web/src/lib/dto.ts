// Shapes the browser receives from the API.
import type {
  CheckStatus,
  CheckStep,
  JobResult,
  JobStatus,
  JobStep,
  JobType,
  WorkerInfo,
} from '@cutroom/shared/protocol'
import type { ReplyStatus } from '@cutroom/shared/replies'
import type { GrowthNumbers } from '@cutroom/shared/setup'
import type {
  CaptionStyle,
  CharacterInput,
  CharacterPose,
  CommentInsights,
  CrossPlatform,
  PostDetails,
  PostingMode,
  ProjectStatus,
  Resolution,
  SceneInput,
  SceneLayer,
  SeriesTemplate,
  TitleChange,
  Transcript,
  VideoFormat,
  VideoInsights,
  VideoStats,
  VoiceSettings,
} from '@cutroom/shared/types'
import type { TaskKind, TaskStatus } from './tasks'

export interface ProjectDTO {
  id: string
  title: string
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
  script: string
  notes: string
  voiceoverUrl: string | null
  voiceoverName: string | null
  voiceoverDuration: number | null
  transcript: Transcript | null
  musicUrl: string | null
  musicName: string | null
  musicVolume: number
  thumbnailUrl: string | null
  post: PostDetails
  status: ProjectStatus
  scheduledAt: string | null
  youtubeVideoId: string | null
  driveFolderId: string | null
  /** The comment posted for viewers; '' when it could not be posted. */
  commentId: string | null
  driveFolderUrl: string | null
  driveFileId: string | null
  outputUrl: string | null
  srtUrl: string | null
  archived: boolean
  textOverlays: boolean
  soundEffects: boolean
  voice: VoiceSettings | null
  seriesId: string | null
  channelId: string | null
  /** Kept while the channel is disconnected, so the video waits for it. */
  channelYoutubeId: string | null
  stats: VideoStats | null
  sourceProjectId: string | null
  createdAt: string
  updatedAt: string
}

/** A scene's new layers, as Pick backgrounds and poses with AI saves them (composeProject). */
export interface SceneLayerChange {
  id: string
  layer: SceneLayer | null
}

export type SceneDTO = SceneInput
export type CharacterDTO = CharacterInput & { position: number }

export interface JobDTO {
  id: string
  type: JobType
  status: JobStatus
  steps: JobStep[]
  result: JobResult
  error: string | null
  approved: boolean
  progress: number | null
  progressStep: string | null
  progressDetail: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

/**
 * How long Gemini took lately (server/ai-calls.ts), for Settings → AI speed: by kind of work, and
 * the slowest calls themselves.
 */
export interface AiSpeedDTO {
  days: number
  kinds: {
    /** The kind of work, as the timing log names it ("storyboard", "script (live)"). */
    task: string
    calls: number
    /** Failed calls, and of those, how many ran out of time. */
    failed: number
    outOfTime: number
    /** Half the calls took at most this long. */
    typicalSeconds: number
    slowestSeconds: number
  }[]
  slowest: {
    task: string
    model: string
    seconds: number
    tries: number
    waitedSeconds: number
    writtenTokens: number | null
    error: string | null
    at: string
  }[]
}

/** AI work on the server (server/tasks.ts). */
export interface TaskDTO {
  id: string
  kind: TaskKind
  status: TaskStatus
  /** Set once it runs. */
  startedAt: string | null
  createdAt: string
  /** For pictures: the scenes it makes them for. */
  sceneIds: string[]
}

export interface ProjectFull {
  project: ProjectDTO
  scenes: SceneDTO[]
  characters: CharacterDTO[]
  jobs: { retime: JobDTO | null; publish: JobDTO | null; voice: JobDTO | null }
  /** AI work on it that is running, or queued, on the server, oldest first. */
  tasks: TaskDTO[]
  /** The newest Images → Generate missing, made on the server; null before the first. */
  pictures: PictureBatchDTO | null
}

/** Images → Generate missing: the scene pictures Gemini makes on the server (server/tasks.ts). */
export interface PictureBatchDTO {
  id: string
  /** Scenes done (made, not made, or not started after a stop) of all, for the progress bar. */
  done: number
  total: number
  /** Still being made. */
  running: boolean
  /** Pictures put on their scenes. */
  made: number
  /** The scenes Gemini didn't make a picture for, and why, in scene order. */
  failed: { sceneId: string; error: string }[]
  /** Why the rest was not made: you stopped it, or an error every picture would hit (billing). */
  stopped: string | null
  finishedAt: string | null
}

/** Ideas → Create drafts → written by Gemini on the server (server/drafting.ts draftBatch). */
export interface DraftBatchDTO {
  id: string
  /** The new drafts, in the order they are written. */
  drafts: {
    projectId: string
    title: string
    /** Waiting its turn, being written, or how it ended. */
    state: 'waiting' | 'writing' | 'full' | 'partial' | 'unwritten'
    /** What went wrong, for a draft not fully written. */
    note: string | null
  }[]
  /** What is written now (or next): which draft, counted from 1, and which part of it. */
  current: { draft: number; kind: TaskKind } | null
  /** Parts written (or given up) of all parts, for the progress bar. */
  done: number
  total: number
  /** Still being written. */
  running: boolean
  full: number
  partial: number
  /** Why the rest was not written: no Gemini key, the free daily limit, or you stopped it. */
  stopped: string | null
  createdAt: string
  finishedAt: string | null
}

export interface ProjectSummary {
  id: string
  title: string
  topic: string
  format: VideoFormat
  status: ProjectStatus
  duration: number
  scheduledAt: string | null
  youtubeVideoId: string | null
  updatedAt: string
  seriesId: string | null
  channelId: string | null
  stats: VideoStats | null
  /** Where a Short was also posted by hand. */
  crossPosts: CrossPlatform[]
  frames: { start: number; end: number; imageUrl: string | null }[]
  hasScript: boolean
  hasVoiceover: boolean
  timed: boolean
  job: { type: JobType; status: JobStatus; progress: number | null; detail: string | null } | null
}

export interface ChannelDTO {
  id: string
  youtubeId: string | null
  title: string
  email: string | null
  isDefault: boolean
  /** Connected with permission to read watch time and retention. */
  analytics: boolean
}

export interface StatusDTO {
  gemini: { configured: boolean; model: string; liteModel: string; imageModel: string; ttsModel: string }
  elevenlabs: { configured: boolean }
  google: { configured: boolean }
  /** The default channel. */
  youtube: { connected: boolean; email: string | null; label: string | null }
  channels: ChannelDTO[]
  drive: { connected: boolean; email: string | null; label: string | null }
  worker: {
    mode: 'render' | 'github'
    configured: boolean
    reachable: boolean
    url: string | null
    busy: boolean
  }
  notifications: { discord: boolean; telegram: boolean; email: boolean }
  storage: 'local' | 'blob'
  /** Browser uploads and the worker need the read-write token, not only the OIDC link. */
  blobToken: boolean
  database: 'neon' | 'local'
  auth: boolean
  /** The daily check (Vercel cron): on, off because CRON_SECRET is missing, or not on Vercel. */
  daily: 'on' | 'needs-secret' | 'local'
}

export interface SeriesDTO {
  id: string
  name: string
  description: string
  template: SeriesTemplate
  episodes: number
  createdAt: string
  updatedAt: string
}

export interface LibraryCharacterDTO {
  id: string
  name: string
  description: string
  images: { url: string; key: string }[]
  poses: CharacterPose[]
  createdAt: string
}

export interface LibraryBackgroundDTO {
  id: string
  name: string
  url: string
  key: string
  createdAt: string
}

export interface IdeaDTO {
  id: string
  title: string
  angle: string
  seriesId: string | null
  status: 'new' | 'used' | 'dismissed'
  projectId: string | null
  /** The hit of yours it follows up (Ideas → Your hits). */
  followUpOf: string | null
  createdAt: string
}

/** One of your own videos doing far better than usual (server/hits.ts). */
export interface HitDTO {
  /** The project. */
  id: string
  title: string
  format: VideoFormat
  youtubeVideoId: string
  /** null while its channel is disconnected. */
  channelTitle: string | null
  views: number
  /** What the channel's videos of this format usually get (see shared/hits.ts). */
  usual: number
  /** Views over usual. */
  times: number
  /** How many videos the usual comes from. */
  peers: number
  averageViewPercent: number | null
  publishedAt: string
  /** When the daily check found it and told you; null = not yet. */
  foundAt: string | null
}

/** One of your videos off to a slow start, for a second-chance title (server/second-chance.ts). */
export interface SlowStarterDTO {
  /** The project. */
  id: string
  title: string
  format: VideoFormat
  youtubeVideoId: string
  views: number
  /** What the channel's videos of this format usually have (see shared/hits.ts). */
  usual: number
  /** How many videos the usual comes from. */
  peers: number
  publishedAt: string
}

/** A posted video's Second chance panel on the Publish step. */
export interface SecondChanceDTO {
  /** Off to a slow start and not just retitled: worth a new title now. */
  slow: boolean
  /** As last counted; null before the first count. */
  views: number | null
  /** What the channel's videos usually have; null when there are too few to compare with. */
  usual: number | null
  peers: number
  /** Whole days it had been public when its views were counted. */
  days: number | null
  /** Its title now, as Cutroom last set it. */
  title: string
  /** Its title ideas not tried on this upload yet. */
  options: string[]
  /** The title changes made on this upload, oldest first. */
  changes: TitleChange[]
  /** The languages it has a translated title in: a change translates the new one too. */
  languages: string[]
}

/** A video breaking out in the niche (server/breakouts.ts). */
export interface BreakoutDTO {
  id: string
  title: string
  channelTitle: string
  youtubeChannelId: string
  views: number
  channelAverage: number
  score: number
  seconds: number
  thumbnailUrl: string | null
  publishedAt: string | null
  query: string
  status: 'new' | 'used' | 'dismissed'
  ideaId: string | null
  foundAt: string
}

export interface BreakoutsDTO {
  breakouts: BreakoutDTO[]
  /** What the search looks for. */
  queries: string[]
  scannedAt: string | null
}

/** How close a channel is to the Partner Program (Channel setup). */
export interface MonetizationDTO {
  numbers: GrowthNumbers
  /** Watch time and Shorts views could be read (the analytics permission, and the API turned on). */
  analytics: boolean
  /** Why they couldn't, when they couldn't. */
  note: string | null
  /** YouTube's id of the channel, for links into Studio. */
  youtubeId: string | null
}

export interface PerformanceVideo {
  id: string
  title: string
  format: VideoFormat
  youtubeVideoId: string
  channelId: string | null
  seriesId: string | null
  scheduledAt: string | null
  stats: VideoStats | null
  /** Where viewers stop watching, and the searches that found it. */
  insights: VideoInsights | null
  /** The video's length in seconds (its voice-over), null when unknown. */
  duration: number | null
}

export interface CommentInsightsDTO {
  channelId: string
  insights: CommentInsights
  /** How many videos and comments were read. */
  videos: number
  comments: number
  updatedAt: string
}

export interface PerformanceDTO {
  videos: PerformanceVideo[]
  channels: ChannelDTO[]
  notes: string[]
}

/** A viewer's comment waiting for the channel's reply (server/replies.ts). */
export interface ReplyCommentDTO {
  /** YouTube's id of the comment. */
  id: string
  author: string
  text: string
  likes: number
  publishedAt: string | null
  status: ReplyStatus
  /** The reply to post, as drafted or edited; once posted, what was posted. null = not drafted. */
  draft: string | null
  /** Why Gemini suggests no reply; '' when you skipped it yourself. */
  skipReason: string | null
  /** YouTube's id of the reply Cutroom posted. */
  replyId: string | null
}

/** A comment as a draft changes it, sent to the page while Gemini writes the rest. */
export type ReplyChange = Pick<ReplyCommentDTO, 'id' | 'status' | 'draft' | 'skipReason'>

export interface ReplyVideoDTO {
  projectId: string
  title: string
  format: VideoFormat
  youtubeVideoId: string
  /** When it went public. */
  publishedAt: string
  /** The comment waiting longest first. */
  comments: ReplyCommentDTO[]
}

/** A channel's comments to answer, on its videos out in the last REPLIES.days. */
export interface RepliesDTO {
  channelId: string
  /** When YouTube was last read; null = never. */
  checkedAt: string | null
  /** How many recent videos are read. */
  read: number
  /** The videos with comments, newest first. */
  videos: ReplyVideoDTO[]
}

/** What one click posted. */
export interface SentRepliesDTO {
  sent: { id: string; replyId: string; text: string }[]
  /** Why some were not posted: the cap per click, or a YouTube error. */
  notes: string[]
}

/** A test of the worker from Settings (server/worker-check.ts). */
export interface WorkerCheckDTO {
  id: string
  status: CheckStatus
  steps: CheckStep[]
  info: WorkerInfo | null
  clipUrl: string | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  mode: 'render' | 'github'
  /** The worker's runs on GitHub, to see a run that failed before it reached Cutroom. */
  runsUrl: string | null
}
