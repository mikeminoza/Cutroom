// Cutroom worker: the long-running scripts (voice-over timing, rendering, uploads).
// Deployed as a Render web service. The web app starts jobs with POST /jobs.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pendingJobs } from './api'
import { cancel, enqueue, isKnown, workerState } from './runner'

const app = new Hono()

app.get('/', (c) => c.text('Cutroom worker is running.'))
app.get('/health', (c) => c.json({ ok: true, ...workerState() }))

app.use('/jobs/*', async (c, next) => {
  const secret = process.env.WORKER_SECRET
  if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

app.post('/jobs', async (c) => {
  const body = await c.req.json<{ jobId?: string }>().catch(() => ({}) as { jobId?: string })
  if (!body.jobId) return c.json({ error: 'jobId is required' }, 400)
  return c.json({ status: enqueue(body.jobId) }, 202)
})

app.get('/jobs/:id', (c) => c.json({ known: isKnown(c.req.param('id')), ...workerState() }))

app.delete('/jobs/:id', (c) => c.json({ cancelled: cancel(c.req.param('id')) }))

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Cutroom worker listening on http://localhost:${port}`)
  if (!process.env.WORKER_SECRET) console.warn('WORKER_SECRET is not set — the web app cannot start jobs.')
  // Pick up jobs that were interrupted by a restart or a spin-down.
  setTimeout(async () => {
    try {
      const ids = await pendingJobs()
      for (const id of ids) enqueue(id)
      if (ids.length) console.log(`Resuming ${ids.length} job(s)`)
    } catch {
      console.warn(
        'Could not reach the web app to resume jobs. They will resume when the dashboard checks on them.',
      )
    }
  }, 2000)
})
