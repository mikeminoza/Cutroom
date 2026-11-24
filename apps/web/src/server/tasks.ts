// AI work that keeps going when the page is closed, kept in the tasks table. Two uses:
//  - The queue: work a page used to drive one request at a time (Ideas → Create drafts → write
//    them, Images → Generate missing). Queued tasks run one at a time on the server
//    (server/task-runner.ts) whether or not a page is open.
//  - Tracking: a button's AI request already finishes on the server when its page closes. It
//    records itself here while it runs, so a reopened page shows it still going instead of
//    offering the button again (and spending the free quota twice).
// A run holds its task with a lease it keeps renewing. When the run dies (its request was cut off),
// the lease runs out: a queued task is tried once more, then given up with a plain message.
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, notExists, or, sql } from 'drizzle-orm'
import type { PictureBatchDTO, TaskDTO } from '@/lib/dto'
import { SAME_WORK, TASK_LABEL, type TaskInput, type TaskKind, type TaskResult } from '@/lib/tasks'
import { db, schema } from './db'
import type { TaskRow } from './db/schema'
import { badRequest, newId } from './http'

/** How long a run holds its task without renewing the lease. It renews well before then. */
const LEASE_MS = 2 * 60_000
const RENEW_MS = 30_000
/** Runs a queued task gets: a run that died is tried once more. */
const MAX_ATTEMPTS = 2
/** Finished tasks are kept this long, so the last batch's outcome still shows after a reload. */
const KEEP_MS = 14 * 24 * 60 * 60_000

const DIED = 'This stopped before it was done.'
const DIED_TWICE = 'This stopped before it was done, twice. Try it again from its project page.'
const SKIPPED = 'Not started, because the part before it did not finish.'

/**
 * Queued work where each task builds on the one before it for the same project (a draft's post
 * details need its script): when one fails, the rest of that project's part of the batch is
 * skipped. Pictures stand alone: one Gemini won't make leaves the others to go on.
 */
const CHAINED: TaskKind[] = ['draft', 'post']

const lease = () => new Date(Date.now() + LEASE_MS)

export function toTaskDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    sceneIds: row.input.sceneIds ?? [],
  }
}

/** Queues tasks to run one after another, in this order, as one batch. Returns the batch's id. */
export async function queueBatch(
  items: { kind: TaskKind; projectId: string | null; input?: TaskInput }[],
): Promise<string> {
  const database = await db()
  const batchId = newId()
  if (items.length) {
    await database.insert(schema.tasks).values(
      items.map((item, position) => ({
        id: newId(),
        kind: item.kind,
        projectId: item.projectId,
        input: item.input ?? {},
        batchId,
        position,
      })),
    )
  }
  return batchId
}

/**
 * Still to come: queued, running with its lease held, or a queued task whose run died and that
 * will be tried again.
 */
function unfinished(now: Date) {
  return or(
    eq(schema.tasks.status, 'queued'),
    and(
      eq(schema.tasks.status, 'running'),
      or(
        gt(schema.tasks.leaseUntil, now),
        and(eq(schema.tasks.inline, false), lt(schema.tasks.attempts, MAX_ATTEMPTS)),
      ),
    ),
  )
}

/** A project's AI work that is running or queued, oldest first. */
export async function activeTasks(projectId: string): Promise<TaskRow[]> {
  const database = await db()
  return database
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), unfinished(new Date())))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.position))
}

/**
 * Whether work of `kind` on `input` would clash with a task (SAME_WORK). Pictures only clash on the
 * same scene: another scene's picture can be made meanwhile.
 */
function clashes(kind: TaskKind, input: TaskInput, task: TaskRow): boolean {
  if (!SAME_WORK[kind].includes(task.kind)) return false
  if (kind !== 'picture') return true
  const scenes = task.input.sceneIds ?? []
  return (input.sceneIds ?? []).some((id) => scenes.includes(id))
}

/** Plain words for what went wrong, for the task's record (the route still answers as usual). */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong.'
}

/** What failed work got done before it stopped, by the error it stopped with (see keepOnTask). */
const keptOnFailure = new WeakMap<object, TaskResult>()

/**
 * Marks `error` as work that stopped with `result` done: when the work is a tracked task, the
 * task keeps it, so trying again can pick up where it stopped. Returns the error, to throw.
 */
export function keepOnTask<E extends object>(error: E, result: TaskResult): E {
  keptOnFailure.set(error, result)
  return error
}

/**
 * What the newest finished task of `kind` on a project kept, when it failed (keepOnTask); null
 * when it didn't fail, or kept nothing. The run asking is itself running, so it isn't counted.
 */
export async function keptByLastFailure(projectId: string, kind: TaskKind): Promise<TaskResult | null> {
  const database = await db()
  const [last] = await database
    .select({ status: schema.tasks.status, result: schema.tasks.result })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.kind, kind),
        inArray(schema.tasks.status, ['done', 'failed', 'cancelled']),
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1)
  return last?.status === 'failed' ? last.result : null
}

/**
 * Records a button's AI work on a project as running, refusing it while the same work (SAME_WORK)
 * is still running or queued for the project. Says how it ended with done() or failed(). Use
 * `tracked` unless the work outlives the call, as a streamed answer does.
 */
export async function startTracking(
  projectId: string,
  kind: TaskKind,
  input: TaskInput = {},
): Promise<{ done(): Promise<void>; failed(error: unknown): Promise<void> }> {
  const busy = (await activeTasks(projectId)).find((t) => clashes(kind, input, t))
  if (busy) {
    badRequest(
      `${TASK_LABEL[busy.kind]} is ${busy.status === 'queued' ? 'queued' : 'still running'} for this video. Wait for it to finish.`,
    )
  }
  const database = await db()
  const [task] = await database
    .insert(schema.tasks)
    .values({
      id: newId(),
      kind,
      projectId,
      input,
      inline: true,
      status: 'running',
      attempts: 1,
      startedAt: new Date(),
      leaseUntil: lease(),
    })
    .returning()
  const release = holdLease(task)
  // The record is only for show: failing to write it never fails the work itself.
  const end = async (outcome: Parameters<typeof finishTask>[1]) => {
    release()
    await finishTask(task, outcome).catch((error) => console.warn('[tasks] Not recorded:', error))
  }
  return {
    done: () => end({ status: 'done' }),
    failed: (error) =>
      end({
        status: 'failed',
        error: messageOf(error),
        result: error && typeof error === 'object' ? keptOnFailure.get(error) : undefined,
      }),
  }
}

/** Runs a button's AI work on a project, recorded as a task while it runs (see startTracking). */
export async function tracked<T>(
  projectId: string,
  kind: TaskKind,
  work: () => Promise<T>,
  input: TaskInput = {},
): Promise<T> {
  const task = await startTracking(projectId, kind, input)
  try {
    const result = await work()
    await task.done()
    return result
  } catch (error) {
    await task.failed(error)
    throw error
  }
}

/** Renews a running task's lease while this process works on it. Returns the function that stops. */
export function holdLease(task: TaskRow): () => void {
  const timer = setInterval(() => {
    void db()
      .then((database) =>
        database
          .update(schema.tasks)
          .set({ leaseUntil: lease() })
          .where(
            and(
              eq(schema.tasks.id, task.id),
              eq(schema.tasks.status, 'running'),
              eq(schema.tasks.attempts, task.attempts),
            ),
          ),
      )
      .catch((error) => console.warn('[tasks] Lease not renewed:', error))
  }, RENEW_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * Takes the next queued task for this run, in the order they were queued. One conditional update,
 * so two runs asking at once never both get it, and none is handed out while another queued task
 * runs: one at a time keeps the queue within Gemini's free per-minute limit.
 */
export async function claimTask(): Promise<TaskRow | null> {
  const database = await db()
  const now = new Date()
  const next = database
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.inline, false), eq(schema.tasks.status, 'queued')))
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.position))
    .limit(1)
  const running = database
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.inline, false),
        eq(schema.tasks.status, 'running'),
        gt(schema.tasks.leaseUntil, now),
      ),
    )
  const [task] = await database
    .update(schema.tasks)
    .set({
      status: 'running',
      attempts: sql`${schema.tasks.attempts} + 1`,
      leaseUntil: lease(),
      startedAt: now,
      updatedAt: now,
    })
    .where(and(inArray(schema.tasks.id, next), eq(schema.tasks.status, 'queued'), notExists(running)))
    .returning()
  return task ?? null
}

/**
 * Records how a run ended. Only the run that holds the task may, so a run that lost it (its lease
 * ran out and another took over) changes nothing. Returns whether it was recorded.
 */
export async function finishTask(
  task: TaskRow,
  outcome: { status: 'done'; result?: TaskResult } | { status: 'failed'; error: string; result?: TaskResult },
): Promise<boolean> {
  const database = await db()
  const now = new Date()
  const rows = await database
    .update(schema.tasks)
    .set({
      status: outcome.status,
      result: outcome.result ?? null,
      error: outcome.status === 'failed' ? outcome.error : null,
      leaseUntil: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.tasks.id, task.id),
        eq(schema.tasks.status, 'running'),
        eq(schema.tasks.attempts, task.attempts),
      ),
    )
    .returning({ id: schema.tasks.id })
  return rows.length > 0
}

/** Cancels the tasks of a batch that have not started, saying why. */
export async function cancelBatch(batchId: string, reason: string, projectId?: string): Promise<void> {
  const database = await db()
  const now = new Date()
  await database
    .update(schema.tasks)
    .set({ status: 'cancelled', error: reason, finishedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.tasks.batchId, batchId),
        eq(schema.tasks.status, 'queued'),
        projectId ? eq(schema.tasks.projectId, projectId) : undefined,
      ),
    )
}

/** Cancels a project's queued tasks of this kind, saying why. */
export async function cancelQueued(projectId: string, kind: TaskKind, reason: string): Promise<void> {
  const database = await db()
  const now = new Date()
  await database
    .update(schema.tasks)
    .set({ status: 'cancelled', error: reason, finishedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.kind, kind),
        eq(schema.tasks.status, 'queued'),
      ),
    )
}

/**
 * Cancels what is left of the task's project in its batch when that builds on this task (CHAINED):
 * the rest of that draft. Anything else goes on.
 */
export async function skipRest(task: TaskRow, reason = SKIPPED): Promise<void> {
  if (task.batchId && task.projectId && CHAINED.includes(task.kind)) {
    await cancelBatch(task.batchId, reason, task.projectId)
  }
}

/**
 * Picks up runs that died: running, but the lease ran out. A queued task goes back in the queue
 * (keeping its place) to be tried once more, then is given up along with the rest of its draft; a
 * button's request is marked failed.
 */
export async function recoverStale(): Promise<void> {
  const database = await db()
  const now = new Date()
  const stale = and(eq(schema.tasks.status, 'running'), lt(schema.tasks.leaseUntil, now))
  const ended = { leaseUntil: null, finishedAt: now, updatedAt: now }
  await database
    .update(schema.tasks)
    .set({ status: 'failed', error: DIED, ...ended })
    .where(and(stale, eq(schema.tasks.inline, true)))
  const given = await database
    .update(schema.tasks)
    .set({ status: 'failed', error: DIED_TWICE, ...ended })
    .where(and(stale, eq(schema.tasks.inline, false), gte(schema.tasks.attempts, MAX_ATTEMPTS)))
    .returning()
  for (const task of given) await skipRest(task)
  await database
    .update(schema.tasks)
    .set({ status: 'queued', leaseUntil: null, updatedAt: now })
    .where(and(stale, eq(schema.tasks.inline, false)))
}

/** Whether queued work waits (also a task whose run died), and whether a run holds a task now. */
export async function queueState(): Promise<{ waiting: boolean; running: boolean }> {
  const database = await db()
  const now = new Date()
  const rows = await database
    .select({ status: schema.tasks.status, leaseUntil: schema.tasks.leaseUntil })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.inline, false), inArray(schema.tasks.status, ['queued', 'running'])))
  const held = (r: (typeof rows)[number]) =>
    r.status === 'running' && r.leaseUntil !== null && r.leaseUntil > now
  return { waiting: rows.some((r) => !held(r)), running: rows.some(held) }
}

/** A batch's tasks, in the order they run. */
export async function batchTasks(batchId: string): Promise<TaskRow[]> {
  const database = await db()
  return database
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.batchId, batchId))
    .orderBy(asc(schema.tasks.position))
}

/** The newest batch with a task of this kind (for this project, if given), or null. */
export async function latestBatchId(kind: TaskKind, projectId?: string): Promise<string | null> {
  const database = await db()
  const [row] = await database
    .select({ batchId: schema.tasks.batchId })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.kind, kind),
        isNotNull(schema.tasks.batchId),
        projectId ? eq(schema.tasks.projectId, projectId) : undefined,
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1)
  return row?.batchId ?? null
}

/**
 * How far the project's newest Images → Generate missing got, as the Images step shows it: counted
 * in scenes (a task makes up to two), with the ones Gemini didn't make and why. Null before the
 * first.
 */
export async function pictureBatch(projectId: string): Promise<PictureBatchDTO | null> {
  const id = await latestBatchId('picture', projectId)
  const tasks = id ? await batchTasks(id) : []
  if (!id || tasks.length === 0) return null
  const open = (t: TaskRow) => t.status === 'queued' || t.status === 'running'
  const scenes = (t: TaskRow) => t.input.sceneIds ?? []
  const count = (list: TaskRow[]) => list.reduce((n, t) => n + scenes(t).length, 0)
  const done = tasks.filter((t) => t.status === 'done')
  // A task that failed as a whole (no key, or its run died twice) failed each of its scenes.
  const failed = tasks.flatMap((t) =>
    t.status === 'failed'
      ? scenes(t).map((sceneId) => ({ sceneId, error: t.error ?? 'Something went wrong.' }))
      : (t.result?.failed ?? []),
  )
  const running = tasks.some(open)
  return {
    id,
    done: count(tasks.filter((t) => !open(t))),
    total: count(tasks),
    running,
    made: count(done) - done.reduce((n, t) => n + (t.result?.failed?.length ?? 0), 0),
    failed,
    stopped: tasks.find((t) => t.status === 'cancelled')?.error ?? null,
    finishedAt: running
      ? null
      : new Date(Math.max(...tasks.map((t) => (t.finishedAt ?? t.createdAt).getTime()))).toISOString(),
  }
}

/** Clears tasks that ended (or whose request died) more than two weeks ago. Returns how many. */
export async function pruneTasks(): Promise<number> {
  const database = await db()
  const before = new Date(Date.now() - KEEP_MS)
  const rows = await database
    .delete(schema.tasks)
    .where(
      or(
        and(
          inArray(schema.tasks.status, ['done', 'failed', 'cancelled']),
          lt(schema.tasks.finishedAt, before),
        ),
        and(eq(schema.tasks.status, 'running'), lt(schema.tasks.leaseUntil, before)),
      ),
    )
    .returning({ id: schema.tasks.id })
  return rows.length
}
