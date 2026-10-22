import { isStoredUnder, readStoredFile } from '@cutroom/shared/storage'
import { badRequest, route } from '@/server/http'

/**
 * One of the app's own pictures, served from the app's origin. The thumbnail maker draws them on
 * a canvas, and a canvas holding a picture from another origin can't be saved, whatever headers
 * the storage sends. Only files the app stored (projects and Library) are served.
 */
export const GET = route(async (request) => {
  const url = new URL(request.url).searchParams.get('url') ?? ''
  if (!isStoredUnder(url, 'projects') && !isStoredUnder(url, 'library'))
    badRequest('Not one of your pictures.')
  const file = await readStoredFile(url, new URL(request.url).origin)
  if (!file.contentType.startsWith('image/')) badRequest('Not a picture.')
  return new Response(new Uint8Array(file.data), {
    headers: { 'content-type': file.contentType, 'cache-control': 'private, max-age=3600' },
  })
})
