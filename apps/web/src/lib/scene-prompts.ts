// Each scene's time range and the prompt for its picture, for the Voice-over and Images steps:
// shown as a list, copied all at once, or downloaded as a text file.
import { buildImagePrompt, sceneCharacters } from '@cutroom/shared/prompts'
import { formatTimecode } from '@cutroom/shared/timing'
import { hasPicture } from '@cutroom/shared/types'
import type { ProjectFull } from './dto'

export interface ScenePrompt {
  id: string
  number: number
  start: number
  end: number
  /** "0:05.2 – 0:09.8" */
  range: string
  narration: string
  prompt: string
  /** Characters whose reference images should go along with the prompt. */
  cast: string[]
  hasImage: boolean
}

export function scenePrompts(data: ProjectFull): ScenePrompt[] {
  const { project, scenes, characters } = data
  return scenes.map((scene) => ({
    id: scene.id,
    number: scene.index + 1,
    start: scene.start,
    end: scene.end,
    range: `${formatTimecode(scene.start)} – ${formatTimecode(scene.end)}`,
    narration: scene.narration,
    prompt: buildImagePrompt(scene, { artStyle: project.artStyle, format: project.format, characters }),
    cast: sceneCharacters(scene, characters).map((c) => c.name),
    hasImage: hasPicture(scene),
  }))
}

/** Plain text, one block per scene: time range, characters to attach, then the prompt. */
export function scenePromptsText(entries: ScenePrompt[]): string {
  return entries
    .map((entry) =>
      [
        `Scene ${entry.number}  (${entry.range})`,
        entry.cast.length ? `Attach reference images for: ${entry.cast.join(', ')}` : null,
        '',
        entry.prompt,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    )
    .join('\n\n────────────────────────────────────────\n\n')
}

export function downloadScenePrompts(title: string, entries: ScenePrompt[]) {
  const blob = new Blob([scenePromptsText(entries)], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(title || 'video').replace(/[^\w-]+/g, '-').toLowerCase()}-image-prompts.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}
