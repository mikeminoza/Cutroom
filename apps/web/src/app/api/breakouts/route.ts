import { z } from 'zod'
import type { BreakoutsDTO } from '@/lib/dto'
import { listBreakouts, scanBreakouts } from '@/server/breakouts'
import { readJson, route } from '@/server/http'
import { getSettings, saveSettings } from '@/server/settings'

// A search is a few YouTube calls, and Gemini writes the searches the first time: like every route
// that may ask Gemini, the Hobby plan's 300 s with Fluid compute, which the AI budget is made for
// (AI_BUDGET_MS). With 60 s, a slow Gemini ended in a bare 504.
export const maxDuration = 300

async function breakouts(): Promise<BreakoutsDTO> {
  const settings = await getSettings()
  return {
    breakouts: await listBreakouts(),
    queries: settings.breakouts.queries,
    scannedAt: settings.breakouts.scannedAt,
  }
}

export const GET = route(async () => breakouts())

/** Searches YouTube now, with new searches first when `queries` is sent (empty: worked out again). */
export const POST = route(async (request) => {
  const { queries } = await readJson(
    request,
    z.object({ queries: z.array(z.string().trim().min(1).max(100)).max(5).optional() }),
  )
  if (queries) {
    const settings = await getSettings()
    await saveSettings({ ...settings, breakouts: { ...settings.breakouts, queries } })
  }
  const added = await scanBreakouts()
  return { ...(await breakouts()), added }
})
