// Runs a single job and exits. Used by the GitHub Actions worker (.github/workflows/worker.yml):
//   tsx src/once.ts <jobId>
// A failed job is reported to the web app like any other, so the process still exits 0; it exits
// 1 only when the job could not be run at all (the run log then says why).
import { runJob } from './runner'

const jobId = process.argv[2]?.trim()
if (!jobId || !/^[\w-]{1,100}$/.test(jobId)) {
  console.error('Usage: tsx src/once.ts <jobId>')
  process.exit(2)
}
if (!process.env.WORKER_SECRET || !process.env.APP_URL) {
  console.error('WORKER_SECRET and APP_URL must be set (repository secrets in GitHub).')
  process.exit(2)
}

const controller = new AbortController()
// GitHub cancels a run with SIGINT, then SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => controller.abort())
}

const outcome = await runJob(jobId, controller)
console.log(`Job ${jobId}: ${outcome}`)
process.exit(outcome === 'error' ? 1 : 0)
