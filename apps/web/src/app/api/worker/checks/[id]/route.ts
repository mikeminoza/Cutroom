import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { toErrorResponse } from '@/server/http'
import { checkPayload } from '@/server/worker-check'

type Ctx = { params: Promise<{ id: string }> }

/** What the worker needs to run a check; reaching here proves APP_URL and WORKER_SECRET. */
export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await checkPayload((await params).id, request))
  } catch (error) {
    return toErrorResponse(error)
  }
}
