'use client'

import { formatTimecode } from '@cutroom/shared/timing'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface Frame {
  id?: string
  start: number
  end: number
  imageUrl: string | null
}

/**
 * Compact strip for project rows: one frame per scene, width by duration.
 * Hatched yellow frames are scenes still waiting for their image.
 */
export function MiniStrip({
  frames,
  className,
  archived,
}: {
  frames: Frame[]
  className?: string
  archived?: boolean
}) {
  return (
    <div
      className={cn(
        'relative flex h-14 flex-col justify-between overflow-hidden rounded-[6px] bg-film py-[3px]',
        className,
      )}
    >
      <div aria-hidden className="sprockets h-[6px] shrink-0 opacity-40" />
      <div className="flex min-h-0 flex-1 gap-[2px] px-[3px]">
        {frames.length === 0 ? (
          <span className="flex w-full items-center px-2 text-[11.5px] text-film-ink/50">No scenes yet</span>
        ) : (
          frames.map((frame, i) => (
            <span
              key={frame.id ?? i}
              className={cn(
                'relative min-w-[3px] overflow-hidden rounded-[2px]',
                frame.imageUrl && !archived
                  ? 'bg-film-2'
                  : 'hatch bg-film-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-kodak)_55%,transparent)]',
                archived && 'bg-film-line shadow-none',
              )}
              style={{ flexGrow: Math.max(0.3, frame.end - frame.start), flexBasis: 0 }}
            >
              {frame.imageUrl && !archived && (
                // biome-ignore lint/performance/noImgElement: user uploads from storage
                <img
                  src={frame.imageUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </span>
          ))
        )}
      </div>
      <div aria-hidden className="sprockets h-[6px] shrink-0 opacity-40" />
    </div>
  )
}

/**
 * The workspace filmstrip: every scene laid across the video's running time.
 * Click a frame to jump to that scene.
 */
export function Filmstrip({
  frames,
  duration,
  selectedId,
  onSelect,
  playhead,
  archived,
}: {
  frames: (Frame & { id: string; index: number })[]
  duration: number
  selectedId?: string | null
  onSelect?: (id: string) => void
  playhead?: number | null
  archived?: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const pxPerSecond = Math.max(14, Math.min(48, 1400 / Math.max(duration, 1)))
  const width = Math.max(duration * pxPerSecond, 200)
  const tickEvery = duration > 600 ? 60 : duration > 240 ? 30 : duration > 60 ? 10 : 5
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += tickEvery) ticks.push(t)

  useEffect(() => {
    if (!selectedId || !scroller.current) return
    const el = scroller.current.querySelector<HTMLElement>(`[data-frame="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <div className="rounded-[var(--radius-panel)] bg-film text-paper">
      <div
        ref={scroller}
        className="overflow-x-auto px-3 pt-2 pb-3 [scrollbar-color:var(--color-film-line)_transparent]"
      >
        <div className="relative" style={{ width }}>
          <div aria-hidden className="relative h-5 border-b border-film-line">
            {ticks.map((t) => (
              <span
                key={t}
                className="tc absolute top-0 -translate-x-1/2 text-[10.5px] text-paper/45 first:translate-x-0"
                style={{ left: t * pxPerSecond }}
              >
                {formatTimecode(t, false)}
              </span>
            ))}
          </div>
          <div aria-hidden className="sprockets mt-1.5 h-[7px] opacity-35" />
          <div className="relative mt-1 flex h-[68px] gap-[3px]">
            {frames.map((frame) => {
              const selected = frame.id === selectedId
              const empty = !frame.imageUrl || archived
              return (
                <button
                  key={frame.id}
                  type="button"
                  data-frame={frame.id}
                  onClick={() => onSelect?.(frame.id)}
                  aria-label={`Scene ${frame.index + 1}, ${formatTimecode(frame.start)} to ${formatTimecode(frame.end)}${empty ? ', no image yet' : ''}`}
                  aria-pressed={selected}
                  className={cn(
                    'group relative h-full shrink-0 overflow-hidden rounded-[var(--radius-frame)] text-left transition-shadow',
                    empty ? 'hatch bg-film-2' : 'bg-film-2',
                    selected
                      ? 'shadow-[0_0_0_2px_var(--color-kodak)]'
                      : empty
                        ? 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-kodak)_55%,transparent)] hover:shadow-[0_0_0_1px_var(--color-kodak)]'
                        : 'hover:shadow-[0_0_0_1px_var(--color-paper)]',
                  )}
                  style={{ width: Math.max(18, (frame.end - frame.start) * pxPerSecond - 3) }}
                >
                  {!empty && (
                    // biome-ignore lint/performance/noImgElement: user uploads from storage
                    <img
                      src={frame.imageUrl!}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 size-full object-cover"
                    />
                  )}
                  <span className="tc absolute top-1 left-1 rounded-[2px] bg-film/80 px-1 text-[10.5px] leading-[15px] text-film-ink/90">
                    {frame.index + 1}
                  </span>
                </button>
              )
            })}
            {playhead !== null && playhead !== undefined && (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-[18px] bottom-0 w-[2px] bg-kodak"
                style={{ left: playhead * pxPerSecond }}
              />
            )}
          </div>
          <div aria-hidden className="sprockets mt-1 h-[7px] opacity-35" />
        </div>
      </div>
    </div>
  )
}
