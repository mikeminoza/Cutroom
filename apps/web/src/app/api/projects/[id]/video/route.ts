import { downloadVideo } from '@/server/cross-posts'
import { route } from '@/server/http'

// A Short is tens of megabytes: on a slow connection the download can take minutes, and the Hobby
// plan allows 300 s.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** The finished video as a download named after its title, for posting it on TikTok or Reels. */
export const GET = route(async (request, { params }: Ctx) => {
  const { id } = await params
  return downloadVideo(id, request)
})
