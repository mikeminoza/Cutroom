// Builds the copy-ready image prompt for each scene. You paste it into the
// image tool of your choice together with the character reference images.
import type { CharacterInput, VideoFormat } from './types'

export interface PromptScene {
  visual: string
  imagePrompt: string
  characters: string[]
  shot: string
  onScreenText?: string
}

export function aspectLabel(format: VideoFormat): string {
  return format === 'portrait' ? '9:16 vertical' : '16:9 widescreen'
}

export function sceneCharacters(scene: PromptScene, characters: CharacterInput[]): CharacterInput[] {
  const wanted = new Set(scene.characters.map((name) => name.trim().toLowerCase()))
  return characters.filter((c) => wanted.has(c.name.trim().toLowerCase()))
}

export function buildImagePrompt(
  scene: PromptScene,
  options: { artStyle: string; format: VideoFormat; characters: CharacterInput[] },
): string {
  const cast = sceneCharacters(scene, options.characters)
  const lines: string[] = []
  const body = scene.imagePrompt.trim() || scene.visual.trim()
  if (body) lines.push(body)
  if (scene.shot.trim()) lines.push(`Shot: ${scene.shot.trim()}.`)
  for (const character of cast) {
    const ref = character.images.length > 0 ? ' Match the attached reference image exactly.' : ''
    lines.push(`${character.name}: ${character.description.trim()}.${ref}`)
  }
  if (options.artStyle.trim()) lines.push(`Style: ${options.artStyle.trim()}.`)
  lines.push(`Format: ${aspectLabel(options.format)}. No text, captions, logos or watermarks in the image.`)
  return lines.join('\n')
}

export function buildThumbnailPrompt(
  idea: string,
  options: { artStyle: string; characters: CharacterInput[]; text?: string },
): string {
  const lines = [idea.trim()]
  for (const character of options.characters) {
    lines.push(`${character.name}: ${character.description.trim()}. Match the attached reference image.`)
  }
  if (options.artStyle.trim()) lines.push(`Style: ${options.artStyle.trim()}.`)
  lines.push(
    options.text?.trim()
      ? `Add the text "${options.text.trim()}" in large, bold, high-contrast letters.`
      : 'Leave clear space on one side for bold title text.',
  )
  lines.push(
    'Format: 16:9 YouTube thumbnail, 1280x720, expressive faces, strong contrast, readable at small size.',
  )
  return lines.join('\n')
}
