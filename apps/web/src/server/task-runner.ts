// Runs the queued AI tasks (server/tasks.ts) on Vercel, for free: no queue service, just the
// tasks table, after() and the app's own address.
//  - Queuing work starts a run after the response (after(): Vercel keeps the request alive for it,
//    within the route's maxDuration).
//  - A run takes ONE task, runs it and records how it went. If more wait, it calls the app's own
//    run route (POST /api/tasks/run, with a key only the app knows), which starts the next run in
//    a new request: each task gets its own 300 s, however long the batch.
//  - If that call fails or a run dies, a run starts again when a page that shows tasks is opened
//    (Ideas, a project) and none is running, and from the daily cron.
import { hasGeminiKey } from '@cutroom/shared/ai'
import { after } from 'next/server'
import type { TaskKind, TaskResult } from '@/lib/tasks'
import { internalKey, safeEqual } from './auth'
import type { TaskRow } from './db/schema'
import { draftProject, writeAutopilotDraft, writePost } from './drafting'
import { badRequest, describeError, HttpError } from './http'
import { makeScenePicture } from './images'
import { cancelBatch, claimTask, finishTask, holdLease, queueState, recoverStale, skipRest } from './tasks'

function projectOf(task: TaskRow): string {
  if (!task.projectId) badRequest('This task has no video.')
  return task.projectId
}

const NO_KEY = 'Add GEMINI_API_KEY to your environment to use AI features.'

/** No key, no billing or the free limit (see describeError): every task after it would fail the same way. */
const STOPS_BATCH = [400, 402, 429]

/**
 * What each kind does when it runs from the queue: the same server functions as its button.
 * `skipRest`: why the rest of its draft should not run. `stopBatch`: why none of the rest of the
 * batch should, though this task got done.
 */
const RUN: Partial<
  Record<TaskKind, (task: TaskRow) => Promise<{ result?: TaskResult; skipRest?: string; stopBatch?: string }>>
> = {
  draft: async (task) => {
    if (!hasGeminiKey()) badRequest(NO_KEY)
    const { storyboardError } = await draftProject(projectOf(task), task.input.notes ?? '')
    // As before: a script without its scenes gets no post details. You finish it on its page.
    return {
      result: { storyboardError },
      skipRest: storyboardError ? 'Not written, because the scenes are not written yet.' : undefined,
    }
  },
  post: async (task) => {
    await writePost(projectOf(task))
    return {}
  },
  autopilot: async (task) => {
    if (!hasGeminiKey()) badRequest(NO_KEY)
    return { result: await writeAutopilotDraft(projectOf(task)) }
  },
  picture: async (task) => {
    if (!hasGeminiKey()) badRequest(NO_KEY)
    const ids = task.input.sceneIds ?? []
    // Side by side, as the Images step made them. Each scene's picture fails on its own.
    const outcomes = await Promise.allSettled(ids.map((id) => makeScenePicture(id, true)))
    const failed: { sceneId: string; error: string }[] = []
    let stopBatch: string | undefined
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled') continue
      const { status, body } = describeError(outcome.reason)
      failed.push({ sceneId: ids[i], error: body.error })
      // Gemini would refuse every picture the same way (billing, the limit): the rest stop. A
      // problem with this scene alone (no prompt) fails only it.
      if (!(outcome.reason instanceof HttpError) && STOPS_BATCH.includes(status)) stopBatch ??= body.error
    }
    return { result: { failed }, stopBatch }
  },
}

/**
 * One run: takes the next task (none while another runs), runs it and records how it went; when
 * more wait, starts the next run in a new request. Returns the task it ran, or null.
 */
export async function runNextTask(origin: string): Promise<TaskRow | null> {
  await recoverStale()
  const task = await claimTask()
  if (!task) return null
  const release = holdLease(task)
  try {
    const run = RUN[task.kind]
    if (!run) throw new Error(`Cutroom can't run "${task.kind}" in the background.`)
    const { result, skipRest: reason, stopBatch } = await run(task)
    await finishTask(task, { status: 'done', result })
    if (task.batchId && stopBatch) await cancelBatch(task.batchId, stopBatch)
    else if (reason) await skipRest(task, reason)
  } catch (error) {
    // Logged too: nobody is waiting on this request to see it.
    const { status, body } = describeError(error)
    await finishTask(task, { status: 'failed', error: body.error })
    if (task.batchId && STOPS_BATCH.includes(status)) await cancelBatch(task.batchId, body.error)
    else await skipRest(task)
  } finally {
    release()
  }
  if ((await queueState()).waiting) await wakeRunner(origin)
  return task
}

export const runner = {
  /**
   * Runs `work` after the response is sent: Vercel keeps the request alive for it, within the
   * route's maxDuration. Outside a request it just runs in the background. Tests replace this to
   * run the queue step by step.
   */
  later(work: () => Promise<unknown>): void {
    try {
      after(work)
    } catch {
      void work()
    }
  },
}

/** Starts a run after this response. Only from routes allowed 300 s (maxDuration). */
export function startRunner(origin: string): void {
  runner.later(() => runNextTask(origin).catch((error) => console.error('[tasks] The run stopped:', error)))
}

/** The key the app calls its own run route with. */
export function runKey(): Promise<string> {
  return internalKey('tasks')
}

/** True for the app's own call to its run route. */
export async function isRunCall(request: Request): Promise<boolean> {
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${await runKey()}`)
}

/** Starts a run in a request of its own (with its own 300 s), by calling the app's run route. */
export async function wakeRunner(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/tasks/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await runKey()}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return true
    console.warn(`[tasks] The next run did not start: the app answered HTTP ${res.status}.`)
  } catch (error) {
    console.warn('[tasks] The next run did not start:', error instanceof Error ? error.message : error)
  }
  return false
}

/**
 * Starts a run, in a request of its own after this response, when queued work waits and no run
 * holds a task: the call that should have started the next run failed, or a run died. Called when
 * a page that shows tasks is opened, and by the daily cron. Returns whether it started one.
 */
export async function resumeTasks(origin: string): Promise<boolean> {
  const { waiting, running } = await queueState()
  if (!waiting || running) return false
  runner.later(() => wakeRunner(origin))
  return true
}
