import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isWorker } from '@/server/auth'
import { db, schema } from '@/server/db'
import { readJson, toErrorResponse } from '@/server/http'
import { createShort } from '@/server/shorts'

type Ctx = { params: Promise<{ id: string }> }

/**
 * The worker makes a Short draft from the video of the publish job it is running (right after
 * posting, before the project's files are archived). The Short's voice-over is already uploaded to
 * its own folder; createShort checks that and copies the pictures.
 */
export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  if (!isWorker(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const database = await db()
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, (await params).id))
    if (job?.type !== 'publish') return NextResponse.json({ error: 'No such job.' }, { status: 404 })
    const runner = request.headers.get('x-cutroom-runner')
    if (runner && job.runnerId !== runner) {
      return NextResponse.json(
        { error: 'Another worker is running this job, or it was stopped.' },
        { status: 409 },
      )
    }
    const body = await readJson(
      request,
      z.object({
        newId: z.string().uuid(),
        from: z.number().int().min(0),
        to: z.number().int().min(0),
        title: z.string().max(200),
        voiceover: z
          .object({ url: z.string().max(2000), name: z.string().max(200), duration: z.number().positive() })
          .nullable(),
      }),
    )
    // The source's pictures fill a 9:16 frame best whole, over a blurred copy of themselves.
    const id = await createShort({ sourceId: job.projectId, fit: 'contain', ...body })
    return NextResponse.json({ id })
  } catch (error) {
    return toErrorResponse(error)
  }
}
