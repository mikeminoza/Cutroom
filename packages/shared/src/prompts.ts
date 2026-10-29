// Builds the copy-ready image prompt for each scene. You paste it into the
// image tool of your choice together with the character reference images.
import type { CharacterInput, VideoFormat } from './types'

export interface PromptScene {
  visual: string
  imagePrompt: string
  characters: string[]
  shot: string
  onScreenText?: string
  /** What is said during the scene: the picture's subject when nothing else describes it. */
  narration?: string
}

export function aspectLabel(format: VideoFormat): string {
  return format === 'portrait' ? '9:16 vertical' : '16:9 widescreen'
}

export function sceneCharacters(scene: PromptScene, characters: CharacterInput[]): CharacterInput[] {
  const wanted = new Set(scene.characters.map((name) => name.trim().toLowerCase()))
  return characters.filter((c) => wanted.has(c.name.trim().toLowerCase()))
}

/** A person, a creature with a body, or a body part: the picture needs believable anatomy. */
const BODIES =
  /\b(stick[ -]?figures?|figures?|person|people|man|men|woman|women|guy|girl|boy|kid|child(ren)?|human|someone|characters?|janitors?|zombies?|goblins?|runners?|billionaires?|crowd|hands?|fists?|feet|foot|fingers?|arms?|legs?)\b/i

/** The prompt or style asks for words in the picture. */
const WORDS =
  /\b(text|letters?|lettered|lettering|words?|reading|spell(s|ed|ing)?|label(l?ed)?|signs?|titles?)\b/i

export function mentionsBodies(text: string): boolean {
  return BODIES.test(text)
}

/** "Bold, flat colours." from "Bold, flat colours.." or "Bold, flat colours". */
const sentence = (text: string) => `${text.trim().replace(/[.\s]+$/, '')}.`

export function buildImagePrompt(
  scene: PromptScene,
  options: { artStyle: string; format: VideoFormat; characters: CharacterInput[] },
): string {
  const cast = sceneCharacters(scene, options.characters)
  const lines: string[] = []
  // Scenes split without AI have no picture description yet; the narration still says what to show.
  const said = scene.narration?.trim()
  const body = scene.imagePrompt.trim() || scene.visual.trim() || (said ? `An image showing: ${said}` : '')
  if (body) lines.push(body)
  if (scene.shot.trim()) lines.push(`Shot: ${sentence(scene.shot)}`)
  for (const character of cast) {
    const ref = character.images.length > 0 ? ' Match the attached reference image exactly.' : ''
    lines.push(`${character.name}: ${sentence(character.description)}${ref}`)
  }
  // Image models get bodies wrong (a third arm, six fingers) unless asked plainly for normal ones.
  if (cast.length > 0 || mentionsBodies(body)) {
    lines.push(
      'Anatomy: every person or character has one head, two arms, two hands with five fingers and two legs, in a simple, clear pose.',
    )
  }
  if (options.artStyle.trim()) lines.push(`Style: ${sentence(options.artStyle)}`)
  // "No text" contradicts a picture that asks for a label or a sign, so only rule out the rest.
  const wantsWords = WORDS.test(body) || WORDS.test(options.artStyle)
  lines.push(
    `Format: ${aspectLabel(options.format)}. ${
      wantsWords
        ? 'No captions, logos or watermarks; any words in the picture are only the ones described above, spelled exactly.'
        : 'No text, captions, logos or watermarks in the image.'
    }`,
  )
  return lines.join('\n')
}

/** The words a thumbnail prompt asks to print (see buildThumbnailPrompt), or ''. */
export function thumbnailWords(prompt: string): string {
  return /Add the text "([^"]+)"/.exec(prompt)?.[1] ?? ''
}

export function buildThumbnailPrompt(
  idea: string,
  options: { artStyle: string; characters: CharacterInput[]; text?: string },
): string {
  const lines = [idea.trim()]
  for (const character of options.characters) {
    lines.push(`${character.name}: ${sentence(character.description)} Match the attached reference image.`)
  }
  if (options.artStyle.trim()) lines.push(`Style: ${sentence(options.artStyle)}`)
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
