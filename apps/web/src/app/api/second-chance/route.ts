import { route } from '@/server/http'
import { listSlowStarters } from '@/server/second-chance'

/** Your videos off to a slow start, newest first, from the stored stats (no YouTube call, no AI). */
export const GET = route(async () => listSlowStarters())
