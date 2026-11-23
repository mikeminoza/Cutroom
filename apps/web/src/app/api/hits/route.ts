import { listHits } from '@/server/hits'
import { route } from '@/server/http'

/** Your videos doing far better than usual right now. */
export const GET = route(async () => listHits())
