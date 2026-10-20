// Daily Vercel cron: wakes the worker, nudges any job that stalled while nobody was watching,
// tells you about jobs that have been stuck for an hour, and refreshes YouTube stats.

import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { refreshStats } from '@/server/analytics'
import { authEnabled, safeEqual } from '@/server/auth'
import { db, schema } from '@/server/db'
import { pingWorker, watchJob } from '@/server/jobs'
import { notify } from '@/server/notify'
import { appUrl } from '@/server/settings'

export const maxDuration = 60

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
  return NextResponse.json({ worker, nudged: active.length, stuck: stuck.length, stats })
}
