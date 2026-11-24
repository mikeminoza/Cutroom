import { aiSpeed } from '@/server/ai-calls'
import { route } from '@/server/http'

/** Settings → AI speed: how long Gemini took this past week, by kind of work, and the slowest calls. */
export const GET = route(async () => aiSpeed(7))
