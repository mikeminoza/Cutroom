import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isWorker } from '@/server/auth'
import { channelFor } from '@/server/connections'
import { db, schema } from '@/server/db'
import { toErrorResponse } from '@/server/http'
import { getProjectRow, updateProject } from '@/server/projects'
import { nextOpenSlot } from '@/server/slots'

type Ctx = { params: Promise<{ id: string }> }

/** Leaves time for YouTube to accept a scheduled publish time. */
const LEAD_MS = 15 * 60_000

/**
 * The video missed its posting time (the render took longer): move it to the next free slot on
 * its channel and reserve it. `at` is null when there is no slot to move to; it then goes out now.
 */
export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const database = await db()
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, (await params).id))
    if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 })
    const runner = request.headers.get('x-cutroom-runner')
    if (runner && job.runnerId !== runner) {
      return NextResponse.json(
        { error: 'Another worker is running this job, or it was stopped.' },
        { status: 409 },
      )
    }
    const project = await getProjectRow(job.projectId)
    if (!project.scheduledAt) return NextResponse.json({ at: null })
    const channel = await channelFor(project.channelId, project.channelYoutubeId)
    const at = await nextOpenSlot(project.id, channel?.id ?? null, new Date(Date.now() + LEAD_MS))
    await updateProject(project.id, { scheduledAt: at })
    return NextResponse.json({ at: at?.toISOString() ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}
