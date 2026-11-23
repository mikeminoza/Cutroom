import { stopDraftBatch } from '@/server/drafting'
import { route } from '@/server/http'

/** Stops writing the drafts: the ones not started are left unwritten; the part being written finishes. */
export const POST = route(async () => ({ batch: await stopDraftBatch() }))
