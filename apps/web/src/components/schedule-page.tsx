'use client'

import type { ProjectStatus } from '@cutroom/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import { keys } from '@/lib/hooks'
import { STATUS_LABEL, statusTone } from '@/lib/stage'
import { Button, Dialog, Field, Input, StatusPill } from './ui'

interface Entry {
  at: string
  project: {
    id: string
    title: string
    status: ProjectStatus
    format: string
    youtubeVideoId: string | null
  } | null
}

interface ScheduleData {
  timezone: string
  entries: Entry[]
  recent: Entry[]
}

function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function weekLabel(iso: string, timeZone: string) {
  const date = new Date(iso)
  const days = Math.floor((date.getTime() - Date.now()) / 86_400_000)
  if (days < 7) return 'This week'
  if (days < 14) return 'Next week'
  return `Week of ${new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric' }).format(date)}`
}

export function SchedulePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: keys.schedule,
    queryFn: () => api.get<ScheduleData>('/api/schedule'),
  })
  const [moving, setMoving] = useState<Entry | null>(null)

  const tz = data?.timezone ?? 'UTC'
  const groups: { label: string; entries: Entry[] }[] = []
  for (const entry of data?.entries ?? []) {
    const label = weekLabel(entry.at, tz)
    const group = groups.find((g) => g.label === label)
    if (group) group.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  const booked = data?.entries.filter((e) => e.project).length ?? 0
  const open = (data?.entries.length ?? 0) - booked

  return (
    <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">Schedule</h1>
          <p className="mt-2 text-[14.5px] text-ink-2">
            {data ? (
              <>
                {booked} booked, {open} open in the next four weeks. Times are in {tz.replace(/_/g, ' ')}.
              </>
            ) : (
              'Your posting slots for the next four weeks.'
            )}
          </p>
        </div>
        <Link href="/settings#schedule">
          <Button variant="plain">Edit posting slots</Button>
        </Link>
      </header>

      {error && <p className="text-[14px] text-bad">Could not load the schedule: {errorText(error)}</p>}
      {isLoading && <div className="h-64 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />}

      {data && data.entries.length === 0 && (
        <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-12 text-center">
          <p className="text-[14.5px] text-ink-2">
            No posting slots yet. Add the days and times you want to post on.
          </p>
          <Link href="/settings#schedule" className="mt-4 inline-block">
            <Button variant="go">Add posting slots</Button>
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="wide mb-3 text-[15px] font-semibold text-ink-2">{group.label}</h2>
            <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
              {group.entries.map((entry) => (
                <SlotRow
                  key={entry.at + (entry.project?.id ?? '')}
                  entry={entry}
                  timeZone={tz}
                  onMove={() => setMoving(entry)}
                />
              ))}
            </ul>
          </section>
        ))}

        {data && data.recent.length > 0 && (
          <section>
            <h2 className="wide mb-3 text-[15px] font-semibold text-ink-2">Recently posted</h2>
            <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
              {data.recent.map((entry) => (
                <SlotRow key={entry.at + (entry.project?.id ?? '')} entry={entry} timeZone={tz} past />
              ))}
            </ul>
          </section>
        )}
      </div>
      <MoveDialog entry={moving} onClose={() => setMoving(null)} />
    </div>
  )
}

function SlotRow({
  entry,
  timeZone,
  onMove,
  past,
}: {
  entry: Entry
  timeZone: string
  onMove?: () => void
  past?: boolean
}) {
  const date = new Date(entry.at)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
  const day = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date)
  const sameDayAsPrevious = false
  return (
    <li
      className={cn(
        'grid grid-cols-[96px_1fr_auto] items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0',
        !entry.project && 'bg-sunk/50',
      )}
    >
      <div className={cn(sameDayAsPrevious && 'invisible')} data-day={dayKey(entry.at, timeZone)}>
        <p className="text-[12.5px] text-ink-3">
          {weekday}, {day}
        </p>
        <p className="tc text-[17px] font-semibold">{time}</p>
      </div>
      {entry.project ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/projects/${entry.project.id}?step=publish`}
            className="wide truncate text-[15px] font-semibold hover:underline"
          >
            {entry.project.title || 'Untitled video'}
          </Link>
          <StatusPill tone={statusTone(entry.project.status)}>
            {STATUS_LABEL[entry.project.status]}
          </StatusPill>
        </div>
      ) : (
        <p className="text-[14px] text-ink-3">Open slot</p>
      )}
      <div className="flex gap-1.5">
        {entry.project?.youtubeVideoId && (
          <a
            href={`https://studio.youtube.com/video/${entry.project.youtubeVideoId}/edit`}
            target="_blank"
            rel="noreferrer"
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open in YouTube Studio"
              icon={<ExternalLink className="size-3.5" />}
            />
          </a>
        )}
        {entry.project && !past && onMove && (
          <Button variant="plain" size="sm" onClick={onMove}>
            Move
          </Button>
        )}
      </div>
    </li>
  )
}

function MoveDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const client = useQueryClient()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!entry?.project || !value) return
    setBusy(true)
    try {
      await api.put(`/api/projects/${entry.project.id}/schedule`, { at: new Date(value).toISOString() })
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.schedule }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      toast.success(entry.project.youtubeVideoId ? 'Moved on YouTube too' : 'Moved')
      onClose()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={Boolean(entry)}
      onOpenChange={(open) => !open && onClose()}
      title={`Move "${entry?.project?.title || 'Untitled video'}"`}
      description={
        entry?.project?.youtubeVideoId
          ? 'It is already uploaded, so the new time is also set on YouTube.'
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="go" busy={busy} disabled={!value} onClick={save}>
            Move
          </Button>
        </>
      }
    >
      <Field label="New date and time" hint="Your browser's local time. At least 15 minutes from now.">
        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Dialog>
  )
}
