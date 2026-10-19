import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { toErrorResponse } from '@/server/http'
import { buildPayload } from '@/server/jobs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await buildPayload((await params).id, request))
  } catch (error) {
    return toErrorResponse(error)
  }
}
