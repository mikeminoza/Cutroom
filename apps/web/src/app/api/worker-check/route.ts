import { route } from '@/server/http'
import { latestCheck, startCheck } from '@/server/worker-check'

/** The latest test of the worker (Settings → Worker), or null. */
export const GET = route(async () => ({ check: await latestCheck() }))

/** Starts a test of the worker, or returns the one still running. */
export const POST = route(async () => ({ check: await startCheck() }))
