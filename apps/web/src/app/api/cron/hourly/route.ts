// Optional hourly check, for a free scheduler such as cron-job.org (Vercel's free plan runs its own
// cron once a day): posts the comment for viewers on videos that went public since the last check,
// so it goes up within the hour. Light: no Gemini, a couple of YouTube calls when something is due.
import { NextResponse } from 'next/server'
import { postDueComments } from '@/server/comments'
import { cronDenied } from '@/server/cron'

export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  const denied = cronDenied(request)
  if (denied) return denied
  const notes = await postDueComments().catch((error) => [String(error)])
  return NextResponse.json({ notes })
}
