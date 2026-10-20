'use client'

import { SHORT_MAX_SECONDS, sceneRange, totalDuration } from '@cutroom/shared/timing'
import type { ImageFit } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, Field, Input, Segmented, Select, Textarea } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cutAudio } from '@/lib/audio'
import type { ProjectFull, SeriesDTO } from '@/lib/dto'
import { formatLength } from '@/lib/format'
import { keys, useSaver, useStatus } from '@/lib/hooks'
import { uploadFile } from '@/lib/upload'

/** Cuts a 9:16 Short out of this video: a run of its scenes, their images and that stretch of audio. */
export function ShortDialog({
  data,
  open,
  onOpenChange,
}: {
  data: ProjectFull
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { project, scenes } = data
  const router = useRouter()
  const client = useQueryClient()
  const { saver } = useSaver(project.id)
  const { data: status } = useStatus()
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [fit, setFit] = useState<ImageFit>('cover')
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const duration = project.voiceoverDuration ?? totalDuration(scenes)
  // Scenes can be deleted elsewhere while the dialog is open: keep the picks in range.
  const last = Math.max(0, scenes.length - 1)
  const first = Math.min(from, last)
  const final = Math.min(Math.max(to, first), last)
  const range = scenes.length ? sceneRange(scenes, first, final, duration) : { start: 0, end: 0 }
  const length = range.end - range.start

  // Open on the first minute of the video. Set up when the dialog opens, and only then: the
  // project is refetched every few seconds while a job runs, which must not undo the choices.
  const wasOpen = useRef(false)
  useEffect(() => {
    const opening = open && !wasOpen.current
    wasOpen.current = open
    if (!opening) return
    let end = 0
    while (end < scenes.length - 1 && sceneRange(scenes, 0, end + 1, duration).end <= 60) end++
    setFrom(0)
    setTo(end)
    setTitle(`${project.title || 'Untitled video'} (Short)`)
    setReason(null)
  }, [open, scenes, duration, project.title])

  const pick = async () => {
    if (busy !== null) return
    setBusy('pick')
    try {
      await saver.flushAll()
      const result = await api.post<{ startIndex: number; endIndex: number; title: string; reason: string }>(
        `/api/projects/${project.id}/ai/short`,
        { maxSeconds: 60 },
      )
      setFrom(result.startIndex)
      setTo(result.endIndex)
      if (result.title) setTitle(result.title)
      setReason(result.reason)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    // Busy before the first await, so a second click can't start a second Short.
    if (busy !== null) return
    setBusy('Getting ready…')
    const newId = crypto.randomUUID()
    try {
      await saver.flushAll()
      let voiceover: { url: string; name: string; duration: number } | null = null
      if (project.voiceoverUrl) {
        setBusy('Cutting the voice-over…')
        const file = await cutAudio(
          project.voiceoverUrl,
          range.start,
          range.end,
          duration,
          'short-voiceover.wav',
        )
        setBusy('Uploading the voice-over…')
        const driver = status?.storage ?? 'local'
        const stored = await uploadFile(file, newId, 'voiceover', driver)
        voiceover = { url: stored.url, name: file.name, duration: length }
      }
      setBusy('Making the Short…')
      const { id } = await api.post<{ id: string }>(`/api/projects/${project.id}/short`, {
        newId,
        from: first,
        to: final,
        fit,
        title,
        voiceover,
      })
      await client.invalidateQueries({ queryKey: keys.projects })
      toast.success('Short created', {
        description: 'Check the framing on the Images step, then publish it.',
      })
      onOpenChange(false)
      router.push(`/projects/${id}?step=preview`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const options = scenes.map((s, i) => ({
    value: String(i),
    label: `${i + 1}. ${s.narration.slice(0, 60) || 'Scene without narration'}${s.narration.length > 60 ? '…' : ''}`,
  }))
  const tooLong = length > SHORT_MAX_SECONDS
  const working = busy !== null && busy !== 'pick'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !working && onOpenChange(next)}
      title="Make a Short"
      width="max-w-xl"
      description="A new 9:16 project with a run of this video's scenes, their pictures and that part of the voice-over. This video stays as it is."
      footer={
        <>
          <Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="go"
            busy={working}
            disabled={tooLong || length <= 0.5 || busy !== null}
            onClick={create}
          >
            {working ? busy : 'Make the Short'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {status?.gemini.configured && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-sunk px-3 py-2.5">
            <p className="flex-1 text-[13px] text-ink-2">
              {reason ?? 'Gemini can find the part that works best on its own.'}
            </p>
            <Button
              variant="plain"
              size="sm"
              busy={busy === 'pick'}
              disabled={busy !== null}
              onClick={pick}
              icon={<Sparkles className="size-3.5" />}
            >
              Pick the best part
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From scene">
            <Select
              value={String(first)}
              onChange={(e) => {
                const next = Number(e.target.value)
                setFrom(next)
                if (final < next) setTo(next)
              }}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To scene">
            <Select value={String(final)} onChange={(e) => setTo(Math.max(first, Number(e.target.value)))}>
              {options.slice(first).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className={tooLong ? 'text-[13px] text-bad' : 'text-[13px] text-ink-2'}>
          {formatLength(length)} long
          {tooLong
            ? ` — Shorts can be at most ${SHORT_MAX_SECONDS / 60} minutes.`
            : length > 60
              ? '. Most Shorts are under a minute.'
              : '.'}
        </p>
        <Field label="Pictures">
          <Segmented
            ariaLabel="Picture fit"
            value={fit}
            onChange={setFit}
            options={[
              { value: 'cover', label: 'Crop to fill', hint: 'Fills the tall frame around each focus point' },
              { value: 'contain', label: 'Fit on blur', hint: 'Shows each whole picture on a blurred copy' },
            ]}
            className="w-full"
          />
        </Field>
        <Field label="Title">
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

/** Saves this video's setup (brief, look, voice, music, characters, post settings) as a series. */
export function SeriesDialog({
  data,
  series,
  open,
  onOpenChange,
}: {
  data: ProjectFull
  series: SeriesDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { project } = data
  const client = useQueryClient()
  const { saver } = useSaver(project.id)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  // Filled in when the dialog opens, not on every refetch while you type.
  const wasOpen = useRef(false)
  useEffect(() => {
    const opening = open && !wasOpen.current
    wasOpen.current = open
    if (!opening) return
    setName(series?.name ?? '')
    setDescription(series?.description ?? '')
  }, [open, series])

  const save = async () => {
    setBusy(true)
    try {
      await saver.flushAll()
      if (series) {
        await api.patch(`/api/series/${series.id}`, { name, description, fromProjectId: project.id })
        toast.success(`${name} now starts from this video's setup`)
      } else {
        await api.post('/api/series', { projectId: project.id, name, description })
        toast.success(`Series “${name}” saved`, {
          description: 'Start new episodes from it on the Projects page.',
        })
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.series }),
        client.invalidateQueries({ queryKey: keys.project(project.id) }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={series ? `Update “${series.name}”` : 'Save as a series'}
      description={
        series
          ? 'New episodes will start from this video’s current setup: brief, look, voice, music, characters and post settings.'
          : 'New episodes start with this video’s brief, look, voice, music, characters and post settings. Scripts and scenes are not copied.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="go" busy={busy} disabled={!name.trim()} onClick={save}>
            {series ? 'Update series' : 'Save series'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ocean Oddities"
            autoFocus
          />
        </Field>
        <Field
          label="What the series is about"
          hint="Gemini reads this when it suggests ideas for the series."
        >
          <Textarea
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20"
            placeholder="Weird and wonderful sea creatures, one per episode"
          />
        </Field>
      </div>
    </Dialog>
  )
}
