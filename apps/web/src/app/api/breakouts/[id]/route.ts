import { z } from 'zod'
import { setBreakoutStatus } from '@/server/breakouts'
import { readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

/** Dismisses a breakout, or brings it back. */
export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { status } = await readJson(request, z.object({ status: z.enum(['new', 'dismissed']) }))
  await setBreakoutStatus(id, status)
  return { ok: true }
})
