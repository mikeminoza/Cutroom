'use client'

import { buildThumbnailPrompt } from '@cutroom/shared/prompts'
import { formatChapterTime } from '@cutroom/shared/timing'
import { type PostDetails, type PostingMode, YOUTUBE_CATEGORIES } from '@cutroom/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Check,
  Clapperboard,
  Download,
  ExternalLink,
  FolderOpen,
  ImagePlus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  CopyButton,
  DropZone,
  Field,
  Input,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  Switch,
  useConfirm,
} from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { JobDTO, ProjectFull } from '@/lib/dto'
import { formatWhen } from '@/lib/format'
import { keys, useProjectAction, useSaver, useSettings, useStatus } from '@/lib/hooks'
import type { StepId, Tone } from '@/lib/stage'
import { SyncedInput, SyncedTextarea, useUploader } from './fields'
import { JobSteps, Warnings } from './job-panel'
import { type StepProps, stageOf } from './workspace'

export function PublishStep({ data, goTo }: StepProps) {
  const job = data.jobs.publish
  const showJob = job && !(job.status === 'failed' && job.error === 'Stopped by you.')
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-5">
        <PostDetailsPanel data={data} />
        <ThumbnailPanel data={data} />
      </div>
      <div className="flex flex-col gap-5 xl:sticky xl:top-4">
        {showJob ? <JobPanel data={data} job={job} /> : <FinishPanel data={data} goTo={goTo} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- post details

function usePost(data: ProjectFull) {
  const client = useQueryClient()
  const { saver } = useSaver(data.project.id)
  return (patch: Partial<PostDetails>, delay?: number) => {
    const latest =
      client.getQueryData<ProjectFull>(keys.project(data.project.id))?.project.post ?? data.project.post
    return saver.project({ post: { ...latest, ...patch } }, delay)
  }
}

function PostDetailsPanel({ data }: { data: ProjectFull }) {
  const { project } = data
  const post = project.post
  const setPost = usePost(data)
  const client = useQueryClient()
  const { data: status } = useStatus()
  const [writing, setWriting] = useState(false)
  const playlists = useQuery({
    queryKey: ['playlists'],
    queryFn: () => api.get<{ playlists: { id: string; title: string }[] }>('/api/google/youtube'),
    enabled: Boolean(status?.youtube.connected),
    staleTime: 5 * 60_000,
  })
  const tagChars = post.tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0) + 1, 0)

  const write = async () => {
    setWriting(true)
    try {
      const next = await api.post<PostDetails>(`/api/projects/${project.id}/ai/post`)
      client.setQueryData<ProjectFull>(keys.project(project.id), (prev) =>
        prev ? { ...prev, project: { ...prev.project, post: next } } : prev,
      )
      toast.success('Post details written')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setWriting(false)
    }
  }

  return (
    <Panel
      title="Post details"
      description="What YouTube shows. Leave it empty and Gemini writes it during Finish & schedule."
      actions={
        <Button
          variant="plain"
          size="sm"
          busy={writing}
          onClick={write}
          icon={<Sparkles className="size-3.5" />}
        >
          {post.description ? 'Write again' : 'Write with AI'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 px-5 py-5">
        {post.titleOptions.length > 0 && (
          <Field label="Title ideas" hint="Pick one, then edit it below.">
            <div role="radiogroup" aria-label="Title ideas" className="flex flex-col gap-1.5">
              {post.titleOptions.map((option) => {
                const active = option === post.title
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPost({ title: option }, 0)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 text-left text-[14px] transition-colors',
                      active ? 'border-ink bg-kodak-wash' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded-full border',
                        active ? 'border-ink bg-ink' : 'border-line-strong',
                      )}
                    >
                      {active && <span className="size-1.5 rounded-full bg-kodak" />}
                    </span>
                    {option}
                  </button>
                )
              })}
            </div>
          </Field>
        )}
        <Field
          label="Title"
          aside={`${post.title.length} / 100`}
          error={post.title.length > 100 ? 'YouTube allows 100 characters.' : null}
        >
          <SyncedInput
            value={post.title}
            onValue={(title) => setPost({ title })}
            placeholder={project.title || 'Video title'}
          />
        </Field>
        <Field
          label="Description"
          aside={`${post.description.length.toLocaleString()} / 5,000`}
          hint={
            post.chapters.length
              ? `Includes ${post.chapters.length} chapters from your scene timestamps.`
              : undefined
          }
        >
          <SyncedTextarea
            value={post.description}
            onValue={(description) => setPost({ description })}
            className="min-h-56 text-[14px]"
          />
        </Field>
        {post.chapters.length > 0 && (
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
            {post.chapters.map((c) => (
              <li key={c.start}>
                <span className="tc text-ink">{formatChapterTime(c.start)}</span> {c.title}
              </li>
            ))}
          </ol>
        )}
        <Field
          label="Tags"
          aside={`${tagChars} / 500`}
          hint="Press Enter or comma to add. Most specific first."
        >
          <TagInput tags={post.tags} onChange={(tags) => setPost({ tags }, 0)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Category">
            <Select value={post.categoryId} onChange={(e) => setPost({ categoryId: e.target.value }, 0)}>
              {YOUTUBE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Playlist"
            hint={status?.youtube.connected ? undefined : 'Connect YouTube to pick a playlist.'}
          >
            <Select
              value={post.playlistId}
              disabled={!status?.youtube.connected}
              onChange={(e) => setPost({ playlistId: e.target.value }, 0)}
            >
              <option value="">None</option>
              {playlists.data?.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Visibility"
            className="sm:col-span-2"
            hint="Scheduled videos stay private until their time, then become public."
          >
            <Segmented
              ariaLabel="Visibility"
              value={post.privacy}
              onChange={(privacy) => setPost({ privacy }, 0)}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'unlisted', label: 'Unlisted' },
                { value: 'private', label: 'Private' },
              ]}
            />
          </Field>
        </div>
        <Switch
          checked={post.madeForKids}
          onCheckedChange={(madeForKids) => setPost({ madeForKids }, 0)}
          label="Made for kids"
          description="Required by YouTube. Turns off comments and personalised ads for this video."
        />
      </div>
    </Panel>
  )
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const next = raw
      .split(',')
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean)
      .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
    if (next.length) onChange([...tags, ...next])
    setDraft('')
  }
  return (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-panel px-2 py-1.5 focus-within:border-ink focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-kodak)_40%,transparent)]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-sunk py-0.5 pr-1 pl-2.5 text-[13px]"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="rounded-full p-0.5 text-ink-3 hover:bg-line hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          if (e.target.value.includes(',')) add(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
          if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
        }}
        onBlur={() => draft && add(draft)}
        aria-label="Add a tag"
        placeholder={tags.length ? '' : 'octopus, animal intelligence, ocean facts'}
        className="min-w-32 flex-1 bg-transparent px-1 text-[14px] placeholder:text-ink-3 focus:outline-none"
      />
    </div>
  )
}

// ---------------------------------------------------------------- thumbnail

function ThumbnailPanel({ data }: { data: ProjectFull }) {
  const { project, characters } = data
  const { saver } = useSaver(project.id)
  const upload = useUploader(project.id)
  const [progress, setProgress] = useState<number | null>(null)
  const ideas = project.post.thumbnailIdeas

  const onFiles = async ([file]: File[]) => {
    try {
      setProgress(0)
      const stored = await upload(file, 'thumbnail', setProgress)
      await saver.project({ thumbnailUrl: stored.url }, 0)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setProgress(null)
    }
  }

  return (
    <Panel
      title="Thumbnail"
      description="1280×720 works best. Custom thumbnails need a phone-verified YouTube channel."
    >
      <div className="grid gap-5 px-5 py-5 md:grid-cols-[320px_1fr]">
        <DropZone accept="image/*" onFiles={onFiles}>
          {({ open, dragging }) =>
            project.thumbnailUrl && progress === null ? (
              <div className="group relative aspect-video overflow-hidden rounded-[var(--radius-control)] bg-film">
                {/* biome-ignore lint/performance/noImgElement: user uploads */}
                <img src={project.thumbnailUrl} alt="Thumbnail" className="size-full object-cover" />
                <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button variant="plain" size="sm" onClick={open}>
                    Replace
                  </Button>
                  <Button variant="plain" size="sm" onClick={() => saver.project({ thumbnailUrl: null }, 0)}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={open}
                className={cn(
                  'flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-[13px] transition-colors',
                  dragging
                    ? 'bg-kodak-wash shadow-[0_0_0_2px_var(--color-ink)]'
                    : 'hatch bg-sunk text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-ink',
                )}
              >
                {progress !== null ? (
                  <ProgressBar value={progress} tone="you" className="w-2/3" />
                ) : (
                  <>
                    <ImagePlus className="size-5" aria-hidden />
                    Drop or choose a thumbnail
                  </>
                )}
              </button>
            )
          }
        </DropZone>
        <div className="flex flex-col gap-3">
          {ideas.length === 0 ? (
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Use Write with AI above to get three thumbnail ideas with ready-to-copy prompts. Without a
              thumbnail, YouTube picks a frame from the video.
            </p>
          ) : (
            ideas.map((idea, i) => {
              const prompt =
                i === 0 && project.post.thumbnailPrompt
                  ? project.post.thumbnailPrompt
                  : buildThumbnailPrompt(idea, { artStyle: project.artStyle, characters })
              return (
                <div
                  key={idea}
                  className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5"
                >
                  <p className="flex-1 text-[13.5px] leading-snug">{idea}</p>
                  <CopyButton text={prompt} label="Copy prompt" />
                </div>
              )
            })
          )}
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- finish

interface ScheduleData {
  timezone: string
  entries: { at: string; project: { id: string } | null }[]
}

function FinishPanel({ data, goTo }: { data: ProjectFull; goTo: (step: StepId) => void }) {
  const { project, scenes } = data
  const action = useProjectAction(project.id)
  const { data: status } = useStatus()
  const { data: settings } = useSettings()
  const { confirm, element } = useConfirm()
  const schedule = useQuery({
    queryKey: keys.schedule,
    queryFn: () => api.get<ScheduleData>('/api/schedule'),
  })
  const [when, setWhen] = useState<'slot' | 'now' | 'custom'>('slot')
  const [custom, setCustom] = useState('')
  const [mode, setMode] = useState<PostingMode>(project.mode)
  const [busy, setBusy] = useState(false)
  const stage = stageOf(data)
  const missing = scenes.length - stage.imagesDone
  const nextSlot = schedule.data?.entries.find((e) => !e.project || e.project.id === project.id)
  const tz = schedule.data?.timezone ?? settings?.timezone

  const checks: { label: string; tone: Tone; detail: string; step?: StepId; href?: string }[] = [
    {
      label: 'Scenes',
      tone: scenes.length ? 'ok' : 'you',
      detail: scenes.length ? `${scenes.length} scenes` : 'Split the script into scenes',
      step: 'script',
    },
    {
      label: 'Voice-over',
      tone: stage.timed ? 'ok' : project.voiceoverUrl ? 'you' : 'you',
      detail: stage.timed
        ? 'Scenes match the speech'
        : project.voiceoverUrl
          ? 'Match the scenes to it'
          : 'Upload the voice-over',
      step: 'voiceover',
    },
    {
      label: 'Images',
      tone: missing === 0 && scenes.length ? 'ok' : 'you',
      detail:
        missing === 0 ? 'Every scene has one' : `${missing} missing — the previous image stays on screen`,
      step: 'images',
    },
    {
      label: 'YouTube',
      tone: status?.youtube.connected ? 'ok' : 'idle',
      detail: status?.youtube.connected
        ? `Posting to ${status.youtube.label}`
        : 'Not connected — the video is rendered but not posted',
      href: '/settings',
    },
    {
      label: 'Google Drive',
      tone: status?.drive.connected ? 'ok' : 'idle',
      detail: status?.drive.connected
        ? 'The video and files are saved there'
        : 'Not connected — the video stays in app storage',
      href: '/settings',
    },
    {
      label: 'Worker',
      tone: status?.worker.configured ? (status.worker.reachable ? 'ok' : 'idle') : 'bad',
      detail: !status?.worker.configured
        ? 'Not set up — add WORKER_URL and WORKER_SECRET'
        : status.worker.reachable
          ? 'Online'
          : 'Asleep — it wakes up when you start (about a minute)',
      href: '/settings',
    },
  ]

  const blocked = !scenes.length || !status?.worker.configured
  const finish = async () => {
    if (!stage.timed && project.voiceoverUrl) {
      const ok = await confirm({
        title: 'Scenes are not matched to the voice-over',
        body: 'Scenes will use their estimated timing, so pictures may change at the wrong moments. Match them on the Voice-over step first for the best result.',
        action: 'Finish anyway',
      })
      if (!ok) return
    }
    if (missing > 0) {
      const ok = await confirm({
        title: `${missing} ${missing === 1 ? 'scene has' : 'scenes have'} no image`,
        body: 'The previous scene’s image stays on screen during those scenes.',
        action: 'Finish anyway',
      })
      if (!ok) return
    }
    if (when === 'custom' && !custom) {
      toast.error('Pick a date and time.')
      return
    }
    if ('Notification' in window && Notification.permission === 'default')
      void Notification.requestPermission()
    setBusy(true)
    await action(
      `/api/projects/${project.id}/publish`,
      { when, at: when === 'custom' ? new Date(custom).toISOString() : undefined, mode },
      'Started — the worker is on it',
    )
    setBusy(false)
  }

  return (
    <Panel title="Finish & schedule">
      <div className="flex flex-col gap-5 px-5 py-5">
        <ul className="flex flex-col gap-2.5">
          {checks.map((check) => (
            <li
              key={check.label}
              className="grid grid-cols-[18px_1fr_auto] items-start gap-2.5 text-[13.5px]"
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-[18px] place-items-center rounded-full',
                  check.tone === 'ok' && 'bg-ok text-panel',
                  check.tone === 'you' && 'bg-kodak text-ink',
                  check.tone === 'idle' && 'border border-line-strong',
                  check.tone === 'bad' && 'bg-bad text-panel',
                )}
              >
                {check.tone === 'ok' && <Check className="size-3" strokeWidth={3} />}
                {check.tone === 'bad' && <X className="size-3" strokeWidth={3} />}
              </span>
              <span>
                <span className="font-medium">{check.label}</span>
                <span className="block text-[12.5px] leading-snug text-ink-2">{check.detail}</span>
              </span>
              {check.tone !== 'ok' &&
                (check.step ? (
                  <button
                    type="button"
                    onClick={() => goTo(check.step!)}
                    className="text-[12.5px] font-medium underline underline-offset-4"
                  >
                    Fix
                  </button>
                ) : (
                  <a href={check.href} className="text-[12.5px] font-medium underline underline-offset-4">
                    Set up
                  </a>
                ))}
            </li>
          ))}
        </ul>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium">When should it go live?</legend>
          {(
            [
              {
                value: 'slot',
                label: 'Next free slot',
                detail: nextSlot ? formatWhen(nextSlot.at, tz) : 'Add posting slots in Settings',
              },
              {
                value: 'now',
                label: 'As soon as it is uploaded',
                detail: `Posted as ${project.post.privacy}`,
              },
              { value: 'custom', label: 'Pick a time', detail: 'Any time at least 15 minutes from now' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors',
                when === option.value ? 'border-ink bg-kodak-wash' : 'border-line hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name="when"
                value={option.value}
                checked={when === option.value}
                onChange={() => setWhen(option.value)}
                className="mt-1 accent-ink"
              />
              <span className="flex-1">
                <span className="block text-[14px] font-medium">{option.label}</span>
                <span className="tc block text-[12.5px] text-ink-2">{option.detail}</span>
                {option.value === 'custom' && when === 'custom' && (
                  <Input
                    type="datetime-local"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="mt-2"
                    aria-label="Publish date and time"
                  />
                )}
              </span>
            </label>
          ))}
        </fieldset>

        <Field
          label="Before uploading"
          hint={
            mode === 'review'
              ? 'The worker renders and writes the details, then waits for you to approve.'
              : 'Everything runs without stopping, straight through to YouTube.'
          }
        >
          <Segmented
            ariaLabel="Posting mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'review', label: 'Let me approve' },
              { value: 'autopilot', label: 'Auto-pilot' },
            ]}
            className="w-full"
          />
        </Field>

        <Button
          variant="go"
          size="lg"
          busy={busy}
          disabled={blocked}
          onClick={finish}
          icon={<Clapperboard className="size-4" />}
        >
          {when === 'now' ? 'Finish & post' : 'Finish & schedule'}
        </Button>
        <p className="text-[12.5px] leading-snug text-ink-3">
          Keep a Cutroom tab open until the upload finishes. On Render&apos;s free plan the worker sleeps when
          nothing is checking on it.
        </p>
      </div>
      {element}
    </Panel>
  )
}

// ---------------------------------------------------------------- job

function JobPanel({ data, job }: { data: ProjectFull; job: JobDTO }) {
  const { project } = data
  const client = useQueryClient()
  const action = useProjectAction(project.id)
  const { saver } = useSaver(project.id)
  const { confirm, element } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const warnings = job.result.warnings ?? []

  const jobAction = async (name: 'approve' | 'retry' | 'cancel') => {
    setBusy(name)
    try {
      await saver.flushAll()
      await api.post(`/api/jobs/${job.id}/${name}`)
      await client.invalidateQueries({ queryKey: keys.project(project.id) })
      if (name === 'approve') toast.success('Approved — uploading to YouTube')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const startOver = async () => {
    const ok = await confirm({
      title: 'Start over?',
      body: project.youtubeVideoId
        ? 'The video already on YouTube stays there. Finishing again uploads a new copy.'
        : 'The current run is cleared so you can change things and finish again.',
      action: 'Start over',
    })
    if (ok) await action(`/api/projects/${project.id}/reset`)
  }

  const heading =
    job.status === 'done'
      ? project.youtubeVideoId
        ? project.status === 'scheduled'
          ? 'Scheduled'
          : 'Posted'
        : 'Rendered'
      : job.status === 'waiting'
        ? 'Ready for your approval'
        : job.status === 'failed'
          ? 'Stopped'
          : 'Working on it'

  return (
    <Panel title={heading}>
      <div className="flex flex-col gap-5 px-5 py-5">
        {job.status === 'done' && project.scheduledAt && project.status === 'scheduled' && (
          <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-ok-wash px-3 py-2.5 text-[14px] text-ok">
            <CalendarClock className="size-4" aria-hidden />
            Goes live <strong className="tc font-semibold">{formatWhen(project.scheduledAt)}</strong>
          </p>
        )}
        <JobSteps job={job} />
        <Warnings warnings={warnings} />
        {job.status === 'failed' && job.error && (
          <p className="rounded-[var(--radius-control)] bg-bad-wash px-3 py-2.5 text-[13.5px] text-bad">
            {job.error}
          </p>
        )}

        {job.status === 'waiting' && (
          <>
            <p className="text-[13.5px] leading-snug text-ink-2">
              Check the title, description and tags on the left. Your edits are what gets uploaded.
            </p>
            <Button
              variant="go"
              size="lg"
              busy={busy === 'approve'}
              onClick={() => jobAction('approve')}
              icon={<Send className="size-4" />}
            >
              Approve and upload
            </Button>
          </>
        )}
        {job.status === 'failed' && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="go"
              busy={busy === 'retry'}
              onClick={() => jobAction('retry')}
              icon={<RotateCcw className="size-4" />}
            >
              Retry from where it stopped
            </Button>
            <Button variant="ghost" onClick={startOver}>
              Start over
            </Button>
          </div>
        )}
        {['queued', 'running'].includes(job.status) && (
          <div className="flex flex-col gap-3">
            {job.status === 'queued' && (
              <p className="text-[13px] text-ink-2">
                Waiting for the worker. If it was asleep it needs about a minute to start.
              </p>
            )}
            <p className="text-[12.5px] leading-snug text-ink-3">
              Keep a Cutroom tab open until it finishes. The free worker sleeps when nothing checks on it.
            </p>
            <Button
              variant="ghost"
              size="sm"
              busy={busy === 'cancel'}
              onClick={() => jobAction('cancel')}
              icon={<Square className="size-3.5" />}
              className="self-start"
            >
              Stop
            </Button>
          </div>
        )}

        {job.status === 'done' && (
          <div className="flex flex-col gap-2">
            {project.youtubeVideoId && (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://youtu.be/${project.youtubeVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="contents"
                >
                  <Button variant="dark" icon={<ExternalLink className="size-4" />}>
                    Open on YouTube
                  </Button>
                </a>
                <a
                  href={`https://studio.youtube.com/video/${project.youtubeVideoId}/edit`}
                  target="_blank"
                  rel="noreferrer"
                  className="contents"
                >
                  <Button variant="plain" icon={<ExternalLink className="size-4" />}>
                    YouTube Studio
                  </Button>
                </a>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {project.driveFolderUrl && (
                <a href={project.driveFolderUrl} target="_blank" rel="noreferrer" className="contents">
                  <Button variant="plain" icon={<FolderOpen className="size-4" />}>
                    Drive folder
                  </Button>
                </a>
              )}
              {project.outputUrl && (
                <a href={project.outputUrl} download className="contents">
                  <Button variant="plain" icon={<Download className="size-4" />}>
                    Download MP4
                  </Button>
                </a>
              )}
              {project.srtUrl && (
                <a href={project.srtUrl} download className="contents">
                  <Button variant="ghost" icon={<Download className="size-4" />}>
                    Captions
                  </Button>
                </a>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={startOver}
              icon={<RotateCcw className="size-3.5" />}
              className="mt-2 self-start"
            >
              Post again
            </Button>
          </div>
        )}
      </div>
      {element}
    </Panel>
  )
}
