'use client'

import type { JobStep } from '@cutroom/shared/protocol'
import { AlertTriangle, Check, Circle, CircleDashed, Hand, LoaderCircle, X } from 'lucide-react'
import { ProgressBar } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { JobDTO } from '@/lib/dto'

function StepIcon({ step }: { step: JobStep }) {
  switch (step.status) {
    case 'done':
      return (
        <span className="grid size-5 place-items-center rounded-full bg-ok text-panel">
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )
    case 'running':
      return <LoaderCircle className="size-5 animate-spin text-run" aria-hidden />
    case 'waiting':
      return (
        <span className="grid size-5 place-items-center rounded-full bg-kodak text-ink">
          <Hand className="size-3" aria-hidden />
        </span>
      )
    case 'failed':
      return (
        <span className="grid size-5 place-items-center rounded-full bg-bad text-panel">
          <X className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )
    case 'skipped':
      return <CircleDashed className="size-5 text-ink-3" aria-hidden />
    default:
      return <Circle className="size-5 text-line-strong" aria-hidden />
  }
}

const STATUS_WORD: Record<JobStep['status'], string> = {
  done: 'Done',
  running: 'In progress',
  waiting: 'Waiting for you',
  failed: 'Failed',
  skipped: 'Skipped',
  pending: 'Not started',
}

/** The job's steps in order. The running step shows live detail and progress. */
export function JobSteps({ job, className }: { job: JobDTO; className?: string }) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {job.steps.map((step, i) => {
        const live = step.status === 'running' && job.progressStep === step.key
        const detail = live ? (job.progressDetail ?? step.detail) : step.detail
        const last = i === job.steps.length - 1
        return (
          <li key={step.key} className="grid grid-cols-[20px_1fr] gap-x-3">
            <div className="flex flex-col items-center">
              <StepIcon step={step} />
              {!last && (
                <span
                  aria-hidden
                  className={cn('w-px flex-1', step.status === 'done' ? 'bg-ok/50' : 'bg-line')}
                />
              )}
            </div>
            <div className={cn('min-w-0', last ? 'pb-0' : 'pb-4')}>
              <p
                className={cn(
                  'text-[14px] leading-5',
                  step.status === 'pending' || step.status === 'skipped'
                    ? 'text-ink-3'
                    : 'font-medium text-ink',
                )}
              >
                {step.label}
                <span className="sr-only">: {STATUS_WORD[step.status]}</span>
              </p>
              {detail && (
                <p
                  className={cn(
                    'mt-0.5 text-[13px] leading-snug break-words',
                    step.status === 'failed'
                      ? 'text-bad'
                      : step.status === 'waiting'
                        ? 'text-kodak-ink'
                        : 'text-ink-2',
                  )}
                >
                  {detail}
                </p>
              )}
              {live && <ProgressBar value={job.progress} className="mt-2 max-w-sm" />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <ul className="flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-kodak-wash px-3.5 py-3 text-[13px] text-kodak-ink">
      {warnings.map((w, i) => (
        <li key={i} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  )
}
