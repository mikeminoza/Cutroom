'use client'

import type { VideoFormat } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectSummary } from '@/lib/dto'
import { formatLength, formatWhen, timeAgo } from '@/lib/format'
import { keys, useProjects } from '@/lib/hooks'
import { nextStep, STATUS_LABEL, statusTone } from '@/lib/stage'
import { MiniStrip } from './filmstrip'
import { Button, Dialog, Dot, Field, Input, ProgressBar, StatusPill, Textarea } from './ui'

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects()
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">Projects</h1>
          <p className="mt-2 max-w-[60ch] text-[14.5px] text-ink-2">
            Each project turns a script, a voice-over and your images into a scheduled YouTube video.
          </p>
        </div>
        <Button variant="go" size="lg" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New video
        </Button>
      </header>

      {error ? (
        <p className="rounded-[var(--radius-panel)] border border-bad/30 bg-bad-wash px-5 py-4 text-[14px] text-bad">
          Projects could not be loaded: {errorText(error)}
        </p>
      ) : isLoading ? (
        <ListSkeleton />
      ) : projects && projects.length > 0 ? (
        <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      ) : (
        <EmptyState onCreate={() => setCreating(true)} />
      )}

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const imagesDone = project.frames.filter((f) => f.imageUrl).length
  const stageInput = {
    status: project.status,
    scheduledAt: project.scheduledAt,
    hasScript: project.hasScript,
    sceneCount: project.frames.length,
    imagesDone,
    hasVoiceover: project.hasVoiceover,
    timed: project.timed,
  }
  const next = nextStep(stageInput)
  const tone = statusTone(project.status)
  const yourMove = ['draft', 'scripted', 'timed', 'ready', 'awaiting_approval', 'failed'].includes(
    project.status,
  )
  const active = project.job && ['queued', 'running'].includes(project.job.status)

  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={`/projects/${project.id}?step=${next.step}`}
        className="group grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 transition-colors hover:bg-sunk sm:px-5 md:grid-cols-[240px_1fr_auto] md:items-center"
      >
        <MiniStrip frames={project.frames} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="wide truncate text-[16.5px] font-semibold">{project.title || 'Untitled video'}</h2>
            <StatusPill tone={tone}>{STATUS_LABEL[project.status]}</StatusPill>
            <span className="text-[12.5px] text-ink-3">
              {project.format === 'portrait' ? 'Short' : 'Video'}
            </span>
          </div>
          {project.topic && (
            <p className="mt-1 line-clamp-1 max-w-[70ch] text-[13.5px] text-ink-2">{project.topic}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[13.5px]">
            {active ? (
              <div className="flex w-full max-w-sm items-center gap-3">
                <span className="truncate text-run">{project.job?.detail ?? 'Working…'}</span>
                <ProgressBar value={project.job?.progress ?? null} className="w-28 shrink-0" />
              </div>
            ) : (
              <>
                {yourMove && next.text !== 'Done' && <Dot tone="you" />}
                <span className={cn(yourMove ? 'font-medium text-ink' : 'text-ink-2')}>{next.text}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-5 text-right md:justify-end">
          <div className="flex flex-col items-end gap-0.5">
            <span className="tc text-[15px] font-medium">{formatLength(project.duration)}</span>
            <span className="text-[12.5px] whitespace-nowrap text-ink-3">
              {project.scheduledAt && ['scheduled', 'published'].includes(project.status)
                ? `${project.status === 'published' ? 'Posted' : 'Goes live'} ${formatWhen(project.scheduledAt)}`
                : `Edited ${timeAgo(project.updatedAt)}`}
            </span>
          </div>
          <ChevronRight className="hidden size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink md:block" />
        </div>
      </Link>
    </li>
  )
}

function ListSkeleton() {
  return (
    <ul aria-busy className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="grid grid-cols-[240px_1fr] items-center gap-6 border-b border-line px-5 py-4 last:border-b-0"
        >
          <div className="h-14 animate-pulse-soft rounded-[6px] bg-film/80" />
          <div className="flex flex-col gap-2">
            <div className="h-4 w-56 animate-pulse-soft rounded bg-sunk" />
            <div className="h-3 w-80 animate-pulse-soft rounded bg-sunk" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    [
      'Write the script',
      'Paste yours, or let Gemini draft it. It is split into timed scenes with an image prompt for each.',
    ],
    [
      'Add the voice-over',
      'Upload your recording. Gemini listens and moves every scene to where its words are spoken.',
    ],
    [
      'Upload one image per scene',
      'Copy each prompt into your image tool with your avatar, then drop the result into its scene.',
    ],
    [
      'Finish & schedule',
      'The worker renders the video, saves it to Drive and posts it to YouTube in your next free slot.',
    ],
  ]
  return (
    <section className="grid gap-10 rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-10 sm:px-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div>
        <h2 className="display text-[26px]">Start your first video</h2>
        <p className="mt-3 max-w-[48ch] text-[14.5px] leading-relaxed text-ink-2">
          You bring the script, the voice and the pictures. Cutroom handles timing, editing, the upload and
          the schedule.
        </p>
        <Button variant="go" size="lg" className="mt-6" icon={<Plus className="size-4" />} onClick={onCreate}>
          New video
        </Button>
      </div>
      <ol className="flex flex-col gap-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="tc grid size-7 place-items-center rounded-full border border-line-strong text-[12.5px] font-semibold text-ink-2">
              {i + 1}
            </span>
            <div>
              <h3 className="text-[14.5px] font-semibold">{title}</h3>
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FormatOption({
  value,
  selected,
  onSelect,
  title,
  detail,
}: {
  value: VideoFormat
  selected: boolean
  onSelect: () => void
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-4 rounded-[var(--radius-control)] border p-3.5 text-left transition-colors',
        selected ? 'border-ink bg-kodak-wash' : 'border-line hover:border-line-strong',
      )}
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center">
        <span
          aria-hidden
          className={cn('rounded-[3px] border-2', selected ? 'border-ink bg-kodak' : 'border-ink-3')}
          style={value === 'portrait' ? { width: 27, height: 48 } : { width: 52, height: 29 }}
        />
      </span>
      <span>
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="block text-[12.5px] text-ink-2">{detail}</span>
      </span>
    </button>
  )
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const client = useQueryClient()
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState<VideoFormat>('landscape')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const { id } = await api.post<{ id: string }>('/api/projects', { title, topic, format })
      await client.invalidateQueries({ queryKey: keys.projects })
      onOpenChange(false)
      setTitle('')
      setTopic('')
      router.push(`/projects/${id}?step=${topic.trim() ? 'script' : 'brief'}`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New video"
      description="You can change all of this later."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="go" busy={busy} onClick={create}>
            Create project
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div role="radiogroup" aria-label="Format" className="grid gap-2.5 sm:grid-cols-2">
          <FormatOption
            value="landscape"
            selected={format === 'landscape'}
            onSelect={() => setFormat('landscape')}
            title="Video"
            detail="16:9, long-form"
          />
          <FormatOption
            value="portrait"
            selected={format === 'portrait'}
            onSelect={() => setFormat('portrait')}
            title="Short"
            detail="9:16, up to 3 minutes"
          />
        </div>
        <Field
          label="What is the video about?"
          hint="One or two sentences. Gemini uses this if you ask it to write the script."
        >
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Why octopuses are smarter than we thought"
            className="min-h-20"
            autoFocus
          />
        </Field>
        <Field label="Working title" aside="Optional">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave empty to decide later"
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
