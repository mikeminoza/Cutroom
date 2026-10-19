// Daily Vercel cron: wakes the worker and nudges any job that stalled while nobody was watching.

import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { safeEqual } from '@/server/auth'
import { db, schema } from '@/server/db'
import { pingWorker, watchJob } from '@/server/jobs'

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
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
  return NextResponse.json({ worker, nudged: active.length })
}
