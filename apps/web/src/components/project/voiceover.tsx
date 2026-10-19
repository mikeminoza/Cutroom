'use client'

import { formatTimecode } from '@cutroom/shared/timing'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, AudioLines, Pause, Play, RefreshCw, Ruler, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type WaveSurfer from 'wavesurfer.js'
import type RegionsPlugin from 'wavesurfer.js/plugins/regions'
import type { Region } from 'wavesurfer.js/plugins/regions'
import { Button, DropZone, Panel, ProgressBar, useConfirm } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { JobDTO, ProjectFull } from '@/lib/dto'
import { formatLength } from '@/lib/format'
import { keys, useProjectAction, useSaver, useStatus } from '@/lib/hooks'
import { audioDuration } from '@/lib/upload'
import { useUploader } from './fields'
import { JobSteps } from './job-panel'
import type { StepProps } from './workspace'

export function VoiceoverStep({ data, selectedSceneId, selectScene, goTo }: StepProps) {
  const { project, scenes } = data
  const { saver } = useSaver(project.id)
  const upload = useUploader(project.id)
  const action = useProjectAction(project.id)
  const { data: status } = useStatus()
  const { confirm, element } = useConfirm()
  const [progress, setProgress] = useState<number | null>(null)
  const job = data.jobs.retime
  const running = job && ['queued', 'running'].includes(job.status)
  const recentlyFinished =
    job &&
    job.status !== 'queued' &&
    job.finishedAt &&
    Date.now() - new Date(job.finishedAt).getTime() < 10 * 60_000

  const onFiles = async ([file]: File[]) => {
    if (
      project.voiceoverUrl &&
      !(await confirm({
        title: 'Replace the voice-over?',
        body: 'The new recording replaces the old one. Match the scenes again afterwards.',
        action: 'Replace voice-over',
      }))
    ) {
      return
    }
    try {
      setProgress(0)
      const duration = await audioDuration(file)
      const stored = await upload(file, 'voiceover', setProgress)
      await saver.project(
        { voiceoverUrl: stored.url, voiceoverName: file.name, voiceoverDuration: duration, transcript: null },
        0,
      )
      toast.success('Voice-over uploaded')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setProgress(null)
    }
  }

  const retime = () => action(`/api/projects/${project.id}/retime`)
  const fit = () => action(`/api/projects/${project.id}/fit-timing`, {}, 'Scenes spread over the voice-over')

  if (!project.voiceoverUrl) {
    return (
      <DropZone accept="audio/*" onFiles={onFiles} className="rounded-[var(--radius-panel)]">
        {({ open, dragging }) => (
          <button
            type="button"
            onClick={open}
            disabled={progress !== null}
            className={cn(
              'flex w-full flex-col items-center gap-3 rounded-[var(--radius-panel)] border-2 border-dashed px-6 py-16 text-center transition-colors',
              dragging ? 'border-ink bg-kodak-wash' : 'border-line-strong bg-panel hover:border-ink',
            )}
          >
            <AudioLines className="size-8 text-ink-2" aria-hidden />
            <span className="display text-[22px]">Drop your voice-over here</span>
            <span className="max-w-[52ch] text-[14px] text-ink-2">
              MP3, WAV or M4A. Gemini will listen to it and move each scene to the moment its words are
              spoken.
            </span>
            {progress !== null ? (
              <ProgressBar value={progress} tone="you" className="mt-2 w-64" />
            ) : (
              <span className="mt-2 inline-flex h-[38px] items-center rounded-[var(--radius-control)] bg-kodak px-4 text-[14px] font-semibold">
                Choose a file
              </span>
            )}
          </button>
        )}
      </DropZone>
    )
  }

  const timed = Boolean(project.transcript)
  const noScenes = scenes.length === 0
  const canAi = status?.gemini.configured !== false && status?.worker.configured !== false

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={project.voiceoverName ?? 'Voice-over'}
        description={`${formatLength(project.voiceoverDuration ?? 0)} long${timed ? '. Scenes are matched to the speech.' : '.'}`}
        actions={
          <DropZone accept="audio/*" onFiles={onFiles}>
            {({ open }) => (
              <Button
                variant="plain"
                size="sm"
                onClick={open}
                busy={progress !== null}
                icon={<RefreshCw className="size-3.5" />}
              >
                Replace
              </Button>
            )}
          </DropZone>
        }
      >
        <div className="px-5 py-4">
          <Waveform data={data} selectedSceneId={selectedSceneId} onSelectScene={selectScene} />
          <p className="mt-3 text-[12.5px] text-ink-3">
            Drag the edge between two scenes to move the cut. Click a scene to select it.
          </p>
        </div>
      </Panel>

      <Panel
        title={
          noScenes
            ? 'Make scenes from the voice-over'
            : timed
              ? 'Timing'
              : 'Match the scenes to the voice-over'
        }
        description={
          noScenes
            ? 'No script? Gemini can transcribe the voice-over and cut it into scenes for you.'
            : 'Gemini transcribes the recording, then lines up each scene with the moment its narration starts.'
        }
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          {running || recentlyFinished ? <JobSteps job={job as JobDTO} /> : null}
          {job?.status === 'done' &&
            typeof job.result.matchedRatio === 'number' &&
            job.result.matchedRatio < 0.7 && (
              <p className="rounded-[var(--radius-control)] bg-kodak-wash px-3 py-2 text-[13.5px] text-kodak-ink">
                The recording differs from the script in places. Check the cuts on the waveform above.
              </p>
            )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={timed ? 'plain' : 'go'}
              busy={Boolean(running)}
              disabled={!canAi}
              onClick={retime}
              icon={<Wand2 className="size-4" />}
            >
              {noScenes ? 'Make scenes' : timed ? 'Match again' : 'Match scenes to voice-over'}
            </Button>
            {!noScenes && (
              <Button
                variant="ghost"
                onClick={fit}
                disabled={Boolean(running)}
                icon={<Ruler className="size-4" />}
              >
                Spread evenly (no AI)
              </Button>
            )}
            {timed && (
              <Button
                variant="plain"
                className="ml-auto"
                onClick={() => goTo('images')}
                icon={<ArrowRight className="size-4" />}
              >
                Images
              </Button>
            )}
          </div>
          {!canAi && (
            <p className="text-[13px] text-ink-2">
              Matching needs {status?.gemini.configured === false ? 'a Gemini API key' : 'the worker'}. Set it
              up in Settings, or spread the scenes evenly and fine-tune the cuts by hand.
            </p>
          )}
          {project.transcript && <Transcript data={data} />}
        </div>
      </Panel>
      {element}
    </div>
  )
}

function Transcript({ data }: { data: ProjectFull }) {
  const [open, setOpen] = useState(false)
  const segments = data.project.transcript?.segments ?? []
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[13px] font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
      >
        {open ? 'Hide transcript' : `Show transcript (${segments.length} lines)`}
      </button>
      {open && (
        <ol className="mt-3 max-h-80 overflow-y-auto rounded-[var(--radius-control)] border border-line">
          {segments.map((s, i) => (
            <li
              key={i}
              className="grid grid-cols-[72px_1fr] gap-3 border-b border-line px-3 py-2 text-[13.5px] last:border-b-0"
            >
              <span className="tc text-ink-3">{formatTimecode(s.start)}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const REGION_FILL = ['rgba(23,28,38,0.06)', 'rgba(23,28,38,0.11)']

function Waveform({
  data,
  selectedSceneId,
  onSelectScene,
}: {
  data: ProjectFull
  selectedSceneId: string | null
  onSelectScene: (id: string) => void
}) {
  const { project, scenes } = data
  const client = useQueryClient()
  const container = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const regions = useRef<InstanceType<typeof RegionsPlugin> | null>(null)
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [zoom, setZoom] = useState(0)

  const signature = useMemo(() => scenes.map((s) => `${s.id}:${s.start}:${s.end}`).join('|'), [scenes])

  const saveTimes = useCallback(
    async (times: { id: string; start: number; end: number }[]) => {
      client.setQueryData<ProjectFull>(keys.project(project.id), (prev) =>
        prev
          ? {
              ...prev,
              scenes: prev.scenes.map((s) => ({ ...s, ...(times.find((t) => t.id === s.id) ?? {}) })),
            }
          : prev,
      )
      try {
        await api.put(`/api/projects/${project.id}/scenes`, { times })
      } catch (error) {
        toast.error(errorText(error))
        void client.invalidateQueries({ queryKey: keys.project(project.id) })
      }
    },
    [client, project.id],
  )

  useEffect(() => {
    if (!container.current || !project.voiceoverUrl) return
    let cancelled = false
    let instance: WaveSurfer | null = null
    // Loaded in the browser only: wavesurfer touches the DOM when it starts.
    void Promise.all([import('wavesurfer.js'), import('wavesurfer.js/plugins/regions')]).then(
      ([{ default: WaveSurferClass }, { default: Regions }]) => {
        if (cancelled || !container.current) return
        const plugin = Regions.create()
        instance = WaveSurferClass.create({
          container: container.current,
          url: project.voiceoverUrl!,
          height: 104,
          waveColor: '#a3abb9',
          progressColor: '#171c26',
          cursorColor: '#eaa800',
          cursorWidth: 2,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          normalize: true,
          dragToSeek: true,
          plugins: [plugin],
        })
        const wave = instance
        ws.current = wave
        regions.current = plugin
        wave.on('decode', () => setReady(true))
        wave.on('play', () => setPlaying(true))
        wave.on('pause', () => setPlaying(false))
        wave.on('timeupdate', (t) => setTime(t))
        plugin.on('region-clicked', (region, event) => {
          event.stopPropagation()
          onSelectScene(region.id)
          wave.setTime(region.start)
        })
        plugin.on('region-updated', (region: Region) => {
          const list = scenesRef.current
          const index = list.findIndex((s) => s.id === region.id)
          if (index < 0) return
          const changed = [{ id: region.id, start: region.start, end: region.end }]
          const previous = list[index - 1]
          const next = list[index + 1]
          if (previous) changed.push({ id: previous.id, start: previous.start, end: region.start })
          if (next) changed.push({ id: next.id, start: region.end, end: next.end })
          const round = (n: number) => Math.round(n * 100) / 100
          void saveTimes(changed.map((c) => ({ id: c.id, start: round(c.start), end: round(c.end) })))
        })
      },
    )
    return () => {
      cancelled = true
      instance?.destroy()
      ws.current = null
      regions.current = null
      setReady(false)
    }
  }, [project.voiceoverUrl, onSelectScene, saveTimes])

  // Draw one region per scene; redraw whenever timings change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` changes whenever any scene timing changes
  useEffect(() => {
    const plugin = regions.current
    if (!ready || !plugin) return
    plugin.clearRegions()
    scenesRef.current.forEach((scene, i) => {
      const label = document.createElement('span')
      label.textContent = String(i + 1)
      label.style.cssText =
        'font: 600 11px/1 var(--font-archivo), sans-serif; padding: 3px 4px; color: #171c26; font-variant-numeric: tabular-nums;'
      plugin.addRegion({
        id: scene.id,
        start: scene.start,
        end: Math.max(scene.end, scene.start + 0.2),
        color: scene.id === selectedSceneId ? 'rgba(255,184,0,0.32)' : REGION_FILL[i % 2],
        drag: false,
        resize: true,
        minLength: 0.4,
        content: label,
      })
    })
  }, [ready, signature, selectedSceneId])

  useEffect(() => {
    if (ready) ws.current?.zoom(zoom)
  }, [zoom, ready])

  return (
    <div>
      <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-line bg-sunk">
        <div ref={container} className="min-h-[104px]" />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-3">
            Reading the waveform…
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="dark"
          size="sm"
          disabled={!ready}
          onClick={() => ws.current?.playPause()}
          icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="tc text-[13.5px]">
          {formatTimecode(time)}{' '}
          <span className="text-ink-3">/ {formatTimecode(project.voiceoverDuration ?? 0)}</span>
        </span>
        <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2">
          Zoom
          <input
            type="range"
            min={0}
            max={200}
            step={10}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-32 accent-ink"
          />
        </label>
      </div>
    </div>
  )
}
