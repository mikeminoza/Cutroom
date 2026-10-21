'use client'

import { formatTimecode } from '@cutroom/shared/timing'
import { DEFAULT_VOICE, GEMINI_VOICES, type VoiceSettings } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  AudioLines,
  Mic,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Square,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type WaveSurfer from 'wavesurfer.js'
import type RegionsPlugin from 'wavesurfer.js/plugins/regions'
import type { Region } from 'wavesurfer.js/plugins/regions'
import {
  Button,
  DropZone,
  Field,
  Input,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  useConfirm,
} from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { JobDTO, ProjectFull } from '@/lib/dto'
import { formatLength } from '@/lib/format'
import { keys, useProjectAction, useSaver, useSettings, useStatus, useVoices } from '@/lib/hooks'
import { useTheme } from '@/lib/theme'
import { audioDuration } from '@/lib/upload'
import { useUploader } from './fields'
import { JobSteps } from './job-panel'
import { ScenePromptsPanel } from './scene-prompts'
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
  const voiceJob = data.jobs.voice
  const recording = Boolean(voiceJob && ['queued', 'running'].includes(voiceJob.status))

  const onFiles = async ([file]: File[]) => {
    if (recording) {
      toast.error('The AI voice-over is being recorded. Wait for it to finish, or stop it first.')
      return
    }
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
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <DropZone
          accept="audio/*"
          onFiles={onFiles}
          disabled={recording}
          className="rounded-[var(--radius-panel)]"
        >
          {({ open, dragging }) => (
            <button
              type="button"
              onClick={open}
              disabled={progress !== null || recording}
              className={cn(
                'flex w-full flex-col items-center gap-3 rounded-[var(--radius-panel)] border-2 border-dashed px-6 py-14 text-center transition-colors disabled:opacity-60',
                dragging ? 'border-ink bg-kodak-wash' : 'border-line-strong bg-panel hover:border-ink',
              )}
            >
              <AudioLines className="size-8 text-ink-2" aria-hidden />
              <span className="display text-[22px]">Drop your voice-over here</span>
              <span className="max-w-[46ch] text-[14px] text-ink-2">
                MP3, WAV or M4A. Gemini will listen to it and move each scene to the moment its words are
                spoken.
              </span>
              {progress !== null ? (
                <ProgressBar value={progress} tone="you" className="mt-2 w-64" />
              ) : (
                <span className="mt-2 inline-flex h-[38px] items-center rounded-[var(--radius-control)] bg-kodak px-4 text-[14px] font-semibold text-on-kodak">
                  Choose a file
                </span>
              )}
            </button>
          )}
        </DropZone>
        <AiVoicePanel data={data} />
        {element}
      </div>
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
          <DropZone accept="audio/*" onFiles={onFiles} disabled={recording}>
            {({ open }) => (
              <Button
                variant="plain"
                size="sm"
                onClick={open}
                busy={progress !== null}
                disabled={recording}
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
            : 'Gemini transcribes the recording, then lines up each scene with the moment its narration starts. The pauses in the recording place every word.'
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
              disabled={!canAi || recording}
              onClick={retime}
              icon={<Wand2 className="size-4" />}
            >
              {noScenes ? 'Make scenes' : timed ? 'Match again' : 'Match scenes to voice-over'}
            </Button>
            {!noScenes && (
              <Button
                variant="ghost"
                onClick={fit}
                disabled={Boolean(running) || recording}
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
      {!noScenes && <ScenePromptsPanel data={data} timed={timed} />}
      <AiVoicePanel data={data} />
      {element}
    </div>
  )
}

/** Records the voice-over with an AI voice (Gemini or ElevenLabs), then times the scenes to it. */
function AiVoicePanel({ data }: { data: ProjectFull }) {
  const { project, scenes } = data
  const client = useQueryClient()
  const action = useProjectAction(project.id)
  const { data: status } = useStatus()
  const { data: settings } = useSettings()
  const { confirm, element } = useConfirm()
  const [voice, setVoice] = useState<VoiceSettings>(project.voice ?? DEFAULT_VOICE)
  const touched = useRef(Boolean(project.voice))
  const [busy, setBusy] = useState<string | null>(null)
  const elevenReady = Boolean(status?.elevenlabs.configured)
  const geminiReady = status?.gemini.configured !== false
  const voices = useVoices(voice.provider === 'elevenlabs' && elevenReady)
  const job = data.jobs.voice
  const running = Boolean(job && ['queued', 'running'].includes(job.status))
  const showJob =
    job &&
    (running ||
      job.status === 'failed' ||
      (job.finishedAt && Date.now() - new Date(job.finishedAt).getTime() < 10 * 60_000)) &&
    !(job.status === 'failed' && job.error === 'Stopped by you.')
  const narrated = scenes.filter((s) => s.narration.trim()).length
  const hasText = narrated > 0 || Boolean(project.script.trim())
  const providerReady = voice.provider === 'gemini' ? geminiReady : elevenReady
  const workerReady = status?.worker.configured !== false

  // Start from the default voice in Settings until you pick one yourself.
  useEffect(() => {
    if (!touched.current && settings?.voice) setVoice(settings.voice)
  }, [settings?.voice])

  const elevenVoices = voices.data?.elevenlabs ?? []
  const change = (patch: Partial<VoiceSettings>) => {
    touched.current = true
    setVoice((current) => {
      const next = { ...current, ...patch }
      if (patch.provider === 'gemini' && !GEMINI_VOICES.some((v) => v.name === next.voice)) {
        next.voice = DEFAULT_VOICE.voice
      }
      if (patch.provider === 'elevenlabs' && GEMINI_VOICES.some((v) => v.name === next.voice)) {
        next.voice = elevenVoices[0]?.id ?? ''
      }
      return next
    })
  }
  // The ElevenLabs list arrives after switching: take its first voice.
  useEffect(() => {
    if (voice.provider !== 'elevenlabs' || !elevenVoices.length) return
    if (!elevenVoices.some((v) => v.id === voice.voice)) {
      setVoice((current) => ({ ...current, voice: elevenVoices[0].id }))
    }
  }, [voice.provider, voice.voice, elevenVoices])

  const record = async () => {
    if (
      project.voiceoverUrl &&
      !(await confirm({
        title: 'Replace the voice-over?',
        body: 'The AI voice-over replaces your current recording. The scenes are then matched to it again.',
        action: 'Record with AI',
      }))
    ) {
      return
    }
    setBusy('record')
    await action(`/api/projects/${project.id}/voice`, voice, 'Recording started')
    setBusy(null)
  }

  const jobAction = async (name: 'retry' | 'cancel') => {
    if (!job) return
    setBusy(name)
    try {
      await api.post(`/api/jobs/${job.id}/${name}`)
      await client.invalidateQueries({ queryKey: keys.project(project.id) })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title="AI voice-over"
      description={
        narrated
          ? `An AI voice reads the narration of your ${narrated} ${narrated === 1 ? 'scene' : 'scenes'}. Every word's timing is known, so the scenes and captions line up exactly.`
          : 'An AI voice reads your script. Every word’s timing is known, so the captions line up exactly.'
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <Field label="Voice service">
          <Segmented
            ariaLabel="Voice service"
            value={voice.provider}
            onChange={(provider) => change({ provider })}
            options={[
              { value: 'gemini', label: 'Gemini', hint: 'On the free tier' },
              {
                value: 'elevenlabs',
                label: 'ElevenLabs',
                hint: elevenReady ? 'Your ElevenLabs voices' : 'Add ELEVENLABS_API_KEY to use it',
              },
            ]}
            className="w-full"
          />
        </Field>
        {voice.provider === 'gemini' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voice">
              <Select value={voice.voice} onChange={(e) => change({ voice: e.target.value })}>
                {GEMINI_VOICES.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} — {v.character.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Delivery" aside="Optional">
              <Input
                value={voice.style}
                maxLength={300}
                onChange={(e) => change({ style: e.target.value })}
                placeholder="Warm, unhurried documentary narrator"
              />
            </Field>
          </div>
        ) : (
          <Field
            label="Voice"
            error={
              !elevenReady
                ? 'Add ELEVENLABS_API_KEY on the web app and the worker to use ElevenLabs.'
                : voices.data?.elevenlabsError
            }
          >
            <Select
              value={voice.voice}
              disabled={!elevenReady || voices.isLoading}
              onChange={(e) => change({ voice: e.target.value })}
            >
              {voices.isLoading && <option value="">Loading your voices…</option>}
              {elevenVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.description ? ` — ${v.description}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {showJob && job && <JobSteps job={job} />}
        {job?.status === 'failed' && job.error && job.error !== 'Stopped by you.' && (
          <p className="rounded-[var(--radius-control)] bg-bad-wash px-3 py-2.5 text-[13.5px] text-bad">
            {job.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={project.voiceoverUrl ? 'plain' : 'go'}
            busy={busy === 'record' || running}
            disabled={!hasText || !providerReady || !workerReady || !voice.voice}
            onClick={record}
            icon={<Mic className="size-4" />}
          >
            {project.voiceoverUrl ? 'Record again with AI' : 'Record with AI'}
          </Button>
          {running && (
            <Button
              variant="ghost"
              size="sm"
              busy={busy === 'cancel'}
              onClick={() => jobAction('cancel')}
              icon={<Square className="size-3.5" />}
            >
              Stop
            </Button>
          )}
          {job?.status === 'failed' && job.error !== 'Stopped by you.' && (
            <Button
              variant="ghost"
              size="sm"
              busy={busy === 'retry'}
              onClick={() => jobAction('retry')}
              icon={<RotateCcw className="size-3.5" />}
            >
              Retry from where it stopped
            </Button>
          )}
        </div>
        {!hasText && <p className="text-[13px] text-ink-2">Write the script first: the AI voice reads it.</p>}
        {hasText && !workerReady && (
          <p className="text-[13px] text-ink-2">Recording runs on the worker. Set it up in Settings.</p>
        )}
        {hasText && voice.provider === 'gemini' && !geminiReady && (
          <p className="text-[13px] text-ink-2">Add GEMINI_API_KEY to use Gemini voices.</p>
        )}
      </div>
      {element}
    </Panel>
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

// Regions take CSS colors, so they follow the theme by themselves. The waveform is drawn on a
// canvas, so its colors are picked per theme.
const REGION_FILL = [
  'color-mix(in srgb, var(--color-ink) 6%, transparent)',
  'color-mix(in srgb, var(--color-ink) 11%, transparent)',
]
const WAVE_COLORS = {
  light: { waveColor: '#a3abb9', progressColor: '#151a23', cursorColor: '#eaa800' },
  dark: { waveColor: '#566072', progressColor: '#e8ebf0', cursorColor: '#ffb800' },
}

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
  const theme = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme

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
          ...WAVE_COLORS[themeRef.current],
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
        'font: 600 11px/1 var(--font-archivo), sans-serif; padding: 3px 4px; color: var(--color-ink); font-variant-numeric: tabular-nums;'
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

  useEffect(() => {
    if (ready) ws.current?.setOptions(WAVE_COLORS[theme])
  }, [theme, ready])

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
