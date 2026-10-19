import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { pendingJobIds } from '@/server/jobs'

export async function GET(request: Request): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ids: await pendingJobIds() })
}
