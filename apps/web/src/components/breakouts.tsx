'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, Pencil, RotateCcw, Search, Sparkles, TrendingUp, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import type { BreakoutDTO, BreakoutsDTO, IdeaDTO } from '@/lib/dto'
import { plural, timeAgo } from '@/lib/format'
import { keys, useIdeas, useStatus } from '@/lib/hooks'
import { Button, ButtonLink, Input } from './ui'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const breakoutsKey = ['breakouts'] as const

/**
 * Ideas → Breakouts: recent videos in the niche with far more views than their channel usually
 * gets, from the weekly YouTube search. Each one becomes an idea for this channel in one click,
 * then a draft in another.
 */
export function Breakouts() {
  const client = useQueryClient()
  const router = useRouter()
  const { data: status } = useStatus()
  const { data, isLoading, error } = useQuery({
    queryKey: breakoutsKey,
    queryFn: () => api.get<BreakoutsDTO>('/api/breakouts'),
  })
  const { data: ideas } = useIdeas()
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const connected = status?.youtube.connected !== false

  const search = async (queries?: string[]) => {
    setSearching(true)
    try {
      const next = await api.post<BreakoutsDTO & { added: number }>(
        '/api/breakouts',
        queries ? { queries } : {},
      )
      client.setQueryData(breakoutsKey, next)
      setEditing(false)
      toast.success(
        next.added ? `Found ${plural(next.added, 'new video')} breaking out` : 'No new breakouts this time',
      )
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSearching(false)
    }
  }

  const patch = (id: string, change: Partial<BreakoutDTO>) =>
    client.setQueryData<BreakoutsDTO>(breakoutsKey, (prev) =>
      prev
        ? { ...prev, breakouts: prev.breakouts.map((b) => (b.id === id ? { ...b, ...change } : b)) }
        : prev,
    )

  const makeIdea = async (breakout: BreakoutDTO) => {
    setBusy(breakout.id)
    try {
      const { ideaId } = await api.post<{ ideaId: string }>(`/api/breakouts/${breakout.id}/idea`)
      patch(breakout.id, { status: 'used', ideaId })
      await client.invalidateQueries({ queryKey: keys.ideas })
      toast.success('Added to your new ideas')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const draftIdea = async (breakout: BreakoutDTO) => {
    if (!breakout.ideaId) return
    setBusy(breakout.id)
    try {
      const { created } = await api.post<{ created: { projectId: string }[] }>('/api/ideas/drafts', {
        ids: [breakout.ideaId],
        format: breakout.seconds > 0 && breakout.seconds <= 180 ? 'portrait' : 'landscape',
      })
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.ideas }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      if (created[0]) router.push(`/projects/${created[0].projectId}`)
    } catch (err) {
      toast.error(errorText(err))
      setBusy(null)
    }
  }

  const setStatus = async (breakout: BreakoutDTO, next: 'new' | 'dismissed') => {
    patch(breakout.id, { status: next })
    try {
      await api.patch(`/api/breakouts/${breakout.id}`, { status: next })
    } catch (err) {
      toast.error(errorText(err))
      void client.invalidateQueries({ queryKey: breakoutsKey })
    }
  }

  const all = data?.breakouts ?? []
  const dismissed = all.filter((b) => b.status === 'dismissed')
  const shown = all.filter((b) => b.status !== 'dismissed' || showDismissed)
  const ideaOf = (b: BreakoutDTO): IdeaDTO | undefined => ideas?.find((i) => i.id === b.ideaId)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-3.5">
        {editing ? (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              void search(
                draft
                  .split(',')
                  .map((q) => q.trim())
                  .filter(Boolean)
                  .slice(0, 5),
              )
            }}
          >
            <label htmlFor="breakout-queries" className="text-[13.5px] font-medium">
              Search YouTube for
            </label>
            <Input
              id="breakout-queries"
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="why do i wake up at 3am, sleep science, funny science facts"
            />
            <p className="text-[12.5px] text-ink-3">
              Up to 5 searches, separated by commas. Leave it empty and Gemini writes them from your niche.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="go"
                size="sm"
                busy={searching}
                icon={<Search className="size-3.5" />}
              >
                Save and search
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-ink-2">
                {data?.queries.length ? (
                  <>
                    Searching for{' '}
                    {data.queries.map((q, i) => (
                      <span key={q}>
                        <span className="font-medium text-ink">“{q}”</span>
                        {i < data.queries.length - 2 ? ', ' : i === data.queries.length - 2 ? ' and ' : ''}
                      </span>
                    ))}
                  </>
                ) : (
                  'The first search works out what to look for from your niche.'
                )}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                Videos from the last 30 days with at least 3 times their channel’s usual views. Searched once
                a week{data?.scannedAt ? `, last ${timeAgo(data.scannedAt)}` : ''}.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(data?.queries.join(', ') ?? '')
                setEditing(true)
              }}
              icon={<Pencil className="size-3.5" />}
            >
              Change
            </Button>
            <Button
              variant="plain"
              size="sm"
              busy={searching}
              disabled={!connected}
              onClick={() => search()}
              icon={<Search className="size-3.5" />}
            >
              Search now
            </Button>
          </div>
        )}
        {!connected && (
          <p className="mt-2 text-[13px] text-ink-2">
            Connect YouTube in Settings to search for breakout videos.
          </p>
        )}
      </div>

      {error && <p className="text-[14px] text-bad">Could not load breakouts: {errorText(error)}</p>}
      {isLoading && <div className="h-48 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />}
      {data && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-12 text-center">
          <TrendingUp className="size-6 text-ink-3" aria-hidden />
          <p className="max-w-[48ch] text-[14px] text-ink-2">
            {data.scannedAt
              ? 'Nothing is breaking out in these searches right now. Try other searches, or check back next week.'
              : 'Search YouTube to find recent videos in your niche that are doing far better than their channels usually do.'}
          </p>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
          {shown.map((b) => {
            const idea = ideaOf(b)
            return (
              <li
                key={b.id}
                className="grid grid-cols-[112px_1fr] items-start gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:grid-cols-[132px_1fr_auto]"
              >
                <a
                  href={`https://youtu.be/${b.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-video overflow-hidden rounded-[4px] bg-sunk"
                >
                  {b.thumbnailUrl && (
                    // biome-ignore lint/performance/noImgElement: YouTube's own thumbnail
                    <img src={b.thumbnailUrl} alt="" className="size-full object-cover" />
                  )}
                  {b.seconds > 0 && b.seconds <= 180 && (
                    <span className="absolute right-1 bottom-1 rounded-[3px] bg-film/85 px-1 text-[10.5px] text-film-ink">
                      Short
                    </span>
                  )}
                </a>
                <div className="min-w-0">
                  <a
                    href={`https://youtu.be/${b.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex max-w-full items-start gap-1.5 text-[14.5px] font-semibold"
                  >
                    <span className="line-clamp-2 group-hover:underline">{b.title}</span>
                    <ExternalLink className="mt-1 size-3 shrink-0 text-ink-3" aria-hidden />
                  </a>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    {b.channelTitle}
                    {b.publishedAt ? ` · ${timeAgo(b.publishedAt)}` : ''}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="rounded-full bg-kodak-wash px-2 py-0.5 font-semibold text-kodak-ink">
                      {b.score >= 10 ? Math.round(b.score) : b.score.toFixed(1)}× usual
                    </span>
                    <span className="text-ink-2">
                      {compact.format(b.views)} views; the channel usually gets{' '}
                      {compact.format(b.channelAverage)}
                    </span>
                  </p>
                  {idea && (
                    <p className="mt-1.5 text-[13px] text-ink-2">
                      Your idea: <span className="font-medium text-ink">{idea.title}</span>
                    </p>
                  )}
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1 sm:justify-end">
                  {b.status === 'new' && (
                    <>
                      <Button
                        variant="plain"
                        size="sm"
                        busy={busy === b.id}
                        onClick={() => makeIdea(b)}
                        icon={<Sparkles className="size-3.5" />}
                      >
                        Make it an idea
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Dismiss"
                        title="Dismiss"
                        onClick={() => setStatus(b, 'dismissed')}
                        icon={<X className="size-3.5" />}
                      />
                    </>
                  )}
                  {b.status === 'used' &&
                    (idea?.status === 'used' && idea.projectId ? (
                      <ButtonLink
                        href={`/projects/${idea.projectId}`}
                        size="sm"
                        icon={<ArrowRight className="size-3.5" aria-hidden />}
                      >
                        Open draft
                      </ButtonLink>
                    ) : idea?.status === 'new' ? (
                      <Button
                        variant="go"
                        size="sm"
                        busy={busy === b.id}
                        onClick={() => draftIdea(b)}
                        icon={<ArrowRight className="size-3.5" />}
                      >
                        Draft it
                      </Button>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">Made into an idea</span>
                    ))}
                  {b.status === 'dismissed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStatus(b, 'new')}
                      icon={<RotateCcw className="size-3.5" />}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {dismissed.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDismissed((v) => !v)}
          className="self-start text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          {showDismissed ? 'Hide dismissed' : `Show ${plural(dismissed.length, 'dismissed video')}`}
        </button>
      )}
    </div>
  )
}
