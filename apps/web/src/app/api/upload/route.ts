// Local-storage uploads (development). In production the browser uploads
// straight to Vercel Blob through /api/upload/blob instead.
import { makeKey, putFile, storageDriver } from '@cutroom/shared/storage'
import { badRequest, route } from '@/server/http'

const ALLOWED = /^(image|audio)\//
const FOLDER = /^projects\/[\w-]+\/(scenes|characters|voiceover|music|thumbnail)$/

export const POST = route(async (request) => {
  if (storageDriver() !== 'local') badRequest('Uploads go to Vercel Blob in this environment.')
  const form = await request.formData()
  const file = form.get('file')
  const folder = String(form.get('folder') ?? '')
  if (!(file instanceof File)) badRequest('Attach a file.')
  if (!FOLDER.test(folder)) badRequest('Unknown upload folder.')
  if (!ALLOWED.test(file.type)) badRequest('Only images and audio files can be uploaded.')
  const stored = await putFile(makeKey(folder, file.name), Buffer.from(await file.arrayBuffer()), file.type)
  return stored
})
