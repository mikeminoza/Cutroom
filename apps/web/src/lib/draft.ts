// Writing a project's script live (POST /api/projects/[id]/ai/draft): Gemini's words arrive as
// they're written, and the storyboard is made from them at the same time. The answer is one JSON
// event per line (lib/stream.ts).
import type { SceneDraft } from '@cutroom/shared/ai'
import type { ProjectFull } from './dto'
import { type ListChange, postForEvents } from './stream'

export type DraftEvent =
  | { type: 'title'; title: string }
  /** More of the script. */
  | { type: 'text'; add: string }
  /** Gemini started the script over: drop what came so far. */
  | { type: 'restart' }
  /** Parts of the script storyboarded so far, of the parts started. */
  | { type: 'part'; done: number; started: number }
  /** The storyboard's scenes so far, in script order, as what changed (lib/stream.ts). */
  | ({ type: 'scenes' } & ListChange<SceneDraft>)
  /** Saved. With a storyboardError the script is saved but its scenes are not. */
  | { type: 'done'; project: ProjectFull; storyboardError: string | null }
  | { type: 'error'; error: string; code?: string }

/**
 * Has Gemini write the project's script live and storyboard it, telling `onEvent` as it goes.
 * Resolves once the script (and, unless storyboardError says otherwise, its scenes) are saved.
 */
export async function writeDraft(
  projectId: string,
  notes: string,
  onEvent: (event: DraftEvent) => void = () => {},
): Promise<{ project: ProjectFull; storyboardError: string | null }> {
  const { project, storyboardError } = await postForEvents<DraftEvent>(
    `/api/projects/${projectId}/ai/draft`,
    { notes },
    onEvent,
    'The connection broke before the script was saved. Reload the page to see how far it got.',
  )
  return { project, storyboardError }
}
