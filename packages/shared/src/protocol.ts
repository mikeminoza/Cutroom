// Contract between the web app (owns the database) and the worker (runs the long scripts).
// The worker never touches the database: it reads a job payload from the web app
// and reports progress back as events, authenticated with WORKER_SECRET.
import type {
  AppSettings,
  CaptionStyle,
  CharacterInput,
  PostDetails,
  PostingMode,
  Resolution,
  SceneInput,
  Transcript,
  VideoFormat,
} from './types'

export type JobType = 'retime' | 'publish'
export type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'waiting'

export type PublishStepKey = 'render' | 'drive' | 'details' | 'approve' | 'youtube' | 'finish' | 'archive'
export type RetimeStepKey = 'transcribe' | 'align'
export type StepKey = PublishStepKey | RetimeStepKey

export interface JobStep {
  key: StepKey
  label: string
  status: StepStatus
  detail?: string
  progress?: number
  startedAt?: string
  endedAt?: string
}

export const PUBLISH_STEPS: { key: PublishStepKey; label: string }[] = [
  { key: 'render', label: 'Render video' },
  { key: 'drive', label: 'Save to Google Drive' },
  { key: 'details', label: 'Write post details' },
  { key: 'approve', label: 'Wait for your approval' },
  { key: 'youtube', label: 'Upload to YouTube' },
  { key: 'finish', label: 'Add thumbnail, captions, playlist' },
  { key: 'archive', label: 'Archive project files' },
]

export const RETIME_STEPS: { key: RetimeStepKey; label: string }[] = [
  { key: 'transcribe', label: 'Listen to the voice-over' },
  { key: 'align', label: 'Match scenes to the speech' },
]

export interface JobResult {
  outputUrl?: string
  outputKey?: string
  srtUrl?: string
  srtKey?: string
  driveFolderId?: string
  driveFolderUrl?: string
  driveFileId?: string
  driveFileUrl?: string
  youtubeVideoId?: string
  post?: PostDetails
  publishAt?: string | null
  transcript?: Transcript
  sceneTimes?: { id: string; start: number; end: number }[]
  createdScenes?: { start: number; end: number; narration: string }[]
  matchedRatio?: number
  archivedKeys?: string[]
  warnings?: string[]
}

export interface JobPayloadProject {
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
  pace: number
  script: string
  voiceoverUrl: string | null
  voiceoverDuration: number | null
  musicUrl: string | null
  musicVolume: number
  thumbnailUrl: string | null
  transcript: Transcript | null
  post: PostDetails
  scheduledAt: string | null
  driveFolderId: string | null
}

export interface JobPayload {
  job: {
    id: string
    type: JobType
    status: JobStatus
    steps: JobStep[]
    result: JobResult
    attempts: number
    approved: boolean
  }
  project: JobPayloadProject
  scenes: SceneInput[]
  characters: CharacterInput[]
  settings: AppSettings
  google: {
    youtubeRefreshToken: string | null
    driveRefreshToken: string | null
  }
  /** Base URL the worker can download local-storage files from (dev only). */
  appUrl: string
}

export type WorkerEvent =
  | { type: 'step'; key: StepKey; status: StepStatus; detail?: string; progress?: number }
  | { type: 'result'; patch: JobResult }
  | { type: 'waiting'; key: StepKey; detail?: string }
  | { type: 'done' }
  | { type: 'failed'; error: string; key?: StepKey }

export function initialSteps(type: JobType): JobStep[] {
  const list = type === 'publish' ? PUBLISH_STEPS : RETIME_STEPS
  return list.map((s) => ({ key: s.key, label: s.label, status: 'pending' as StepStatus }))
}

/** A job counts as stalled when the worker has not reported for this long. */
export const STALL_SECONDS = 150
