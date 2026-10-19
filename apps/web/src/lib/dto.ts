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
  Transcript,
  VideoFormat,
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
  jobs: { retime: JobDTO | null; publish: JobDTO | null }
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
  frames: { start: number; end: number; imageUrl: string | null }[]
  hasScript: boolean
  hasVoiceover: boolean
  timed: boolean
  job: { type: JobType; status: JobStatus; progress: number | null; detail: string | null } | null
}

export interface StatusDTO {
  gemini: { configured: boolean; model: string }
  google: { configured: boolean }
  youtube: { connected: boolean; email: string | null; label: string | null }
  drive: { connected: boolean; email: string | null; label: string | null }
  worker: { configured: boolean; reachable: boolean; url: string | null; busy: boolean }
  storage: 'local' | 'blob'
  database: 'neon' | 'local'
  auth: boolean
}
