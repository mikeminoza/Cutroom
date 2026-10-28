'use client'

import { biggestDrops, hookHold, sceneDrops, topSearchTerms, watchingAt } from '@cutroom/shared/retention'
import { formatTimecode } from '@cutroom/shared/timing'
import { Search } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PerformanceVideo } from '@/lib/dto'
import { formatWhen } from '@/lib/format'
import { useProject } from '@/lib/hooks'
import { Panel, Select } from './ui'

const percent = (n: number) => `${Math.round(n * 100)}%`
const time = (seconds: number) => formatTimecode(seconds, false)
const excerpt = (text: string, words = 14) => {
  const all = text.trim().split(/\s+/).filter(Boolean)
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ')
}

/** Videos YouTube has a retention curve for, and whose length is known. */
const charted = (v: PerformanceVideo) =>
  Boolean(v.insights?.retention?.length && v.duration && v.duration > 0)

/**
 * Where viewers stop watching one video, scene by scene: YouTube's retention curve over the
 * video's own scenes, with the scenes that lost the most people (beyond the video's usual pace)
 * marked and listed, each a link to its scene.
 */
export function WhereViewersLeave({ videos }: { videos: PerformanceVideo[] }) {
  const ready = useMemo(
    () =>
      videos
        .filter(charted)
        .sort((a, b) =>
          (b.stats?.publishedAt ?? b.scheduledAt ?? '').localeCompare(
            a.stats?.publishedAt ?? a.scheduledAt ?? '',
          ),
        ),
    [videos],
  )
  const [picked, setPicked] = useState<string | null>(null)
  const video = ready.find((v) => v.id === picked) ?? ready[0] ?? null

  return (
    <Panel
      title="Where viewers leave"
      description="The share of viewers still watching through a video, over its scenes. Gemini reads where your latest videos lost people when it writes the next script."
      actions={
        ready.length > 1 && (
          <Select
            aria-label="Video"
            value={video?.id ?? ''}
            onChange={(e) => setPicked(e.target.value)}
            className="w-64"
          >
            {ready.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title || 'Untitled video'}
              </option>
            ))}
          </Select>
        )
      }
    >
      {video ? (
        <Retention video={video} />
      ) : (
        <p className="px-5 py-8 text-[13.5px] leading-relaxed text-ink-2">
          YouTube shows where viewers stop watching once a video has a few hundred views, a few days after it
          goes live. It appears here after the next refresh, if the channel was connected with the analytics
          permission.
        </p>
      )}
    </Panel>
  )
}

function Retention({ video }: { video: PerformanceVideo }) {
  const { data } = useProject(video.id)
  const retention = video.insights?.retention ?? []
  const duration = video.duration ?? 0
  const scenes = data?.scenes ?? []
  const drops = useMemo(() => sceneDrops(retention, scenes, duration), [retention, scenes, duration])
  const worst = useMemo(() => biggestDrops(drops), [drops])
  const [table, setTable] = useState(false)

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <p className="text-[13.5px] text-ink-2">
        <span className="font-medium text-ink">{percent(hookHold(retention, duration))}</span> still watching
        at {time(Math.min(30, duration))} ·{' '}
        <span className="font-medium text-ink">{percent(retention[retention.length - 1] ?? 0)}</span> at the
        end ({time(duration)})
        {video.stats?.publishedAt ? ` · posted ${formatWhen(video.stats.publishedAt)}` : ''}
      </p>
      <RetentionChart retention={retention} duration={duration} drops={drops} worst={worst} />
      {worst.length > 0 ? (
        <ol className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {worst.map((drop, i) => {
            const scene = scenes[drop.index]
            return (
              <li key={drop.index} className="flex flex-wrap items-start gap-3 px-3.5 py-2.5 text-[13.5px]">
                <span className="tc grid size-5 shrink-0 place-items-center rounded-full bg-kodak text-[11.5px] font-semibold text-kodak-ink">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink-2">
                    <span className="tc">
                      {time(drop.start)}–{time(drop.end)}
                    </span>{' '}
                    · Scene {drop.index + 1} · <span className="text-ink">{percent(drop.lost)} left</span>,{' '}
                    {percent(drop.excess)} more than usual for its length
                  </p>
                  {drop.narration.trim() && <p className="mt-0.5 text-ink">“{excerpt(drop.narration)}”</p>}
                </div>
                {scene && (
                  <Link
                    href={`/projects/${video.id}?step=script&scene=${scene.id}`}
                    className="shrink-0 text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                  >
                    Open scene
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        scenes.length > 0 && (
          <p className="text-[13px] text-ink-3">No scene lost viewers faster than the rest of the video.</p>
        )
      )}
      {drops.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            aria-expanded={table}
            className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {table ? 'Hide the table' : 'Show every scene as a table'}
          </button>
          {table && (
            <div className="mt-2 max-h-80 overflow-auto rounded-[var(--radius-control)] border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-panel text-[12px] text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-medium">Scene</th>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 text-right font-medium">Watching at its start</th>
                    <th className="px-3 py-2 text-right font-medium">Left during it</th>
                  </tr>
                </thead>
                <tbody>
                  {drops.map((d) => (
                    <tr key={d.index} className="border-t border-line">
                      <td className="tc px-3 py-1.5">{d.index + 1}</td>
                      <td className="tc px-3 py-1.5">
                        {time(d.start)}–{time(d.end)}
                      </td>
                      <td className="tc px-3 py-1.5 text-right">
                        {percent(watchingAt(retention, d.start, duration))}
                      </td>
                      <td className="tc px-3 py-1.5 text-right">{percent(Math.max(0, d.lost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const HEIGHT = 220
const PAD = { top: 14, right: 12, bottom: 26, left: 40 }

/** A "nice" step for about `count` ticks over `span` seconds: 5 s, 10 s, 15 s, 30 s, 1 min… */
function timeStep(span: number, count = 6): number {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]
  return steps.find((s) => span / s <= count) ?? 3600
}

function RetentionChart({
  retention,
  duration,
  drops,
  worst,
}: {
  retention: number[]
  duration: number
  drops: ReturnType<typeof sceneDrops>
  worst: ReturnType<typeof sceneDrops>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Rewatched parts can pass 100%: the scale grows to fit them.
  const top = Math.max(1, Math.ceil(Math.max(...retention) * 4) / 4)
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (seconds: number) => PAD.left + (seconds / duration) * plotW
  const y = (share: number) => PAD.top + (1 - share / top) * plotH
  const points = [
    [0, retention[0]] as const,
    ...retention.map((v, i) => [((i + 1) / retention.length) * duration, v] as const),
  ]
  const line = points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const yTicks = Array.from({ length: Math.round(top / 0.25) + 1 }, (_, i) => i * 0.25)
  const step = timeStep(duration)
  const xTicks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step)
  const at = hover === null ? null : Math.min(duration, Math.max(0, hover))
  const scene =
    at === null ? null : (drops.find((d) => at >= d.start && at < d.end) ?? drops[drops.length - 1])

  return (
    <div ref={box} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Share of viewers still watching, from ${percent(retention[0] ?? 0)} at the start to ${percent(retention[retention.length - 1] ?? 0)} at the end`}
        className="block touch-none select-none"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - rect.left
          setHover(px < PAD.left || px > width - PAD.right ? null : ((px - PAD.left) / plotW) * duration)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line" />
            <text
              x={PAD.left - 8}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              className="tc fill-ink-3 text-[11px]"
            >
              {percent(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={HEIGHT - 8}
            textAnchor={tick === 0 ? 'start' : 'middle'}
            className="tc fill-ink-3 text-[11px]"
          >
            {time(tick)}
          </text>
        ))}
        {/* The scenes that lost the most, shaded and numbered at the bottom, clear of the line. */}
        {worst.map((drop, i) => (
          <g key={drop.index}>
            <rect
              x={x(drop.start)}
              y={PAD.top}
              width={Math.max(2, x(drop.end) - x(drop.start))}
              height={plotH}
              className="fill-kodak-wash"
            />
            <circle cx={(x(drop.start) + x(drop.end)) / 2} cy={y(0) - 14} r={8} className="fill-kodak" />
            <text
              x={(x(drop.start) + x(drop.end)) / 2}
              y={y(0) - 14}
              dy="0.35em"
              textAnchor="middle"
              className="fill-kodak-ink text-[10.5px] font-semibold"
            >
              {i + 1}
            </text>
          </g>
        ))}
        {/* Scene cuts, as small ticks on the baseline. */}
        {drops.slice(1).map((d) => (
          <line
            key={d.index}
            x1={x(d.start)}
            x2={x(d.start)}
            y1={y(0)}
            y2={y(0) - 5}
            className="stroke-line-strong"
          />
        ))}
        <path
          d={line}
          className="fill-none stroke-run"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {at !== null && (
          <g pointerEvents="none">
            <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={y(0)} className="stroke-ink-3" />
            <circle
              cx={x(at)}
              cy={y(watchingAt(retention, at, duration))}
              r={4.5}
              strokeWidth={2}
              className="fill-run stroke-panel"
            />
          </g>
        )}
      </svg>
      {at !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-56 rounded-[var(--radius-control)] border border-line bg-panel px-3 py-2 text-[12.5px] shadow-lg"
          style={x(at) > width / 2 ? { right: width - x(at) + 12 } : { left: x(at) + 12 }}
        >
          <p className="tc text-ink-3">{time(at)}</p>
          <p className="text-ink">
            <span className="font-semibold">{percent(watchingAt(retention, at, duration))}</span> still
            watching
          </p>
          {scene && (
            <p className="mt-1 text-ink-2">
              Scene {scene.index + 1}
              {scene.narration.trim() ? `: “${excerpt(scene.narration, 10)}”` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The YouTube searches that led people to the channel's videos, added up. Gemini uses their
 * wording in new titles, descriptions, tags and ideas.
 */
export function SearchesThatFindYou({ videos }: { videos: PerformanceVideo[] }) {
  const terms = useMemo(() => topSearchTerms(videos.map((v) => v.insights?.searchTerms ?? [])), [videos])
  const most = Math.max(1, ...terms.map((t) => t.views))
  return (
    <Panel
      title="Searches that find you"
      description="What people typed into YouTube before watching. Gemini uses these words in new titles, tags and ideas."
    >
      {terms.length > 0 ? (
        <ol className="divide-y divide-line">
          {terms.map((t) => (
            <li key={t.term} className="flex items-center gap-3 px-5 py-2 text-[13.5px]">
              <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t.term}</span>
              <span className="relative hidden h-1.5 w-24 overflow-hidden sm:block" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-run"
                  style={{ width: `${Math.max(4, (t.views / most) * 100)}%` }}
                />
              </span>
              <span className="tc w-20 text-right text-ink-2">
                {t.views.toLocaleString('en-US')} {t.views === 1 ? 'view' : 'views'}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-8 text-[13.5px] leading-relaxed text-ink-2">
          Once people find your videos by searching YouTube, their searches show up here after the daily
          refresh. It needs the analytics permission on the channel.
        </p>
      )}
    </Panel>
  )
}
