'use client'

import { HIT } from '@cutroom/shared/hits'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Sparkles, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import type { HitDTO, IdeaDTO } from '@/lib/dto'
import { plural, timeAgo } from '@/lib/format'
import { keys, useIdeas, useStatus } from '@/lib/hooks'
import { Button } from './ui'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const hitsKey = ['hits'] as const

/**
 * Ideas → Your hits: your own videos doing far better than your usual, from the stats the daily
 * refresh stores (shared/hits.ts). Each can become follow-up ideas in one click: Gemini takes what
 * made it work to the next question, and the ideas join the New ones, ready to draft.
 */
export function Hits() {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const {
    data: hits,
    isLoading,
    error,
  } = useQuery({
    queryKey: hitsKey,
    queryFn: () => api.get<HitDTO[]>('/api/hits'),
  })
  const { data: ideas } = useIdeas()
  const [busy, setBusy] = useState<string | null>(null)
  const canWrite = status?.gemini.configured !== false
  const manyChannels = (status?.channels.length ?? 0) > 1

  const followUp = async (hit: HitDTO) => {
    setBusy(hit.id)
    try {
      const added = await api.post<IdeaDTO[]>(`/api/hits/${hit.id}/ideas`)
      client.setQueryData<IdeaDTO[]>(keys.ideas, (prev) => [...added, ...(prev ?? [])])
      toast.success(
        added.length
          ? `Added ${plural(added.length, 'follow-up idea')} to your new ideas`
          : 'No new follow-ups this time. Try again in a bit.',
      )
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const followUpsOf = (hit: HitDTO): IdeaDTO[] => ideas?.filter((i) => i.followUpOf === hit.id) ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-3.5">
        <p className="text-[13.5px] text-ink-2">
          Your videos with at least {HIT.minTimes} times the views your others usually get. Follow one up
          while people are watching: Gemini takes what made it work to the next question.
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          Long videos are compared with long videos and Shorts with Shorts, each with the ones out at least as
          long. Checked once a day; you get a message for each new hit.
        </p>
      </div>

      {error && <p className="text-[14px] text-bad">Could not load your hits: {errorText(error)}</p>}
      {isLoading && <div className="h-48 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />}
      {hits && hits.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-12 text-center">
          <TrendingUp className="size-6 text-ink-3" aria-hidden />
          <p className="max-w-[50ch] text-[14px] text-ink-2">
            None of your videos is doing far better than usual right now. Each one is compared with at least{' '}
            {HIT.minPeers} of your others, so hits can show up once you have {HIT.minPeers + 1} long videos or{' '}
            {HIT.minPeers + 1} Shorts out.
          </p>
        </div>
      )}
      {hits && hits.length > 0 && (
        <ul className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel">
          {hits.map((hit) => {
            const followUps = followUpsOf(hit)
            const kind = hit.format === 'portrait' ? 'Shorts' : 'videos'
            return (
              <li
                key={hit.id}
                className="grid grid-cols-[112px_1fr] items-start gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:grid-cols-[132px_1fr_auto]"
              >
                <a
                  href={`https://youtu.be/${hit.youtubeVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on YouTube"
                  className="relative block aspect-video overflow-hidden rounded-[4px] bg-sunk"
                >
                  {/* biome-ignore lint/performance/noImgElement: YouTube's own thumbnail */}
                  <img
                    src={`https://i.ytimg.com/vi/${hit.youtubeVideoId}/mqdefault.jpg`}
                    alt=""
                    className="size-full object-cover"
                  />
                  {hit.format === 'portrait' && (
                    <span className="absolute right-1 bottom-1 rounded-[3px] bg-film/85 px-1 text-[10.5px] text-film-ink">
                      Short
                    </span>
                  )}
                </a>
                <div className="min-w-0">
                  <div className="flex items-start gap-1.5">
                    <Link
                      href={`/projects/${hit.id}?step=publish`}
                      className="line-clamp-2 text-[14.5px] font-semibold hover:underline"
                    >
                      {hit.title}
                    </Link>
                    <a
                      href={`https://youtu.be/${hit.youtubeVideoId}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open on YouTube"
                      className="mt-1 text-ink-3 hover:text-ink"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    {[
                      `Out ${timeAgo(hit.publishedAt)}`,
                      manyChannels ? hit.channelTitle : null,
                      hit.averageViewPercent !== null
                        ? `${Math.round(hit.averageViewPercent)}% watched`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="rounded-full bg-kodak-wash px-2 py-0.5 font-semibold text-kodak-ink">
                      {hit.times >= 10 ? Math.round(hit.times) : hit.times.toFixed(1)}× usual
                    </span>
                    <span className="text-ink-2">
                      {compact.format(hit.views)} views; your {kind} usually get {compact.format(hit.usual)}
                    </span>
                  </p>
                  {followUps.length > 0 && (
                    <p className="mt-1.5 text-[13px] text-ink-2">
                      Follow-ups:{' '}
                      {followUps.map((idea, i) => (
                        <span key={idea.id}>
                          <span className="font-medium text-ink">{idea.title}</span>
                          {i < followUps.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1 sm:justify-end">
                  <Button
                    variant={followUps.length ? 'ghost' : 'plain'}
                    size="sm"
                    busy={busy === hit.id}
                    disabled={!canWrite}
                    onClick={() => followUp(hit)}
                    icon={<Sparkles className="size-3.5" />}
                  >
                    {followUps.length ? 'Write more' : 'Write follow-ups'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!canWrite && <p className="text-[13px] text-ink-2">Add GEMINI_API_KEY to write follow-up ideas.</p>}
    </div>
  )
}
