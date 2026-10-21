'use client'

import { totalDuration } from '@cutroom/shared/timing'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Layers, MoreHorizontal, Smartphone, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useHydrated } from '@/components/client-only'
import { Filmstrip } from '@/components/filmstrip'
import { Button, Menu, StatusPill, useConfirm } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectFull } from '@/lib/dto'
import { keys, useProject, useSaver, useSeriesList } from '@/lib/hooks'
import { nextStep, STATUS_LABEL, type StepId, statusTone } from '@/lib/stage'
import { BriefStep } from './brief'
import { CharactersStep } from './characters'
import { ImagesStep } from './images'
import { PreviewStep } from './preview'
import { SeriesDialog, ShortDialog } from './project-dialogs'
import { PublishStep } from './publish'
import { ScriptStep } from './script'
import { VoiceoverStep } from './voiceover'

const STEPS: { id: StepId; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'characters', label: 'Characters' },
  { id: 'script', label: 'Script' },
  { id: 'voiceover', label: 'Voice-over' },
  { id: 'images', label: 'Images' },
  { id: 'preview', label: 'Preview' },
  { id: 'publish', label: 'Publish' },
]

export interface StepProps {
  data: ProjectFull
  selectedSceneId: string | null
  selectScene: (id: string | null) => void
  goTo: (step: StepId, sceneId?: string) => void
}

export function stageOf(data: ProjectFull) {
  const { project, scenes } = data
  return {
    status: project.status,
    scheduledAt: project.scheduledAt,
    hasScript: Boolean(project.script.trim()),
    sceneCount: scenes.length,
    imagesDone: scenes.filter((s) => s.imageUrl).length,
    hasVoiceover: Boolean(project.voiceoverUrl),
    timed:
      Boolean(project.transcript) ||
      Boolean(
        project.voiceoverDuration &&
          scenes.length &&
          Math.abs(totalDuration(scenes) - project.voiceoverDuration) < 1,
      ),
  }
}

export function Workspace({ id }: { id: string }) {
  const { data, isLoading, error } = useProject(id)
  const hydrated = useHydrated()
  const skeleton = (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
      <div className="h-8 w-72 max-w-full animate-pulse-soft rounded bg-line" />
      <div className="mt-6 h-10 w-full animate-pulse-soft rounded bg-line/60" />
      <div className="mt-6 h-[140px] w-full animate-pulse-soft rounded-[var(--radius-panel)] bg-film/80" />
    </div>
  )
  if (!hydrated) return skeleton
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="display text-[24px]">This project could not be opened</h1>
        <p className="mt-2 text-[14px] text-ink-2">{errorText(error)}</p>
        <Link href="/" className="mt-6 inline-block text-[14px] font-medium underline underline-offset-4">
          Back to projects
        </Link>
      </div>
    )
  }
  if (isLoading || !data) return skeleton
  return <Loaded data={data} />
}

function Loaded({ data }: { data: ProjectFull }) {
  const { project, scenes } = data
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const client = useQueryClient()
  const { saver, state: saveState } = useSaver(project.id)
  const { confirm, element: confirmDialog } = useConfirm()
  const stage = stageOf(data)
  const next = nextStep(stage)
  const step = (params.get('step') as StepId) || next.step
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(params.get('scene'))
  const [dialog, setDialog] = useState<'short' | 'series' | null>(null)
  const stepsRef = useRef<HTMLElement>(null)
  const seriesList = useSeriesList()

  // On narrow screens the step bar scrolls sideways: keep the current step centred in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes; it reads the DOM
  useEffect(() => {
    const nav = stepsRef.current
    const current = nav?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return
    const offset = current.getBoundingClientRect().left - nav.getBoundingClientRect().left
    nav.scrollBy({ left: offset - (nav.clientWidth - current.offsetWidth) / 2, behavior: 'smooth' })
  }, [step])
  const series = seriesList.data?.find((s) => s.id === project.seriesId) ?? null

  const goTo = useCallback(
    (target: StepId, sceneId?: string) => {
      const search = new URLSearchParams(params.toString())
      search.set('step', target)
      if (sceneId) {
        search.set('scene', sceneId)
        setSelectedSceneId(sceneId)
      }
      router.replace(`${pathname}?${search.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const done: Record<StepId, boolean> = {
    brief: Boolean(project.topic.trim()),
    characters: data.characters.some((c) => c.images.length > 0),
    script: scenes.length > 0,
    voiceover: stage.timed,
    images: scenes.length > 0 && stage.imagesDone === scenes.length,
    preview: false,
    publish: ['scheduled', 'published', 'rendered'].includes(project.status),
  }

  useJobNotifications(data)

  const duration = project.voiceoverDuration ?? totalDuration(scenes)
  const showStrip = scenes.length > 0 && step !== 'brief' && step !== 'characters'
  const yourMove = ['draft', 'scripted', 'timed', 'ready', 'awaiting_approval', 'failed'].includes(
    project.status,
  )

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this project?',
      body: 'The scenes, uploaded files and settings for this video are deleted. Videos already on YouTube or in Google Drive stay there.',
      action: 'Delete project',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/api/projects/${project.id}`)
      await client.invalidateQueries({ queryKey: keys.projects })
      toast.success('Project deleted')
      router.push('/')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const onFrameSelect = (sceneId: string) => {
    setSelectedSceneId(sceneId)
    if (step === 'voiceover') goTo('images', sceneId)
    else goTo(step, sceneId)
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-20 sm:px-8">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link href="/" className="inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
            <ChevronLeft className="size-3.5" aria-hidden />
            Projects
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <TitleEditor value={project.title} onChange={(title) => saver.project({ title })} />
            <StatusPill tone={statusTone(project.status)}>{STATUS_LABEL[project.status]}</StatusPill>
            {series && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-[3px] text-[12.5px] text-ink-2">
                <Layers className="size-3" aria-hidden />
                {series.name}
              </span>
            )}
            <span className="text-[12.5px] text-ink-3" aria-live="polite">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'All changes saved'
                  : saveState === 'error'
                    ? 'Not saved'
                    : ''}
            </span>
          </div>
        </div>
        <Menu
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label="Project actions"
              icon={<MoreHorizontal className="size-4" />}
            />
          }
          items={[
            ...(project.format === 'landscape' && scenes.length > 0
              ? [
                  {
                    label: 'Make a Short from this…',
                    onSelect: () => setDialog('short'),
                    icon: <Smartphone className="size-3.5" />,
                  },
                ]
              : []),
            {
              label: series ? `Update “${series.name}” from this…` : 'Save as a series…',
              onSelect: () => setDialog('series'),
              icon: <Layers className="size-3.5" />,
            },
            'divider' as const,
            {
              label: 'Delete project',
              danger: true,
              onSelect: remove,
              icon: <Trash2 className="size-3.5" />,
            },
          ]}
        />
      </header>

      {yourMove && next.step !== step && next.text !== 'Done' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-kodak-wash px-4 py-2.5 text-[14px] text-kodak-ink">
          <span className="size-2 rounded-full bg-kodak" aria-hidden />
          <span>
            Next: <strong className="font-semibold">{next.text}</strong>
          </span>
          <Button variant="dark" size="sm" className="ml-auto" onClick={() => goTo(next.step)}>
            Go to {STEPS.find((s) => s.id === next.step)?.label}
          </Button>
        </div>
      )}

      <nav
        ref={stepsRef}
        aria-label="Steps"
        className="mt-5 -mx-4 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-28px),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
      >
        <ol className="flex min-w-max border-b border-line">
          {STEPS.map((item, i) => {
            const current = item.id === step
            const attention = !done[item.id] && next.step === item.id && yourMove
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => goTo(item.id)}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'relative flex items-center gap-2 px-3.5 pt-2 pb-3 text-[14px] transition-colors',
                    current ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  <span
                    className={cn(
                      'tc grid size-5 place-items-center rounded-full text-[11px] font-semibold',
                      done[item.id]
                        ? 'bg-ink text-paper'
                        : attention
                          ? 'bg-kodak text-on-kodak'
                          : current
                            ? 'border border-ink text-ink'
                            : 'border border-line-strong text-ink-3',
                    )}
                  >
                    {done[item.id] ? <Check className="size-3" strokeWidth={3} aria-label="done" /> : i + 1}
                  </span>
                  {item.label}
                  {item.id === 'characters' && (
                    <span className="text-[12px] font-normal text-ink-3">optional</span>
                  )}
                  {current && (
                    <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink" />
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {showStrip && (
        <div className="mt-5">
          <Filmstrip
            frames={scenes.map((s) => ({
              id: s.id,
              index: s.index,
              start: s.start,
              end: s.end,
              imageUrl: s.imageUrl,
            }))}
            duration={duration}
            selectedId={selectedSceneId}
            onSelect={onFrameSelect}
            archived={project.archived}
          />
        </div>
      )}

      <div className="mt-6">
        <StepContent
          step={step}
          data={data}
          selectedSceneId={selectedSceneId}
          selectScene={setSelectedSceneId}
          goTo={goTo}
        />
      </div>
      {confirmDialog}
      <ShortDialog
        data={data}
        open={dialog === 'short'}
        onOpenChange={(open) => setDialog(open ? 'short' : null)}
      />
      <SeriesDialog
        data={data}
        series={series}
        open={dialog === 'series'}
        onOpenChange={(open) => setDialog(open ? 'series' : null)}
      />
    </div>
  )
}

function StepContent({ step, ...props }: StepProps & { step: StepId }) {
  switch (step) {
    case 'brief':
      return <BriefStep {...props} />
    case 'characters':
      return <CharactersStep {...props} />
    case 'script':
      return <ScriptStep {...props} />
    case 'voiceover':
      return <VoiceoverStep {...props} />
    case 'images':
      return <ImagesStep {...props} />
    case 'preview':
      return <PreviewStep {...props} />
    case 'publish':
      return <PublishStep {...props} />
    default:
      return null
  }
}

function TitleEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      aria-label="Project title"
      value={draft}
      placeholder="Untitled video"
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(e.target.value)
      }}
      className="display -mx-1.5 min-w-0 rounded-md bg-transparent px-1.5 text-[28px] placeholder:text-ink-3 hover:bg-ink/[0.04] focus:bg-panel focus:shadow-[0_0_0_1px_var(--color-line-strong)] focus:outline-none"
      style={{ width: `${Math.min(Math.max(draft.length, 12), 42) + 1}ch` }}
    />
  )
}

/** Toasts (and a browser notification when the tab is hidden) when a job finishes or needs you. */
function useJobNotifications(data: ProjectFull) {
  const previous = useRef<Record<string, string>>({})
  const jobs = useMemo(
    () => [data.jobs.retime, data.jobs.publish, data.jobs.voice].filter(Boolean),
    [data.jobs],
  )
  useEffect(() => {
    for (const job of jobs) {
      if (!job) continue
      const before = previous.current[job.id]
      previous.current[job.id] = job.status
      if (!before || before === job.status) continue
      const title = data.project.title || 'Untitled video'
      let message: string | null = null
      if (job.type === 'retime' && job.status === 'done') message = 'Scenes now match the voice-over'
      if (job.type === 'retime' && job.status === 'failed') message = `Timing failed: ${job.error}`
      if (job.type === 'voice' && job.status === 'done') message = 'AI voice-over recorded and matched'
      if (job.type === 'voice' && job.status === 'failed' && job.error !== 'Stopped by you.')
        message = `Voice-over failed: ${job.error}`
      if (job.type === 'publish' && job.status === 'waiting') message = 'Ready for your approval'
      if (job.type === 'publish' && job.status === 'failed') message = `Stopped: ${job.error}`
      if (job.type === 'publish' && job.status === 'done') {
        message =
          data.project.status === 'scheduled'
            ? 'Uploaded and scheduled'
            : data.project.youtubeVideoId
              ? 'Posted to YouTube'
              : 'Video rendered'
      }
      if (!message) continue
      if (job.status === 'failed') toast.error(message)
      else toast.success(message, { description: title })
      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification(`Cutroom: ${message}`, { body: title, icon: '/icon.svg' })
      }
    }
  }, [jobs, data.project.title, data.project.status, data.project.youtubeVideoId])
}
