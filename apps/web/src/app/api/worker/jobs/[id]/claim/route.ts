import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { toErrorResponse } from '@/server/http'
import { claimJob } from '@/server/jobs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * A worker asks to run the job. 409 with `reason`: 'held' when another worker is running it
 * (worth asking again later), 'not-runnable' when it is finished, stopped or waiting for approval.
 */
export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const runner = request.headers.get('x-cutroom-runner')?.slice(0, 200)
    if (!runner) return NextResponse.json({ error: 'Missing runner id.' }, { status: 400 })
    const outcome = await claimJob((await params).id, runner)
    if (outcome === 'granted') return NextResponse.json({ ok: true })
    return NextResponse.json(
      {
        error:
          outcome === 'held'
            ? 'Another worker is running this job.'
            : 'This job is not waiting to run (finished, stopped or waiting for approval).',
        reason: outcome,
      },
      { status: 409 },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
