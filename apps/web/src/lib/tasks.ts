// AI work that runs on the server whether or not a page is open (server/tasks.ts): what it can be,
// and how pages talk about it. Shared by the server and the pages.
import type { SceneDraft } from '@cutroom/shared/ai'

/**
 * What a task does. 'draft' (the script written live and storyboarded) and 'post' (the title,
 * description and tags) also run from the queue, for Ideas → Create drafts, and so does 'picture'
 * (scene pictures), for Images → Generate missing; every kind is also a button's AI request,
 * recorded while it runs so a reopened page can tell it is still going. 'scenes' also runs from
 * the queue to finish a long script's storyboard that ran out of time. 'autopilot' only runs from
 * the queue: the weekly autopilot's draft (script, scenes and pictures from the Library), in a
 * request of its own rather than inside the daily cron.
 */
export type TaskKind =
  | 'draft'
  | 'script'
  | 'scenes'
  | 'post'
  | 'translate'
  | 'effects'
  | 'compose'
  | 'thumbnail'
  | 'picture'
  | 'autopilot'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/**
 * A storyboard that stopped before the end: the parts of the script already storyboarded, kept for
 * the next run of the same script with the same settings (`key`).
 */
export interface KeptStoryboard {
  key: string
  parts: { text: string; scenes: SceneDraft[] }[]
}

/** What a queued task needs besides its project. */
export interface TaskInput {
  /**
   * For scenes queued to go on with a long script that ran out of time: the parts done so far,
   * so only the rest is asked for.
   */
  storyboard?: KeptStoryboard
  /** For a draft: anything else Gemini should know. */
  notes?: string
  /** For pictures: the scenes to make them for, side by side. */
  sceneIds?: string[]
}

/** What a finished task leaves behind. */
export interface TaskResult {
  /** For a draft: why its storyboard failed. The script is saved; the old scenes stay. */
  storyboardError?: string | null
  /** For pictures: the scenes Gemini didn't make, and why. */
  failed?: { sceneId: string; error: string }[]
  /** For scenes that failed part way: the parts done, kept for trying again. */
  storyboard?: KeptStoryboard
}

/** Why the rest of a batch was cancelled, when it was you. */
export const STOPPED_BY_YOU = 'Stopped by you.'

/** The work as a sentence's subject: "… is still running for this video". */
export const TASK_LABEL: Record<TaskKind, string> = {
  draft: 'Writing the script and scenes',
  script: 'Writing the script',
  scenes: 'Splitting the script into scenes',
  post: 'Writing the post details',
  translate: 'Translating the title and description',
  effects: 'Picking the effects',
  compose: 'Picking pictures from the Library',
  thumbnail: 'Making the thumbnail',
  picture: "Making this scene's picture",
  autopilot: 'Writing the weekly draft',
}

/** What Gemini is doing: "Gemini is still … (started 40 s ago)". */
export const TASK_DOING: Record<TaskKind, string> = {
  draft: 'writing this script',
  script: 'writing this script',
  scenes: 'splitting this script into scenes',
  post: 'writing the post details',
  translate: 'translating the title and description',
  effects: 'picking the effects',
  compose: 'picking pictures from the Library',
  thumbnail: 'making the thumbnail',
  picture: 'making this picture',
  autopilot: 'writing this weekly draft',
}

/** A draft's parts, as Ideas → Create drafts shows them: "Writing draft 2 of 5: …". */
export const DRAFT_PART: Partial<Record<TaskKind, string>> = {
  draft: 'script, scenes and image prompts',
  post: 'title, description and tags',
}

/**
 * Work that rewrites the same part of a project: while one runs (or waits in the queue), the others
 * are refused, so two never overwrite each other or spend the free quota twice. Pictures only clash
 * on the same scene (see server/tasks.ts).
 */
export const SAME_WORK: Record<TaskKind, TaskKind[]> = {
  draft: ['draft', 'script', 'scenes', 'autopilot'],
  script: ['draft', 'script', 'scenes', 'autopilot'],
  scenes: ['draft', 'script', 'scenes', 'autopilot'],
  post: ['post', 'translate'],
  translate: ['post', 'translate'],
  effects: ['effects'],
  compose: ['compose', 'autopilot'],
  thumbnail: ['thumbnail'],
  picture: ['picture'],
  autopilot: ['draft', 'script', 'scenes', 'compose', 'autopilot'],
}
