// Generating pictures with Gemini: scene images (with the characters' reference images attached,
// so they look the same in every scene) and thumbnails.
import { generateImage, MAX_REFERENCE_IMAGES, type ReferenceImage } from '@cutroom/shared/ai'
import { imageDimensions, imageExtension } from '@cutroom/shared/images'
import { makeKey, putFile, readStoredFile } from '@cutroom/shared/storage'
import type { CharacterInput, VideoFormat } from '@cutroom/shared/types'
import { badRequest } from './http'
import { appUrl } from './settings'

const ACCEPTED = /^image\/(png|jpeg|webp|heic|heif)$/

/** Up to two images per character, at most MAX_REFERENCE_IMAGES in all. Unreadable ones are skipped. */
export async function referenceImages(characters: CharacterInput[]): Promise<ReferenceImage[]> {
  const picks = characters.flatMap((c) => c.images.slice(0, 2)).slice(0, MAX_REFERENCE_IMAGES)
  const loaded = await Promise.all(
    picks.map(async (image) => {
      try {
        const file = await readStoredFile(image.url, appUrl())
        return ACCEPTED.test(file.contentType) ? { data: file.data, mimeType: file.contentType } : null
      } catch (error) {
        console.warn(`Reference image ${image.url} was skipped:`, error)
        return null
      }
    }),
  )
  return loaded.filter((r): r is ReferenceImage => r !== null)
}

/** Generates a picture and stores it in the project's `folder`. */
export async function generateAndStore(input: {
  projectId: string
  folder: 'scenes' | 'thumbnail'
  name: string
  prompt: string
  characters: CharacterInput[]
  aspectRatio: '16:9' | '9:16'
}): Promise<{ url: string; width: number | null; height: number | null }> {
  if (!input.prompt.trim()) badRequest('Write an image prompt first.')
  const references = await referenceImages(input.characters)
  const image = await generateImage({ prompt: input.prompt, references, aspectRatio: input.aspectRatio })
  const size = imageDimensions(image.data)
  const stored = await putFile(
    makeKey(`projects/${input.projectId}/${input.folder}`, `${input.name}${imageExtension(image.mimeType)}`),
    image.data,
    image.mimeType,
  )
  return { url: stored.url, width: size?.width ?? null, height: size?.height ?? null }
}

export function aspectFor(format: VideoFormat): '16:9' | '9:16' {
  return format === 'portrait' ? '9:16' : '16:9'
}
