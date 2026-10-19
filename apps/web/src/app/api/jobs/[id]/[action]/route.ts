import { badRequest, route } from '@/server/http'
import { approveJob, cancelJob, retryJob } from '@/server/jobs'

type Ctx = { params: Promise<{ id: string; action: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id, action } = await params
  if (action === 'approve') await approveJob(id)
  else if (action === 'retry') await retryJob(id)
  else if (action === 'cancel') await cancelJob(id)
  else badRequest('Unknown action.')
  return { ok: true }
})
