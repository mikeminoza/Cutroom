import { route } from '@/server/http'
import { resetPublish } from '@/server/jobs'
import { getProjectFull } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  await resetPublish(id)
  return getProjectFull(id)
})
