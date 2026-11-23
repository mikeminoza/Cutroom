'use client'

import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ProjectFull, TaskDTO } from '@/lib/dto'
import { elapsedSince } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { TASK_DOING, type TaskKind } from '@/lib/tasks'

/** The project's AI work of these kinds that is running (or queued) on the server, if any. */
export function runningTask(data: ProjectFull, kinds: TaskKind[]): TaskDTO | null {
  return data.tasks.find((t) => kinds.includes(t.kind)) ?? null
}

/**
 * Gemini still at work on the server for a page opened (or reloaded) meanwhile: "Gemini is still
 * writing this script (started 40 s ago)…". The page checks every few seconds and shows the
 * result once it's saved, so its button stays off until then.
 */
export function StillRunning({ task, className }: { task: TaskDTO | null; className?: string }) {
  const now = useNow(Boolean(task))
  if (!task) return null
  const doing = TASK_DOING[task.kind]
  return (
    <p
      className={cn('flex items-start gap-2 text-[13px] leading-snug text-ink-2', className)}
      aria-live="polite"
    >
      <Spinner className="mt-px shrink-0 text-ink-3" />
      <span>
        {task.status === 'queued' || !task.startedAt
          ? `Waiting its turn: Gemini starts ${doing} when the work ahead of it is done.`
          : `Gemini is still ${doing} (started ${elapsedSince(task.startedAt, now)} ago)…`}{' '}
        It shows here once it’s done; you can close this page meanwhile.
      </span>
    </p>
  )
}
