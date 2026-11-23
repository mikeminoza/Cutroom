import { route } from '@/server/http'
import { queueMissingPictures } from '@/server/images'
import { getProjectFull } from '@/server/projects'
import { appUrl } from '@/server/settings'
import { startRunner } from '@/server/task-runner'

// The first two pictures are made after the answer, within this limit: the Hobby plan's 300 s with
// Fluid compute. Each later two run in a request of their own (see server/task-runner.ts).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Images → Generate missing: Gemini makes the picture of every scene still without one, on the
 * server, whether or not the page stays open. Each shows on its scene once it's saved.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  await queueMissingPictures(id)
  startRunner(appUrl(request))
  return getProjectFull(id)
})
