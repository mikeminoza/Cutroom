'use client'

import type { VideoFormat } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Lightbulb, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { IdeaDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useIdeas, useSeriesList, useSettings, useStatus } from '@/lib/hooks'
import { Button, ButtonLink, Field, Input, Panel, ProgressBar, Segmented, Select, Spinner } from './ui'

type Tab = 'new' | 'used' | 'dismissed'

export function IdeasPage() {
  const { data: ideas, isLoading, error } = useIdeas()
  const seriesList = useSeriesList()
  const { data: status } = useStatus()
  const client = useQueryClient()
  const [tab, setTab] = useState<Tab>('new')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [niche, setNiche] = useState('')
  // Left empty, ideas follow the channel niche from Settings.
  const channelNiche = useSettings().data?.niche.description.trim() ?? ''
  const [seriesId, setSeriesId] = useState('')
  const [format, setFormat] = useState<VideoFormat>('landscape')
  const [count, setCount] = useState('8')
  const [direction, setDirection] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [writeScripts, setWriteScripts] = useState(true)
  const [creating, setCreating] = useState<{ done: number; total: number; label: string } | null>(null)
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
    try {
      const next = await api.post<IdeaDTO[]>('/api/ideas', {
        niche,
        seriesId: seriesId || null,
        format: draftFormat,
        count: Number(count),
        direction,
      })
      client.setQueryData(keys.ideas, next)
      setTab('new')
      toast.success('New ideas added')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
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

  /** Drafts for the picked ideas, then (optionally) a script for each, one at a time. */
  const createDrafts = async () => {
    const ids = picked.map((i) => i.id)
    setCreating({ done: 0, total: ids.length, label: 'Creating drafts…' })
    try {
      const { created } = await api.post<{ created: { ideaId: string; projectId: string }[] }>(
        '/api/ideas/drafts',
        { ids, format: draftFormat },
      )
      setSelected(new Set())
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.ideas }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      let written = 0
      if (writeScripts) {
        for (const [i, { projectId }] of created.entries()) {
          setCreating({
            done: i,
            total: created.length,
            label: `Writing script ${i + 1} of ${created.length}…`,
          })
          try {
            await api.post(`/api/projects/${projectId}/ai/script`, { notes: '' })
            written++
          } catch (err) {
            toast.error(errorText(err), {
              description:
                err instanceof ApiError && err.status === 429
                  ? 'The remaining drafts have no script yet. Write them from each project later.'
                  : undefined,
            })
            if (err instanceof ApiError && [400, 402, 429].includes(err.status)) break
          }
        }
        await client.invalidateQueries({ queryKey: keys.projects })
      }
      toast.success(`${plural(created.length, 'draft')} created`, {
        description: writeScripts
          ? `${plural(written, 'script')} written. Find them on the Projects page.`
          : 'Find them on the Projects page.',
      })
      setTab('used')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setCreating(null)
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
          already made. Pick the good ones and turn them into drafts.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        <Panel title="Suggest ideas" className="lg:sticky lg:top-4">
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
            {!canSuggest && <p className="text-[13px] text-ink-2">Add GEMINI_API_KEY to get suggestions.</p>}
          </div>
        </Panel>

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
            ]}
            className="self-start"
          />

          {tab === 'new' && (picked.length > 0 || creating) && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[var(--radius-panel)] border border-ink bg-ink px-4 py-3 text-paper">
              {creating ? (
                <div className="flex w-full items-center gap-3">
                  <span className="text-[14px]">{creating.label}</span>
                  <ProgressBar
                    value={creating.done / creating.total}
                    tone="you"
                    className="max-w-64 flex-1"
                  />
                </div>
              ) : (
                <>
                  <span className="text-[14px]">{plural(picked.length, 'idea')} picked</span>
                  <label className="flex items-center gap-2 text-[14px]">
                    <input
                      type="checkbox"
                      checked={writeScripts}
                      onChange={(e) => setWriteScripts(e.target.checked)}
                      className="size-4 accent-kodak"
                    />
                    Write the scripts too
                  </label>
                  <Button
                    variant="go"
                    className="ml-auto"
                    onClick={createDrafts}
                    icon={<ArrowRight className="size-4" />}
                  >
                    Create {plural(picked.length, 'draft')}
                  </Button>
                </>
              )}
            </div>
          )}

          {error && <p className="text-[14px] text-bad">Could not load ideas: {errorText(error)}</p>}
          {isLoading && <div className="h-48 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />}
          {tab === 'new' && suggesting && (
            <div
              aria-live="polite"
              className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel"
            >
              <p className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13.5px] text-ink-2">
                <Spinner className="text-ink-3" />
                Gemini is thinking up {count} ideas. This can take up to half a minute.
              </p>
              {Array.from({ length: Math.min(Number(count), 4) }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0">
                  <div className="h-4 w-2/3 animate-pulse-soft rounded bg-line" />
                  <div className="h-3 w-full animate-pulse-soft rounded bg-line/60" />
                  <div className="h-3 w-4/5 animate-pulse-soft rounded bg-line/60" />
                </div>
              ))}
            </div>
          )}
          {ideas && list.length === 0 && !(tab === 'new' && suggesting) && (
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
                        disabled={Boolean(creating)}
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
