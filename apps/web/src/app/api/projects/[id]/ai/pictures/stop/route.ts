import { route } from '@/server/http'
import { stopPictures } from '@/server/images'
import { getProjectFull } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

/** Stops Generate missing: the pictures not started are left; the ones being made are finished. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  await stopPictures(id)
  return getProjectFull(id)
})
