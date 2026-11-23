import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { changeTitle, secondChance } from '@/server/second-chance'

// Two YouTube calls, and one Gemini call when the video has titles in other languages
// (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** How the posted video is doing next to the usual, and the titles it could have (no YouTube call). */
export const GET = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  return secondChance(id)
})

/** Changes the video's title on YouTube to the one you confirmed. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  // The title rules are checked with a message of their own (shared/second-chance.ts).
  const { title } = await readJson(request, z.object({ title: z.string().max(1000) }))
  return changeTitle(id, title)
})
