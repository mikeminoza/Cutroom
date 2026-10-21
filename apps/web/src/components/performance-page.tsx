'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PerformanceDTO, PerformanceVideo } from '@/lib/dto'
import { formatWhen, timeAgo } from '@/lib/format'
import { keys, usePerformance, useSeriesList, useStatus } from '@/lib/hooks'
import { Button, Panel, Segmented, Select } from './ui'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US')

function watchTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  return `${compact.format(minutes / 60)} h`
}

function viewDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Sort = 'views' | 'newest' | 'retention'

export function PerformancePage() {
  const { data, isLoading, error } = usePerformance()
  const { data: status } = useStatus()
  const seriesList = useSeriesList()
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [sort, setSort] = useState<Sort>('views')
  const [channelId, setChannelId] = useState('all')

  const refresh = async () => {
    setRefreshing(true)
    try {
      const next = await api.post<PerformanceDTO>('/api/performance')
      client.setQueryData(keys.performance, next)
      setNotes(next.notes)
      toast.success('Stats updated from YouTube')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setRefreshing(false)
    }
  }

  // A channel picked earlier and since disconnected falls back to all of them.
  const selected = data?.channels.some((c) => c.id === channelId) ? channelId : 'all'

  const videos = useMemo(() => {
    const list = (data?.videos ?? []).filter((v) => selected === 'all' || v.channelId === selected)
    const sorted = [...list]
    if (sort === 'views') sorted.sort((a, b) => (b.stats?.views ?? -1) - (a.stats?.views ?? -1))
    if (sort === 'newest')
      sorted.sort((a, b) =>
        (b.stats?.publishedAt ?? b.scheduledAt ?? '').localeCompare(
          a.stats?.publishedAt ?? a.scheduledAt ?? '',
        ),
      )
    if (sort === 'retention')
      sorted.sort((a, b) => (b.stats?.averageViewPercent ?? -1) - (a.stats?.averageViewPercent ?? -1))
    return sorted
  }, [data, sort, selected])

  const measured = videos.filter((v) => v.stats)
  const totals = {
    views: measured.reduce((n, v) => n + (v.stats?.views ?? 0), 0),
    minutes: measured.reduce((n, v) => n + (v.stats?.watchMinutes ?? 0), 0),
    hasMinutes: measured.some((v) => v.stats?.watchMinutes !== null),
    subscribers: measured.reduce((n, v) => n + (v.stats?.subscribersGained ?? 0), 0),
    hasSubscribers: measured.some((v) => v.stats?.subscribersGained !== null),
  }
  // Average percentage viewed, weighted by views so a big video counts for more.
  const retention = (() => {
    const rated = measured.filter((v) => v.stats?.averageViewPercent !== null && (v.stats?.views ?? 0) > 0)
    const weight = rated.reduce((n, v) => n + (v.stats?.views ?? 0), 0)
    if (!weight) return null
    return rated.reduce((n, v) => n + (v.stats?.averageViewPercent ?? 0) * (v.stats?.views ?? 0), 0) / weight
  })()
  const maxViews = Math.max(1, ...measured.map((v) => v.stats?.views ?? 0))
  const fetched = measured
    .map((v) => v.stats?.fetchedAt)
    .filter(Boolean)
    .sort()
    .pop()
  const channels = data?.channels ?? []
  const shownChannel = channels.find((c) => c.id === selected) ?? null
  // Follows the channel picker, like the totals and the table.
  const top = [...videos]
    .filter((v) => (v.stats?.views ?? 0) > 0)
    .sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
    .slice(0, 5)

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">Performance</h1>
          <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
            How your posted videos are doing. Watch time and retention arrive 2–3 days after a video goes
            live.{' '}
            {status?.daily === 'needs-secret' ? 'Updated when you press Refresh now' : 'Updated once a day'}
            {fetched ? `, last ${timeAgo(fetched)}` : ''}. The best titles also teach Gemini what works on
            your channel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {channels.length > 1 && (
            <Select
              aria-label="Channel"
              value={selected}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-52"
            >
              <option value="all">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
          <Button variant="plain" busy={refreshing} onClick={refresh} icon={<RefreshCw className="size-4" />}>
            Refresh now
          </Button>
        </div>
      </header>

      {error && <p className="text-[14px] text-bad">Could not load stats: {errorText(error)}</p>}
      {isLoading && <div className="h-64 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />}

      {notes.length > 0 && (
        <ul className="mb-6 flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-kodak-wash px-3.5 py-3 text-[13px] text-kodak-ink">
          {notes.map((note) => (
            <li key={note} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      )}

      {data && data.videos.length === 0 && (
        <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-12 text-center text-[14.5px] text-ink-2">
          Videos you post to YouTube show up here with their views, likes and watch time.
        </div>
      )}

      {data && data.videos.length > 0 && (
        <div className="flex flex-col gap-6">
          <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Views"
              value={compact.format(totals.views)}
              detail={`${measured.length} videos`}
            />
            <StatTile
              label="Watch time"
              value={totals.hasMinutes ? watchTime(totals.minutes) : '—'}
              detail={
                totals.hasMinutes
                  ? shownChannel
                    ? `On ${shownChannel.title}`
                    : 'All posted videos'
                  : 'Needs the analytics permission'
              }
            />
            <StatTile
              label="Average viewed"
              value={retention === null ? '—' : `${Math.round(retention)}%`}
              detail="Of each video, weighted by views"
            />
            <StatTile
              label="Subscribers gained"
              value={totals.hasSubscribers ? compact.format(totals.subscribers) : '—'}
              detail="From these videos"
            />
          </section>

          <Panel
            title="Videos"
            actions={
              <Segmented<Sort>
                ariaLabel="Sort videos"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'views', label: 'Most viewed' },
                  { value: 'newest', label: 'Newest' },
                  { value: 'retention', label: 'Best kept' },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead className="border-b border-line text-[12.5px] text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Video</th>
                    <th className="w-[26%] px-3 py-2.5 font-medium">Views</th>
                    <th className="px-3 py-2.5 text-right font-medium">Likes</th>
                    <th className="px-3 py-2.5 text-right font-medium">Comments</th>
                    <th
                      className="px-3 py-2.5 text-right font-medium"
                      title="Average share of the video watched"
                    >
                      Viewed
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Average view duration">
                      Avg. view
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">Watch time</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((video) => (
                    <VideoRow
                      key={video.id}
                      video={video}
                      maxViews={maxViews}
                      channel={
                        channels.length > 1
                          ? channels.find((c) => c.id === video.channelId)?.title
                          : undefined
                      }
                      series={seriesList.data?.find((s) => s.id === video.seriesId)?.name}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {top.length > 0 && (
            <Panel
              title="What works"
              description={`${shownChannel ? `The most-viewed titles on ${shownChannel.title}.` : 'Your most-viewed titles.'} Gemini studies them when it writes new titles and suggests ideas.`}
            >
              <ol className="divide-y divide-line">
                {top.map((video, i) => (
                  <li key={video.id} className="flex items-center gap-3 px-5 py-2.5 text-[14px]">
                    <span className="tc w-5 text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{video.title || 'Untitled video'}</span>
                    <span className="tc text-ink-2">{whole.format(video.stats?.views ?? 0)} views</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-panel px-5 py-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-1 text-[28px] leading-tight font-semibold">{value}</p>
      <p className="mt-1 text-[12.5px] text-ink-3">{detail}</p>
    </div>
  )
}

function VideoRow({
  video,
  maxViews,
  channel,
  series,
}: {
  video: PerformanceVideo
  maxViews: number
  channel?: string
  series?: string
}) {
  const stats = video.stats
  const when = stats?.publishedAt ?? video.scheduledAt
  const share = stats ? stats.views / maxViews : 0
  const now = Date.now()
  const upcoming = Boolean(video.scheduledAt && new Date(video.scheduledAt).getTime() > now)
  // YouTube Analytics reports a video's watch time and retention 2–3 days after it goes live.
  const recent = !upcoming && Boolean(when) && now - new Date(when as string).getTime() < 3 * 86_400_000
  const later = (value: string) =>
    value === '—' && (recent || upcoming) ? (
      <span className="text-[12px] text-ink-3" title="YouTube reports this 2–3 days after a video goes live">
        {upcoming ? 'after launch' : 'in 2–3 days'}
      </span>
    ) : (
      value
    )
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-sunk/60">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${video.id}?step=publish`}
            className="max-w-[34ch] truncate font-medium hover:underline"
          >
            {video.title || 'Untitled video'}
          </Link>
          <a
            href={`https://youtu.be/${video.youtubeVideoId}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on YouTube"
            className="text-ink-3 hover:text-ink"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {[video.format === 'portrait' ? 'Short' : 'Video', when ? formatWhen(when) : null, series, channel]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </td>
      <td className="px-3 py-3">
        {stats ? (
          <div className="flex items-center gap-2.5" title={`${whole.format(stats.views)} views`}>
            <span className="tc w-12 shrink-0 text-right">{compact.format(stats.views)}</span>
            <span className="relative h-2 flex-1 overflow-hidden" aria-hidden>
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-r-[4px] bg-run',
                  stats.views === 0 && 'hidden',
                )}
                style={{ width: `${Math.max(1.5, share * 100)}%` }}
              />
            </span>
          </div>
        ) : (
          <span className="text-ink-3">
            {upcoming && video.scheduledAt ? `Goes live ${formatWhen(video.scheduledAt)}` : 'Not counted yet'}
          </span>
        )}
      </td>
      <td className="tc px-3 py-3 text-right">{stats ? whole.format(stats.likes) : '—'}</td>
      <td className="tc px-3 py-3 text-right">{stats ? whole.format(stats.comments) : '—'}</td>
      <td className="tc px-3 py-3 text-right">
        {later(stats?.averageViewPercent != null ? `${Math.round(stats.averageViewPercent)}%` : '—')}
      </td>
      <td className="tc px-3 py-3 text-right">{later(viewDuration(stats?.averageViewSeconds ?? null))}</td>
      <td className="tc px-5 py-3 text-right">
        {later(stats?.watchMinutes != null ? watchTime(stats.watchMinutes) : '—')}
      </td>
    </tr>
  )
}
