import { hasGeminiKey } from '@cutroom/shared/ai'
import { hasElevenLabsKey } from '@cutroom/shared/elevenlabs'
import { GEMINI_VOICES } from '@cutroom/shared/types'
import { badRequest, readJson, route } from '@/server/http'
import { requireWorker, startJob } from '@/server/jobs'
import { getProjectFull, getProjectRow, getScenes, updateProject } from '@/server/projects'
import { voiceSchema } from '@/server/validation'

type Ctx = { params: Promise<{ id: string }> }

/** Records an AI voice-over of the script (replacing any voice-over), then times the scenes to it. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const voice = await readJson(request, voiceSchema)
  const project = await getProjectRow(id)
  const scenes = await getScenes(id)
  if (!project.script.trim() && !scenes.some((s) => s.narration.trim())) {
    badRequest('Write the script first: the AI voice reads it.')
  }
  if (project.youtubeVideoId) badRequest('This video is already on YouTube. Start over to change its voice.')
  if (voice.provider === 'gemini') {
    if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to use Gemini voices.')
    if (!GEMINI_VOICES.some((v) => v.name === voice.voice)) badRequest('Pick one of the Gemini voices.')
  } else if (!hasElevenLabsKey()) {
    badRequest('Add ELEVENLABS_API_KEY to use ElevenLabs voices.')
  }
  requireWorker()
  await updateProject(id, { voice })
  await startJob(id, 'voice')
  return getProjectFull(id)
})
