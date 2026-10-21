import { pickShortMoment } from '@cutroom/shared/ai'
import { totalDuration } from '@cutroom/shared/timing'
import { z } from 'zod'
import { badRequest, readJson, route } from '@/server/http'
import { getProjectRow, getScenes } from '@/server/projects'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** Gemini picks the run of scenes that works best on its own as a Short. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { maxSeconds } = await readJson(
    request,
    z.object({ maxSeconds: z.number().min(10).max(180).default(60) }),
  )
  const project = await getProjectRow(id)
  const scenes = await getScenes(id)
  if (scenes.length === 0) badRequest('This video has no scenes yet.')
  const duration = project.voiceoverDuration ?? totalDuration(scenes)
  // Times as the video lays scenes out: each until the next starts.
  const laidOut = scenes.map((s, i) => ({
    start: i === 0 ? 0 : s.start,
    end: i === scenes.length - 1 ? duration : scenes[i + 1].start,
    narration: s.narration,
  }))
  return pickShortMoment({ title: project.title, topic: project.topic, scenes: laidOut, maxSeconds })
})
