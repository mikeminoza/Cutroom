'use client'

import { activeChunk, captionWords, chunkCaptions, toSrt } from '@cutroom/shared/captions'
import { formatTimecode, totalDuration } from '@cutroom/shared/timing'
import type { CaptionStyle, Motion } from '@cutroom/shared/types'
import { ArrowRight, Download, Music, Pause, Play, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, DropZone, Field, Panel, ProgressBar, Segmented } from '@/components/ui'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { SceneDTO } from '@/lib/dto'
import { useSaver } from '@/lib/hooks'
import { useUploader } from './fields'
import type { StepProps } from './workspace'

/**
 * The exact motion curve the worker renders with (see apps/worker/src/render/render.ts):
 * zoom up to 12% (0.05 per second for short scenes) around the focus point, or a pan of the
 * viewing window across up to 10% of the width (0.04 per second), half-linear/half-cosine eased.
 */
export function motionStyle(
  motion: Motion,
  progress: number,
  seconds: number,
  focusY: number,
  focusX: number,
): { transform: string; origin: string } {
  const p = Math.min(1, Math.max(0, progress))
  const eased = 0.5 * p + 0.25 * (1 - Math.cos(Math.PI * p))
  if (motion === 'zoom-in' || motion === 'zoom-out') {
    const amount = Math.min(0.12, 0.05 * seconds)
    const k = Math.log(1 + amount)
    const scale = Math.exp(k * (motion === 'zoom-in' ? eased : 1 - eased))
    return { transform: `scale(${scale})`, origin: `${focusX * 100}% ${focusY * 100}%` }
  }
  if (motion === 'pan-left' || motion === 'pan-right') {
    const travel = Math.min(0.1, 0.04 * seconds)
    const scale = 1 / (1 - travel)
    const offset = travel * (motion === 'pan-right' ? eased : 1 - eased)
    return {
      transform: `translateX(${-offset * scale * 100}%) scale(${scale})`,
      origin: `0% ${focusY * 100}%`,
    }
  }
  return { transform: 'none', origin: '50% 50%' }
}

function sceneAt(scenes: SceneDTO[], time: number): number {
  let lo = 0
  let hi = scenes.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (scenes[mid].start <= time) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export function PreviewStep({ data, goTo }: StepProps) {
  const { project, scenes } = data
  const { saver } = useSaver(project.id)
  const upload = useUploader(project.id)
  const [musicProgress, setMusicProgress] = useState<number | null>(null)
  const duration = project.voiceoverDuration ?? totalDuration(scenes)
  const words = useMemo(() => captionWords(project.transcript, scenes), [project.transcript, scenes])

  const downloadSrt = () => {
    const blob = new Blob([toSrt(words)], { type: 'application/x-subrip' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project.title || 'video').replace(/[^\w-]+/g, '-').toLowerCase()}.srt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onMusic = async ([file]: File[]) => {
    try {
      setMusicProgress(0)
      const stored = await upload(file, 'music', setMusicProgress)
      await saver.project({ musicUrl: stored.url, musicName: file.name }, 0)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setMusicProgress(null)
    }
  }

  if (scenes.length === 0) {
    return (
      <Panel title="Preview">
        <p className="px-5 py-12 text-center text-[14px] text-ink-2">
          Add scenes and a voice-over to preview the video.
        </p>
      </Panel>
    )
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Player data={data} duration={duration} />
      <div className="flex flex-col gap-5">
        <Panel title="Captions">
          <div className="flex flex-col gap-4 px-5 py-4">
            <Segmented<CaptionStyle>
              ariaLabel="Caption style"
              value={project.captionStyle}
              onChange={(captionStyle) => saver.project({ captionStyle }, 0)}
              options={[
                { value: 'highlight', label: 'Word by word' },
                { value: 'line', label: 'Plain' },
                { value: 'off', label: 'Off' },
              ]}
              className="w-full"
            />
            <p className="text-[12.5px] leading-snug text-ink-3">
              {project.transcript
                ? 'Timed to the words in your voice-over.'
                : 'Timing is estimated until the scenes are matched to the voice-over.'}{' '}
              A caption track is also added to YouTube.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadSrt}
              icon={<Download className="size-3.5" />}
              className="self-start"
            >
              Download captions (.srt)
            </Button>
          </div>
        </Panel>
        <Panel title="Background music">
          <div className="flex flex-col gap-4 px-5 py-4">
            {project.musicUrl ? (
              <>
                <div className="flex items-center gap-2 text-[13.5px]">
                  <Music className="size-4 shrink-0 text-ink-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{project.musicName ?? 'Music'}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label="Remove music"
                    onClick={() => saver.project({ musicUrl: null, musicName: null }, 0)}
                    icon={<Trash2 className="size-3.5" />}
                  />
                </div>
                <Field label="Volume under the voice" aside={`${Math.round(project.musicVolume * 100)}%`}>
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={project.musicVolume}
                    onChange={(e) => saver.project({ musicVolume: Number(e.target.value) })}
                    className="accent-ink"
                  />
                </Field>
              </>
            ) : (
              <DropZone accept="audio/*" onFiles={onMusic}>
                {({ open, dragging }) => (
                  <button
                    type="button"
                    onClick={open}
                    className={cn(
                      'flex w-full flex-col items-center gap-1 rounded-[var(--radius-control)] border border-dashed px-4 py-5 text-[13px] text-ink-2 transition-colors',
                      dragging
                        ? 'border-ink bg-kodak-wash'
                        : 'border-line-strong hover:border-ink hover:text-ink',
                    )}
                  >
                    {musicProgress !== null ? (
                      <ProgressBar value={musicProgress} tone="you" className="w-40" />
                    ) : (
                      <>
                        <Music className="size-4" aria-hidden />
                        Add a music track (optional)
                      </>
                    )}
                  </button>
                )}
              </DropZone>
            )}
            <p className="text-[12.5px] leading-snug text-ink-3">
              It loops, gets quieter while you speak and fades out at the end.
            </p>
          </div>
        </Panel>
        <Panel title="Quality">
          <div className="flex flex-col gap-3 px-5 py-4">
            <Segmented
              ariaLabel="Resolution"
              value={project.resolution}
              onChange={(resolution) => saver.project({ resolution }, 0)}
              options={[
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p' },
              ]}
              className="w-full"
            />
            <p className="text-[12.5px] leading-snug text-ink-3">
              720p renders much faster on the free worker. Use 1080p when your images are large.
            </p>
          </div>
        </Panel>
        <Button
          variant="go"
          size="lg"
          onClick={() => goTo('publish')}
          icon={<ArrowRight className="size-4" />}
        >
          Publish
        </Button>
      </div>
    </div>
  )
}

function Player({ data, duration }: { data: StepProps['data']; duration: number }) {
  const { project, scenes } = data
  const audio = useRef<HTMLAudioElement>(null)
  const music = useRef<HTMLAudioElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const clock = useRef({ playing: false, base: 0, startedAt: 0 })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const portrait = project.format === 'portrait'

  const chunks = useMemo(
    () => chunkCaptions(captionWords(project.transcript, scenes), project.format),
    [project.transcript, project.format, scenes],
  )

  const now = useCallback(() => {
    if (audio.current && project.voiceoverUrl) return audio.current.currentTime
    const c = clock.current
    return c.playing ? c.base + (performance.now() - c.startedAt) / 1000 : c.base
  }, [project.voiceoverUrl])

  // Frame loop: motion is written straight to the image so React only re-renders on scene and word changes.
  useEffect(() => {
    let frame = 0
    let lastUi = 0
    const tick = (ts: number) => {
      let t = now()
      if (t >= duration) {
        t = duration
        if (clock.current.playing) {
          clock.current = { playing: false, base: duration, startedAt: 0 }
          setPlaying(false)
        }
      }
      const i = sceneAt(scenes, t)
      setIndex((prev) => (prev === i ? prev : i))
      // A scene without an image holds the previous image, which keeps moving (as in the render).
      let held = i
      while (held > 0 && !scenes[held].imageUrl) held--
      const scene = scenes[held]
      if (scene && image.current) {
        let next = held + 1
        while (next < scenes.length && !scenes[next].imageUrl) next++
        const end = next < scenes.length ? scenes[next].start : Math.max(duration, scene.end)
        const length = Math.max(0.1, end - scene.start)
        const style = motionStyle(
          scene.motion,
          (t - scene.start) / length,
          length,
          scene.focusY,
          scene.focusX,
        )
        image.current.style.transform = style.transform
        image.current.style.transformOrigin = style.origin
      }
      if (ts - lastUi > 80) {
        lastUi = ts
        setTime(t)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [now, scenes, duration])

  useEffect(() => {
    if (music.current) music.current.volume = Math.min(1, project.musicVolume)
  }, [project.musicVolume])

  const play = async () => {
    if (time >= duration - 0.05) seek(0)
    if (project.voiceoverUrl && audio.current) {
      try {
        await audio.current.play()
      } catch {
        return
      }
    } else {
      clock.current = { playing: true, base: clock.current.base, startedAt: performance.now() }
    }
    void music.current?.play().catch(() => {})
    setPlaying(true)
  }

  const pause = () => {
    audio.current?.pause()
    music.current?.pause()
    if (!project.voiceoverUrl) clock.current = { playing: false, base: now(), startedAt: 0 }
    setPlaying(false)
  }

  const seek = (t: number) => {
    const target = Math.max(0, Math.min(duration, t))
    if (audio.current && project.voiceoverUrl) audio.current.currentTime = target
    else clock.current = { ...clock.current, base: target, startedAt: performance.now() }
    if (music.current?.duration) music.current.currentTime = target % music.current.duration
    setTime(target)
  }

  const scene = scenes[index]
  // Missing image: hold the last scene that has one, like the render does.
  const shown = scene?.imageUrl ? scene : [...scenes.slice(0, index)].reverse().find((s) => s.imageUrl)
  const chunk = project.captionStyle === 'off' ? null : activeChunk(chunks, time)

  return (
    <Panel>
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage is a keyboard-operable player (space, arrows)
          tabIndex={0}
          role="application"
          aria-label="Video preview. Space plays or pauses, arrow keys move 5 seconds."
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault()
              playing ? pause() : void play()
            }
            if (e.key === 'ArrowRight') seek(time + 5)
            if (e.key === 'ArrowLeft') seek(time - 5)
          }}
          onClick={() => (playing ? pause() : void play())}
          className={cn(
            'relative mx-auto overflow-hidden rounded-[6px] bg-[#14171f] [container-type:size]',
            portrait ? 'aspect-[9/16] max-h-[70vh]' : 'aspect-video w-full',
          )}
        >
          {shown?.imageUrl && (
            <>
              {shown.fit === 'contain' && (
                // biome-ignore lint/performance/noImgElement: user uploads
                <img
                  src={shown.imageUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 size-full scale-110 object-cover opacity-55 blur-xl brightness-75"
                />
              )}
              {/* biome-ignore lint/performance/noImgElement: user uploads */}
              <img
                ref={image}
                key={shown.id}
                src={shown.imageUrl}
                alt={`Scene ${shown.index + 1}`}
                className={cn(
                  'absolute inset-0 size-full will-change-transform',
                  shown.fit === 'cover' ? 'object-cover' : 'object-contain',
                )}
                style={{ objectPosition: `${shown.focusX * 100}% ${shown.focusY * 100}%` }}
              />
            </>
          )}
          {!shown?.imageUrl && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-paper/50">
              Scene {(scene?.index ?? 0) + 1} has no image yet
            </div>
          )}
          {chunk && (
            <div
              className={cn(
                'pointer-events-none absolute inset-x-[8%] text-center leading-[1.15] font-[800] text-white',
                portrait ? 'top-[68%] -translate-y-1/2 text-[4.2cqh]' : 'bottom-[8%] text-[5.2cqh]',
              )}
              style={{
                WebkitTextStroke: '0.12em #000',
                paintOrder: 'stroke fill',
                textShadow: '0 0.06em 0.2em rgba(0,0,0,.45)',
              }}
            >
              {chunk.words.map((w, i) => (
                <span
                  key={i}
                  style={{
                    color:
                      project.captionStyle === 'highlight' &&
                      time >= w.start &&
                      (time < w.end || i === chunk.words.length - 1)
                        ? '#FFB800'
                        : undefined,
                  }}
                >
                  {w.text}
                  {i < chunk.words.length - 1 ? ' ' : ''}
                </span>
              ))}
            </div>
          )}
          {!playing && (
            <span className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink/70 text-paper">
              <Play className="ml-0.5 size-6" aria-hidden />
            </span>
          )}
        </div>
      </div>

      {project.voiceoverUrl && (
        // biome-ignore lint/a11y/useMediaCaption: captions are drawn on the stage
        <audio ref={audio} src={project.voiceoverUrl} preload="auto" onEnded={() => setPlaying(false)} />
      )}
      {project.musicUrl && (
        // biome-ignore lint/a11y/useMediaCaption: background music
        <audio ref={music} src={project.musicUrl} preload="auto" loop />
      )}

      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
        <Button
          variant="dark"
          size="sm"
          aria-label="Previous scene"
          onClick={() =>
            seek(scenes[Math.max(0, index - (time - (scene?.start ?? 0) > 1 ? 0 : 1))]?.start ?? 0)
          }
          icon={<SkipBack className="size-3.5" />}
        />
        <Button
          variant="go"
          size="sm"
          onClick={() => (playing ? pause() : void play())}
          icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          className="w-20"
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="dark"
          size="sm"
          aria-label="Next scene"
          onClick={() => seek(scenes[Math.min(scenes.length - 1, index + 1)]?.start ?? duration)}
          icon={<SkipForward className="size-3.5" />}
        />
        <span className="tc text-[13.5px]">
          {formatTimecode(time)} <span className="text-ink-3">/ {formatTimecode(duration)}</span>
        </span>
        <span className="ml-auto text-[13px] text-ink-2">
          Scene <span className="tc font-medium text-ink">{(scene?.index ?? 0) + 1}</span> of {scenes.length}
        </span>
        <div className="relative w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2"
          >
            {scenes.map((s) => (
              <span
                key={s.id}
                className={cn('h-full border-r border-panel', s.imageUrl ? 'bg-ink/20' : 'bg-kodak/60')}
                style={{ width: `${((s.end - s.start) / Math.max(duration, 0.1)) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="relative w-full accent-ink"
          />
        </div>
      </div>
    </Panel>
  )
}
