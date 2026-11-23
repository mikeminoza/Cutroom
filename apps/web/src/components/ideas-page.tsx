'use client'

import type { IdeaDraft } from '@cutroom/shared/ai'
import type { VideoFormat } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Lightbulb, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { DraftBatchDTO, IdeaDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import {
  keys,
  useDraftBatch,
  useIdeas,
  useProjects,
  useSeriesList,
  useSettings,
  useStatus,
} from '@/lib/hooks'
import { streamAnswer } from '@/lib/stream'
import { DRAFT_PART } from '@/lib/tasks'
import { Breakouts } from './breakouts'
import { Hits } from './hits'
import {
  Button,
  ButtonLink,
  Field,
  Input,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  Spinner,
  Textarea,
} from './ui'

type Tab = 'new' | 'used' | 'dismissed' | 'breakouts' | 'hits'

export function IdeasPage() {
  const { data: ideas, isLoading, error } = useIdeas()
  const seriesList = useSeriesList()
  const { data: status } = useStatus()
  const client = useQueryClient()
  const [tab, setTab] = useState<Tab>('new')
  // Grow the channel links to /ideas#breakouts, and the message about a new hit to /ideas#hits.
  useEffect(() => {
    if (window.location.hash === '#breakouts') setTab('breakouts')
    if (window.location.hash === '#hits') setTab('hits')
  }, [])
  // Breakouts and Your hits are lists of videos, not of ideas.
  const videos = tab === 'breakouts' || tab === 'hits'
  // For the video an idea follows up.
  const { data: projects } = useProjects()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [niche, setNiche] = useState('')
  const [ownTitle, setOwnTitle] = useState('')
  const [ownAngle, setOwnAngle] = useState('')
  const [adding, setAdding] = useState(false)
  // Left empty, ideas follow the channel niche from Settings.
  const channelNiche = useSettings().data?.niche.description.trim() ?? ''
  const [seriesId, setSeriesId] = useState('')
  const [format, setFormat] = useState<VideoFormat>('landscape')
  const [count, setCount] = useState('8')
  const [direction, setDirection] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  /** The ideas Gemini has written so far, shown while it writes the rest. */
  const [arriving, setArriving] = useState<IdeaDraft[]>([])
  // Each draft fully written by AI: script, scenes with image prompts, post details.
  const [writeDrafts, setWriteDrafts] = useState(true)
  const [creating, setCreating] = useState(false)
  // The drafts Gemini is writing on the server, also after the page was closed and opened again.
  const { data: batch } = useDraftBatch()
  const writingBusy = writeDrafts && Boolean(batch?.running)
  const series = seriesList.data?.find((s) => s.id === seriesId) ?? null
  const draftFormat = series?.template.format ?? format

  const list = (ideas ?? []).filter((i) => i.status === tab)
  const counts = {
    new: ideas?.filter((i) => i.status === 'new').length ?? 0,
    used: ideas?.filter((i) => i.status === 'used').length ?? 0,
    dismissed: ideas?.filter((i) => i.status === 'dismissed').length ?? 0,
  }
  const picked = list.filter((i) => selected.has(i.id))

  const suggest = async () => {
    setSuggesting(true)
    setArriving([])
    try {
      const next = await streamAnswer<IdeaDTO[], { ideas: IdeaDraft[] }>(
        '/api/ideas',
        { niche, seriesId: seriesId || null, format: draftFormat, count: Number(count), direction },
        { partial: ({ ideas }) => setArriving(ideas), restart: () => setArriving([]) },
      )
      client.setQueryData(keys.ideas, next)
      setTab('new')
      toast.success('New ideas added')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setArriving([])
      setSuggesting(false)
    }
  }

  const update = async (idea: IdeaDTO, patch: Partial<Pick<IdeaDTO, 'status'>>) => {
    client.setQueryData<IdeaDTO[]>(keys.ideas, (prev) =>
      prev?.map((i) => (i.id === idea.id ? { ...i, ...patch } : i)),
    )
    setSelected((s) => {
      const next = new Set(s)
      next.delete(idea.id)
      return next
    })
    try {
      await api.patch(`/api/ideas/${idea.id}`, patch)
    } catch (err) {
      toast.error(errorText(err))
      void client.invalidateQueries({ queryKey: keys.ideas })
    }
  }

  const remove = async (idea: IdeaDTO) => {
    client.setQueryData<IdeaDTO[]>(keys.ideas, (prev) => prev?.filter((i) => i.id !== idea.id))
    try {
      await api.del(`/api/ideas/${idea.id}`)
    } catch (err) {
      toast.error(errorText(err))
      void client.invalidateQueries({ queryKey: keys.ideas })
    }
  }

  /**
   * Drafts for the picked ideas. With "write them", Gemini then writes each one on the server, one
   * at a time, as before: the script in the channel's narrator voice, its scenes with image
   * prompts, then the title, description and tags. It keeps going when this page is closed; the
   * panel above the list shows how far it got. You then only record the voice-over and add the
   * pictures.
   */
  const createDrafts = async () => {
    setCreating(true)
    try {
      const { created, batch: started } = await api.post<{
        created: { ideaId: string; projectId: string }[]
        batch: DraftBatchDTO | null
      }>('/api/ideas/drafts', { ids: picked.map((i) => i.id), format: draftFormat, write: writeDrafts })
      setSelected(new Set())
      if (started) client.setQueryData(keys.draftBatch, started)
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.ideas }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      toast.success(`${plural(created.length, 'draft')} created`, {
        description: started
          ? 'Gemini is writing them now. You can close this window: it keeps going.'
          : 'Find them on the Projects page.',
      })
      setTab('used')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setCreating(false)
    }
  }

  /** An idea of your own, added to the backlog like Gemini's (in the series picked above, if any). */
  const addOwn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ownTitle.trim()) return
    setAdding(true)
    try {
      const idea = await api.post<IdeaDTO>('/api/ideas/own', {
        title: ownTitle,
        angle: ownAngle,
        seriesId: seriesId || null,
      })
      client.setQueryData<IdeaDTO[]>(keys.ideas, (prev) => [idea, ...(prev ?? [])])
      setOwnTitle('')
      setOwnAngle('')
      setTab('new')
      toast.success('Idea added')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setAdding(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const canSuggest = status?.gemini.configured !== false

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8">
        <h1 className="display text-[34px]">Ideas</h1>
        <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
          A backlog of video ideas. Gemini suggests them from your niche or series, avoiding what you have
          already made. Breakouts finds videos taking off in your niche, and Your hits the ones taking off on
          your own channel. Pick the good ones and turn them into drafts.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-6 lg:sticky lg:top-4">
          <Panel title="Suggest ideas">
            <div className="flex flex-col gap-4 px-5 py-5">
              {(seriesList.data?.length ?? 0) > 0 && (
                <Field label="For a series" aside="Optional">
                  <Select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                    <option value="">No series</option>
                    {seriesList.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label={series ? 'Extra focus' : 'Channel niche'}
                aside={series || channelNiche ? 'Optional' : undefined}
                hint={
                  !series && channelNiche ? 'Leave empty to use your channel niche from Settings.' : undefined
                }
              >
                <Input
                  value={niche}
                  maxLength={500}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder={
                    series
                      ? 'Deep-sea creatures only'
                      : channelNiche || 'Strange animal facts for curious adults'
                  }
                />
              </Field>
              {!series && (
                <Field label="Format">
                  <Segmented
                    ariaLabel="Format"
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'landscape', label: 'Videos' },
                      { value: 'portrait', label: 'Shorts' },
                    ]}
                    className="w-full"
                  />
                </Field>
              )}
              <Field label="How many">
                <Segmented
                  ariaLabel="How many ideas"
                  value={count}
                  onChange={setCount}
                  options={['5', '8', '12', '20'].map((v) => ({ value: v, label: v }))}
                  className="w-full"
                />
              </Field>
              <Field label="Direction" aside="Optional">
                <Input
                  value={direction}
                  maxLength={1000}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Myth-busting angles, Halloween themes…"
                />
              </Field>
              <Button
                variant="go"
                busy={suggesting}
                disabled={!canSuggest || (!niche.trim() && !series && !channelNiche)}
                onClick={suggest}
                icon={<Sparkles className="size-4" />}
              >
                Suggest ideas
              </Button>
              {!canSuggest && (
                <p className="text-[13px] text-ink-2">Add GEMINI_API_KEY to get suggestions.</p>
              )}
            </div>
          </Panel>
          <Panel
            title="Add your own"
            description="Your idea goes in the list with Gemini's, ready to turn into a draft."
          >
            <form onSubmit={addOwn} className="flex flex-col gap-4 px-5 py-5">
              <Field label="Title" htmlFor="own-idea-title">
                <Input
                  id="own-idea-title"
                  value={ownTitle}
                  maxLength={200}
                  onChange={(e) => setOwnTitle(e.target.value)}
                  placeholder="Capybara tries to catch a butterfly"
                />
              </Field>
              <Field label="What happens" htmlFor="own-idea-angle" aside="Optional">
                <Textarea
                  id="own-idea-angle"
                  value={ownAngle}
                  maxLength={1000}
                  onChange={(e) => setOwnAngle(e.target.value)}
                  placeholder="Cappy chases it all over the garden and ends up asleep in a flower pot."
                  className="min-h-20"
                />
              </Field>
              <Button
                type="submit"
                variant="plain"
                busy={adding}
                disabled={!ownTitle.trim()}
                icon={<Plus className="size-4" />}
              >
                Add idea
              </Button>
            </form>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Segmented<Tab>
            ariaLabel="Show ideas"
            value={tab}
            onChange={(next) => {
              setTab(next)
              setSelected(new Set())
            }}
            options={[
              { value: 'new', label: `New (${counts.new})` },
              { value: 'used', label: `Made (${counts.used})` },
              { value: 'dismissed', label: `Dismissed (${counts.dismissed})` },
              { value: 'breakouts', label: 'Breakouts' },
              { value: 'hits', label: 'Your hits' },
            ]}
            className="max-w-full self-start overflow-x-auto"
          />

          {batch && <DraftBatchPanel key={batch.id} batch={batch} />}

          {tab === 'breakouts' && <Breakouts />}
          {tab === 'hits' && <Hits />}

          {tab === 'new' && picked.length > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[var(--radius-panel)] border border-ink bg-ink px-4 py-3 text-paper">
              <span className="text-[14px]">{plural(picked.length, 'idea')} picked</span>
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={writeDrafts}
                  onChange={(e) => setWriteDrafts(e.target.checked)}
                  className="size-4 accent-kodak"
                />
                Write each one with AI: script, scenes and post details
              </label>
              <Button
                variant="go"
                className="ml-auto"
                busy={creating}
                disabled={writingBusy}
                title={writingBusy ? 'Gemini is still writing your last drafts.' : undefined}
                onClick={createDrafts}
                icon={<ArrowRight className="size-4" />}
              >
                Create {plural(picked.length, 'draft')}
              </Button>
              {writingBusy && (
                <p className="w-full text-[12.5px] text-paper/70">
                  Gemini is still writing your last drafts. Wait for them, or untick writing to just create
                  these.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-[14px] text-bad">Could not load ideas: {errorText(error)}</p>}
          {isLoading && !videos && (
            <div className="h-48 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />
          )}
          {tab === 'new' && suggesting && (
            <div
              aria-live="polite"
              className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel"
            >
              <p className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13.5px] text-ink-2">
                <Spinner className="text-ink-3" />
                {arriving.length
                  ? `${arriving.length} of ${count} ideas written…`
                  : `Gemini is thinking up ${count} ideas. Each one shows here as soon as it’s written.`}
              </p>
              {arriving.map((idea, i) => (
                <div key={i} className="border-b border-line px-4 py-3.5 last:border-b-0">
                  <p className="text-[15px] font-semibold">{idea.title}</p>
                  {idea.angle && <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{idea.angle}</p>}
                </div>
              ))}
              {/* Room for the ones still coming. */}
              {Array.from({
                length: arriving.length
                  ? Math.min(Number(count) - arriving.length, 1)
                  : Math.min(Number(count), 4),
              }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0">
                  <div className="h-4 w-2/3 animate-pulse-soft rounded bg-line" />
                  <div className="h-3 w-full animate-pulse-soft rounded bg-line/60" />
                  <div className="h-3 w-4/5 animate-pulse-soft rounded bg-line/60" />
                </div>
              ))}
            </div>
          )}
          {ideas && !videos && list.length === 0 && !(tab === 'new' && suggesting) && (
            <div className="flex flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-12 text-center">
              <Lightbulb className="size-6 text-ink-3" aria-hidden />
              <p className="max-w-[46ch] text-[14px] text-ink-2">
                {tab === 'new'
                  ? 'No ideas waiting. Describe your niche and let Gemini suggest some.'
                  : tab === 'used'
                    ? 'Ideas you turn into drafts are listed here, with a link to their project.'
                    : 'Ideas you dismiss are kept here, in case you change your mind.'}
              </p>
            </div>
          )}
          {list.length > 0 && (
            <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
              {list.map((idea) => {
                const seriesName = seriesList.data?.find((s) => s.id === idea.seriesId)?.name
                const hit = idea.followUpOf ? projects?.find((p) => p.id === idea.followUpOf) : undefined
                const on = selected.has(idea.id)
                return (
                  <li
                    key={idea.id}
                    className={cn(
                      'grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-line px-4 py-3.5 last:border-b-0',
                      on && 'bg-kodak-wash/60',
                    )}
                  >
                    {tab === 'new' ? (
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={creating}
                        onChange={() => toggle(idea.id)}
                        aria-label={`Pick “${idea.title}”`}
                        className="mt-1 size-4 accent-ink"
                      />
                    ) : (
                      <span className="w-4" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{idea.title}</p>
                      {idea.angle && (
                        <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{idea.angle}</p>
                      )}
                      {seriesName && <p className="mt-1 text-[12px] text-ink-3">Series: {seriesName}</p>}
                      {hit && (
                        <p className="mt-1 text-[12px] text-ink-3">
                          Follows up your hit “{hit.title || 'Untitled video'}”
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {tab === 'used' && idea.projectId && (
                        <ButtonLink
                          href={`/projects/${idea.projectId}`}
                          size="sm"
                          icon={<ArrowRight className="size-3.5" aria-hidden />}
                        >
                          Open
                        </ButtonLink>
                      )}
                      {tab === 'new' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Dismiss"
                          title="Dismiss"
                          onClick={() => update(idea, { status: 'dismissed' })}
                          icon={<X className="size-3.5" />}
                        />
                      )}
                      {tab === 'dismissed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update(idea, { status: 'new' })}
                          icon={<RotateCcw className="size-3.5" />}
                        >
                          Restore
                        </Button>
                      )}
                      {tab !== 'used' && (
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label="Delete"
                          title="Delete"
                          onClick={() => remove(idea)}
                          icon={<Trash2 className="size-3.5" />}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** What a finished batch of drafts came to, as the toast said before. */
function batchSummary(batch: DraftBatchDTO) {
  return {
    title: `${plural(batch.drafts.length, 'draft')} created`,
    description: `${plural(batch.full, 'draft')} fully written${batch.partial ? `, ${batch.partial} partly` : ''}. Record the voice-over and add the pictures on the Projects page.`,
  }
}

const SEEN_KEY = 'cutroom-drafts-seen'

/**
 * The drafts Gemini writes on the server (Create drafts → write them): how far it got while it
 * runs, then what it came to, until you close it. Shown from the server, so it is the same after
 * closing the window and coming back.
 */
function DraftBatchPanel({ batch }: { batch: DraftBatchDTO }) {
  const client = useQueryClient()
  const [stopping, setStopping] = useState(false)
  // The finished batch you closed, remembered in this browser.
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY))
    } catch {
      // Storage blocked: it shows until the page reloads.
    }
  }, [])
  const close = () => {
    setSeen(batch.id)
    try {
      localStorage.setItem(SEEN_KEY, batch.id)
    } catch {
      // Storage blocked: closed until the page reloads.
    }
  }

  // Finished while you watch: told at once, as before, and the drafts are refreshed.
  const wasRunning = useRef(batch.running)
  useEffect(() => {
    if (wasRunning.current && !batch.running) {
      const { title, description } = batchSummary(batch)
      if (batch.full === batch.drafts.length) toast.success(title, { description })
      else toast(title, { description })
      void client.invalidateQueries({ queryKey: keys.projects })
    }
    wasRunning.current = batch.running
  }, [batch, client])

  const stop = async () => {
    setStopping(true)
    try {
      const { batch: next } = await api.post<{ batch: DraftBatchDTO | null }>('/api/ideas/drafts/stop')
      client.setQueryData(keys.draftBatch, next)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setStopping(false)
    }
  }

  if (batch.running) {
    const part = batch.current ? DRAFT_PART[batch.current.kind] : null
    return (
      <div
        aria-live="polite"
        className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-ink bg-ink px-4 py-3 text-paper"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[14px]">
            {batch.current
              ? `Writing draft ${batch.current.draft} of ${batch.drafts.length}${part ? `: ${part}` : ''}…`
              : 'Writing your drafts…'}
          </span>
          <ProgressBar value={batch.done / batch.total} tone="you" className="min-w-32 max-w-64 flex-1" />
          <Button
            variant="ghost"
            size="sm"
            busy={stopping}
            onClick={stop}
            className="ml-auto text-paper/80 hover:bg-paper/10 hover:text-paper"
            icon={<Square className="size-3.5" />}
          >
            Stop
          </Button>
        </div>
        <p className="text-[12.5px] text-paper/70">
          You can close this window: Gemini keeps writing them on the server, and this shows how far it got
          when you come back.
        </p>
      </div>
    )
  }

  // Finished: shown until you close it, for a week at most.
  const recent = Date.now() - new Date(batch.finishedAt ?? batch.createdAt).getTime() < 7 * 86_400_000
  if (seen === batch.id || !recent) return null
  const { title, description } = batchSummary(batch)
  const unfinished = batch.drafts.filter((d) => d.state !== 'full')
  return (
    <Panel
      title={title}
      description={description}
      actions={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close"
          title="Close"
          onClick={close}
          icon={<X className="size-3.5" />}
        />
      }
    >
      {(batch.stopped || unfinished.length > 0) && (
        <div className="flex flex-col gap-2 px-5 py-4">
          {batch.stopped && <p className="text-[13.5px] text-ink-2">Stopped: {batch.stopped}</p>}
          {unfinished.length > 0 && (
            <p className="text-[13px] text-ink-3">
              Finish these from their project page: each step has its own button there.
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {unfinished.map((d) => (
              <li key={d.projectId} className="flex items-start gap-3 text-[13.5px]">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{d.title || 'Untitled video'}</span>
                  <span className="text-ink-2">
                    {' '}
                    · {d.state === 'partial' ? 'partly written' : 'not written'}
                    {d.note && d.note !== batch.stopped ? `: ${d.note}` : ''}
                  </span>
                </div>
                <ButtonLink
                  href={`/projects/${d.projectId}`}
                  size="sm"
                  icon={<ArrowRight className="size-3.5" aria-hidden />}
                >
                  Open
                </ButtonLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}
