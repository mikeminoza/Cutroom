'use client'

// Settings → Worker → Test the worker: a run that goes the way a real job does and reports each
// part, so a setup problem shows up before a real video runs into it.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, ExternalLink, LoaderCircle, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { WorkerCheckDTO } from '@/lib/dto'
import { timeAgo } from '@/lib/format'
import { keys } from '@/lib/hooks'
import { ButtonLink } from './ui'

const running = (check: WorkerCheckDTO | null) =>
  check !== null && (check.status === 'queued' || check.status === 'running')

/** The latest check, polled while it runs, and a way to start one. */
export function useWorkerCheck(enabled: boolean) {
  const client = useQueryClient()
  const [starting, setStarting] = useState(false)
  const query = useQuery({
    queryKey: keys.workerCheck,
    queryFn: async () => (await api.get<{ check: WorkerCheckDTO | null }>('/api/worker-check')).check,
    enabled,
    refetchInterval: (q) => (running(q.state.data ?? null) ? 3000 : false),
  })
  const check = query.data ?? null

  const start = async () => {
    setStarting(true)
    try {
      const next = (await api.post<{ check: WorkerCheckDTO }>('/api/worker-check')).check
      client.setQueryData(keys.workerCheck, next)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setStarting(false)
    }
  }

  return { check, start, busy: starting || running(check) }
}

const STEP_ICON = {
  pending: { icon: Circle, className: 'text-ink-3' },
  running: { icon: LoaderCircle, className: 'animate-spin text-run' },
  waiting: { icon: LoaderCircle, className: 'animate-spin text-run' },
  done: { icon: Check, className: 'text-ok' },
  failed: { icon: X, className: 'text-bad' },
  skipped: { icon: Minus, className: 'text-ink-3' },
} as const

/** The latest check, as a row under the Worker row in Settings. */
export function WorkerCheckResult({ check }: { check: WorkerCheckDTO }) {
  const busy = running(check)
  const failedToStart = check.steps[0]?.status === 'failed'
  return (
    <li className="px-5 py-4 sm:pl-[calc(160px+2.75rem)]" aria-live="polite">
      <p
        className={cn(
          'text-[14px] font-medium',
          check.status === 'done' && 'text-ok',
          check.status === 'failed' && 'text-bad',
        )}
      >
        {busy
          ? 'Testing the worker…'
          : check.status === 'done'
            ? 'The worker works: it can make and save your videos.'
            : 'The worker needs fixing before it can make videos.'}
        <span className="ml-2 text-[12.5px] font-normal text-ink-3">
          {busy ? `started ${timeAgo(check.createdAt)}` : timeAgo(check.finishedAt ?? check.createdAt)}
        </span>
      </p>
      {busy && check.mode === 'github' && (
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          Takes 2–4 minutes on GitHub Actions, mostly starting a machine and installing ffmpeg. You can leave
          this page.
        </p>
      )}
      <ol className="mt-3 flex flex-col gap-2">
        {check.steps.map((step) => {
          const { icon: Icon, className } = STEP_ICON[step.status]
          return (
            <li key={step.key} className="flex items-start gap-2.5 text-[13.5px]">
              <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden strokeWidth={2.5} />
              <span className="min-w-0">
                <span
                  className={cn(step.status === 'pending' || step.status === 'skipped' ? 'text-ink-3' : '')}
                >
                  {step.label}
                </span>
                <span className="sr-only"> ({step.status})</span>
                {step.detail && (
                  <span
                    className={cn(
                      'block text-[12.5px] leading-snug break-words',
                      step.status === 'failed' ? 'text-bad' : 'text-ink-3',
                    )}
                  >
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {failedToStart && check.runsUrl && (
        <ButtonLink
          href={check.runsUrl}
          size="sm"
          variant="ghost"
          className="mt-3"
          icon={<ExternalLink className="size-3.5" />}
          target="_blank"
          rel="noreferrer"
        >
          The worker's runs on GitHub
        </ButtonLink>
      )}
      {check.clipUrl && (
        <figure className="mt-3">
          {/* biome-ignore lint/a11y/useMediaCaption: a silent test pattern with burned-in captions. */}
          <video
            src={check.clipUrl}
            controls
            preload="metadata"
            className="aspect-video w-full max-w-sm rounded-[var(--radius-control)] bg-film"
          />
          <figcaption className="mt-1 text-[12.5px] text-ink-3">
            The test clip, made by the worker the way it makes your videos.
          </figcaption>
        </figure>
      )}
    </li>
  )
}
