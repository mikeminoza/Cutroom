// Runs the next queued AI task (server/task-runner.ts). Only the app itself calls it: a run that
// finished a task, to start the next one in a request of its own, or a page or the daily cron
// starting the queue again. A visitor without the app's key is refused, logged in or not.
import { NextResponse } from 'next/server'
import { route } from '@/server/http'
import { appUrl } from '@/server/settings'
import { isRunCall, startRunner } from '@/server/task-runner'

// The run happens after the answer, within this limit: the Hobby plan's 300 s with Fluid compute.
// AI_BUDGET_MS ends the AI work in time.
export const maxDuration = 300

export const POST = route(
  async (request) => {
    if (!(await isRunCall(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    startRunner(appUrl(request))
    return NextResponse.json({ started: true }, { status: 202 })
  },
  { public: true },
)
