// Daily Vercel cron: wakes the worker, nudges any job that stalled while nobody was watching,
// tells you about jobs that have been stuck for an hour, refreshes YouTube stats, and once a week
// per channel has Gemini read what viewers say in the comments.

import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { refreshStats } from '@/server/analytics'
import { authEnabled, safeEqual } from '@/server/auth'
import { postDueComments, readDueComments } from '@/server/comments'
import { db, schema } from '@/server/db'
import { pingWorker, watchJob } from '@/server/jobs'
import { notify } from '@/server/notify'
import { appUrl } from '@/server/settings'

// Stats take up to 45 s; reading a channel's comments with Gemini can take longer. The Hobby plan
// allows 300 s with Fluid compute (on by default).
export const maxDuration = 300

const STUCK_MS = 60 * 60 * 1000

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret && authEnabled()) {
    // A password-protected app must not leave this open to anyone (it sends notifications and
    // spends YouTube quota). Vercel only signs its calls when CRON_SECRET is set.
    return NextResponse.json({ error: 'Set CRON_SECRET to enable the daily check.' }, { status: 401 })
  }
  if (secret && !safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const database = await db()
  const active = await database
    .select()
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ['queued', 'running']))
  const worker = await pingWorker()
  await Promise.all(active.map((job) => watchJob(job)))

  const stuck = active.filter((job) => {
    const last = job.heartbeatAt ?? job.kickedAt ?? job.createdAt
    return Date.now() - last.getTime() > STUCK_MS
  })
  if (stuck.length) {
    notify({
      kind: 'stalled',
      title: `${stuck.length === 1 ? 'A job has' : `${stuck.length} jobs have`} not moved for over an hour`,
      body: 'The worker may be down or misconfigured. Open Settings → Connections → Worker, or check its logs.',
      url: `${appUrl(request)}/settings`,
    })
  }

  let stats: { updated: number; notes: string[] } = { updated: 0, notes: [] }
  try {
    stats = await refreshStats()
  } catch (error) {
    stats.notes.push(error instanceof Error ? error.message : String(error))
  }
  // Comments for viewers on videos that went public since yesterday.
  stats.notes.push(...(await postDueComments().catch((error) => [String(error)])))
  const comments = await readDueComments().catch((error) =>
    error instanceof Error ? error.message : String(error),
  )
  return NextResponse.json({ worker, nudged: active.length, stuck: stuck.length, stats, comments })
}
