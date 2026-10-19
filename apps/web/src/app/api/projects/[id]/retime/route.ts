import { hasGeminiKey } from '@cutroom/shared/ai'
import { badRequest, route } from '@/server/http'
import { startJob, workerUrl } from '@/server/jobs'
import { getProjectFull, getProjectRow } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  if (!project.voiceoverUrl) badRequest('Upload a voice-over first.')
  if (!workerUrl()) badRequest('The worker is not set up yet. Add WORKER_URL and WORKER_SECRET.')
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY so Gemini can listen to the voice-over.')
  await startJob(id, 'retime')
  return getProjectFull(id)
})
