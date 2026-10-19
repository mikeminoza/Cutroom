// Where a project stands and what the user should do next. Used on the
// dashboard rows and the project header so both always say the same thing.
import type { ProjectStatus } from '@cutroom/shared/types'

export const PIPELINE_STATUSES: ProjectStatus[] = [
  'rendering',
  'awaiting_approval',
  'uploading',
  'scheduled',
  'published',
  'rendered',
  'failed',
]

export interface StageInput {
  status: ProjectStatus
  scheduledAt: string | null
  hasScript: boolean
  sceneCount: number
  imagesDone: number
  hasVoiceover: boolean
  timed: boolean
}

export function effectiveStatus(input: StageInput): ProjectStatus {
  if (
    input.status === 'scheduled' &&
    input.scheduledAt &&
    new Date(input.scheduledAt).getTime() <= Date.now()
  ) {
    return 'published'
  }
  if (PIPELINE_STATUSES.includes(input.status)) return input.status
  if (input.sceneCount === 0) return 'draft'
  if (!input.timed) return 'scripted'
  if (input.imagesDone < input.sceneCount) return 'timed'
  return 'ready'
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft',
  scripted: 'Scenes ready',
  timed: 'Timed to voice-over',
  ready: 'Ready to finish',
  rendering: 'Rendering',
  awaiting_approval: 'Waiting for approval',
  rendered: 'Rendered',
  uploading: 'Uploading',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Needs attention',
}

/** Status tone: "you" = your move (yellow), "run" = the app is working, "ok", "bad", "idle". */
export type Tone = 'you' | 'run' | 'ok' | 'bad' | 'idle'

export function statusTone(status: ProjectStatus): Tone {
  switch (status) {
    case 'rendering':
    case 'uploading':
      return 'run'
    case 'awaiting_approval':
    case 'ready':
      return 'you'
    case 'scheduled':
    case 'published':
    case 'rendered':
      return 'ok'
    case 'failed':
      return 'bad'
    default:
      return 'idle'
  }
}

export type StepId = 'brief' | 'characters' | 'script' | 'voiceover' | 'images' | 'preview' | 'publish'

export interface NextStep {
  step: StepId
  text: string
}

export function nextStep(input: StageInput): NextStep {
  const status = effectiveStatus(input)
  if (status === 'awaiting_approval') return { step: 'publish', text: 'Approve the post details to upload' }
  if (status === 'failed') return { step: 'publish', text: 'Check what went wrong and retry' }
  if (status === 'rendering' || status === 'uploading')
    return { step: 'publish', text: 'Working on it — you can close this page' }
  if (status === 'scheduled') return { step: 'publish', text: 'Nothing to do until it goes live' }
  if (status === 'published' || status === 'rendered') return { step: 'publish', text: 'Done' }
  if (!input.hasScript && input.sceneCount === 0) return { step: 'script', text: 'Write or paste the script' }
  if (input.sceneCount === 0) return { step: 'script', text: 'Split the script into scenes' }
  if (!input.hasVoiceover) return { step: 'voiceover', text: 'Upload the voice-over' }
  if (!input.timed) return { step: 'voiceover', text: 'Match the scenes to the voice-over' }
  const missing = input.sceneCount - input.imagesDone
  if (missing > 0)
    return { step: 'images', text: `Upload ${missing} scene ${missing === 1 ? 'image' : 'images'}` }
  return { step: 'publish', text: 'Finish & schedule' }
}
