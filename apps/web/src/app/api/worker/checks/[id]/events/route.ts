import type { CheckEvent } from '@cutroom/shared/protocol'
import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { toErrorResponse } from '@/server/http'
import { applyCheckEvent } from '@/server/worker-check'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const event = (await request.json()) as CheckEvent
    await applyCheckEvent((await params).id, event)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
