// Shapes the browser receives from the API.
import type { JobResult, JobStatus, JobStep, JobType } from '@cutroom/shared/protocol'
import type {
  CaptionStyle,
  CharacterInput,
  PostDetails,
  PostingMode,
  ProjectStatus,
  Resolution,
  SceneInput,
  SeriesTemplate,
  Transcript,
  VideoFormat,
  VideoStats,
  VoiceSettings,
} from '@cutroom/shared/types'

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
  driveFolderUrl: string | null
  driveFileId: string | null
  outputUrl: string | null
  srtUrl: string | null
  archived: boolean
  textOverlays: boolean
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

export interface ProjectFull {
  project: ProjectDTO
  scenes: SceneDTO[]
  characters: CharacterDTO[]
  jobs: { retime: JobDTO | null; publish: JobDTO | null; voice: JobDTO | null }
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
  gemini: { configured: boolean; model: string; imageModel: string; ttsModel: string }
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
  createdAt: string
}

export interface IdeaDTO {
  id: string
  title: string
  angle: string
  seriesId: string | null
  status: 'new' | 'used' | 'dismissed'
  projectId: string | null
  createdAt: string
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
}

export interface PerformanceDTO {
  videos: PerformanceVideo[]
  channels: ChannelDTO[]
  notes: string[]
}
