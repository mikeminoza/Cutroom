'use client'

import type { PoseSuggestion } from '@cutroom/shared/ai'
import type { CharacterPose } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { Eraser, ImagePlus, Layers, Pencil, Plus, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { SyncedInput, SyncedTextarea } from '@/components/project/fields'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import { cutOut } from '@/lib/cutout'
import type { LibraryBackgroundDTO, LibraryCharacterDTO, SeriesDTO, StatusDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useBackgrounds, useLibrary, useSeriesList, useStatus } from '@/lib/hooks'
import { uploadTo } from '@/lib/upload'
import { PoseTouchUp } from './pose-touch-up'
import {
  Button,
  CopyButton,
  Dialog,
  DropZone,
  Field,
  Input,
  Panel,
  Spinner,
  Textarea,
  useConfirm,
} from './ui'

export function LibraryPage() {
  return (
    <div className="mx-auto max-w-[1080px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8">
        <h1 className="display text-[34px]">Library</h1>
        <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
          What you reuse across videos. A series keeps the setup of a run of videos; saved characters can be
          added to any project.
        </p>
      </header>
      <div className="flex flex-col gap-6">
        <SeriesSection />
        <CharactersSection />
        <BackgroundsSection />
      </div>
    </div>
  )
}

function SeriesSection() {
  const { data: series, isLoading } = useSeriesList()
  const client = useQueryClient()
  const router = useRouter()
  const { confirm, element } = useConfirm()
  const [editing, setEditing] = useState<SeriesDTO | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  const newEpisode = async (s: SeriesDTO) => {
    setStarting(s.id)
    try {
      const { id } = await api.post<{ id: string }>('/api/projects', { seriesId: s.id })
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.projects }),
        client.invalidateQueries({ queryKey: keys.series }),
      ])
      router.push(`/projects/${id}?step=brief`)
    } catch (error) {
      toast.error(errorText(error))
      setStarting(null)
    }
  }

  const remove = async (s: SeriesDTO) => {
    const ok = await confirm({
      title: `Delete “${s.name}”?`,
      body: 'Its saved setup and files are deleted. The episodes stay, they just no longer belong to a series.',
      action: 'Delete series',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/api/series/${s.id}`)
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.series }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ])
      toast.success('Series deleted')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <Panel
      title="Series"
      description="Save a video's setup as a series from its ⋯ menu. Every new episode starts with the same brief, look, voice, music, characters and post settings."
    >
      {isLoading ? (
        <div className="m-5 h-24 animate-pulse-soft rounded bg-line/50" />
      ) : !series?.length ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Layers className="size-6 text-ink-3" aria-hidden />
          <p className="max-w-[52ch] text-[14px] text-ink-2">
            No series yet. Open a video you like, then choose “Save as a series…” from its ⋯ menu.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {series.map((s) => {
            const t = s.template
            const facts = [
              t.format === 'portrait' ? 'Shorts' : 'Videos',
              t.artStyle?.split(',')[0],
              t.voice && `${t.voice.provider === 'gemini' ? t.voice.voice : 'ElevenLabs'} voice`,
              t.characters.length && plural(t.characters.length, 'character'),
              t.musicUrl && 'music',
            ].filter(Boolean)
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="wide text-[16px] font-semibold">{s.name}</p>
                  {s.description && <p className="mt-0.5 text-[13.5px] text-ink-2">{s.description}</p>}
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {plural(s.episodes, 'episode')} · {facts.join(' · ')}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="go"
                    size="sm"
                    busy={starting === s.id}
                    onClick={() => newEpisode(s)}
                    icon={<Plus className="size-3.5" />}
                  >
                    New episode
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Rename ${s.name}`}
                    onClick={() => setEditing(s)}
                    icon={<Pencil className="size-3.5" />}
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={`Delete ${s.name}`}
                    onClick={() => remove(s)}
                    icon={<Trash2 className="size-3.5" />}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <RenameSeriesDialog series={editing} onClose={() => setEditing(null)} />
      {element}
    </Panel>
  )
}

function RenameSeriesDialog({ series, onClose }: { series: SeriesDTO | null; onClose: () => void }) {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<string | null>(null)
  if (series && loaded !== series.id) {
    setLoaded(series.id)
    setName(series.name)
    setDescription(series.description)
  }
  const save = async () => {
    if (!series) return
    setBusy(true)
    try {
      await api.patch(`/api/series/${series.id}`, { name, description })
      await client.invalidateQueries({ queryKey: keys.series })
      onClose()
      setLoaded(null)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={Boolean(series)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
          setLoaded(null)
        }
      }}
      title="Rename series"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="go" busy={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="What the series is about">
          <Textarea
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20"
          />
        </Field>
      </div>
    </Dialog>
  )
}

function CharactersSection() {
  const client = useQueryClient()
  const { data: characters, isLoading } = useLibrary()
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    try {
      const character = await api.post<LibraryCharacterDTO>('/api/library/characters', {
        name: '',
        description: '',
      })
      client.setQueryData<LibraryCharacterDTO[]>(keys.library, (prev) => [character, ...(prev ?? [])])
      setFresh(character.id)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Panel
      title="Characters"
      description="Your recurring characters, such as the narrator of your channel. Create one here or save one from a project. Adding one to a project gives that project its own copy."
      actions={
        <Button
          variant="plain"
          size="sm"
          busy={creating}
          onClick={create}
          icon={<Plus className="size-3.5" />}
        >
          New character
        </Button>
      }
    >
      {isLoading ? (
        <div className="m-5 h-24 animate-pulse-soft rounded bg-line/50" />
      ) : !characters?.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <UserRound className="size-6 text-ink-3" aria-hidden />
          <p className="max-w-[56ch] text-[14px] text-ink-2">
            No characters yet. Create your channel's main character: a name, how they look, and one or more
            reference images. Then pick them in Settings → Channel niche.
          </p>
          <Button variant="go" busy={creating} onClick={create} icon={<Plus className="size-4" />}>
            New character
          </Button>
        </div>
      ) : (
        <ul className="grid gap-px bg-line md:grid-cols-2">
          {characters.map((c) => (
            <LibraryCharacterCard key={c.id} character={c} autoFocus={c.id === fresh} />
          ))}
          {characters.length % 2 === 1 && <li aria-hidden className="hidden bg-panel md:block" />}
        </ul>
      )}
    </Panel>
  )
}

const MAX_IMAGES = 6

function LibraryCharacterCard({
  character,
  autoFocus,
}: {
  character: LibraryCharacterDTO
  autoFocus?: boolean
}) {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const { confirm, element } = useConfirm()
  const [timer] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())
  const [uploading, setUploading] = useState(0)

  const replace = (fields: Partial<LibraryCharacterDTO>) =>
    client.setQueryData<LibraryCharacterDTO[]>(keys.library, (prev) =>
      prev?.map((c) => (c.id === character.id ? { ...c, ...fields } : c)),
    )
  // The latest images, so two quick changes in a row don't undo each other.
  const currentImages = () =>
    client.getQueryData<LibraryCharacterDTO[]>(keys.library)?.find((c) => c.id === character.id)?.images ??
    character.images

  const patch = (fields: Partial<Pick<LibraryCharacterDTO, 'name' | 'description'>>) => {
    replace(fields)
    const key = Object.keys(fields).join(',')
    clearTimeout(timer.get(key))
    timer.set(
      key,
      setTimeout(async () => {
        try {
          await api.patch(`/api/library/characters/${character.id}`, fields)
        } catch (error) {
          toast.error(errorText(error))
        }
      }, 700),
    )
  }

  const saveImages = async (images: LibraryCharacterDTO['images']) => {
    replace({ images })
    try {
      const saved = await api.patch<LibraryCharacterDTO>(`/api/library/characters/${character.id}`, {
        images,
      })
      replace({ images: saved.images })
    } catch (error) {
      toast.error(errorText(error))
      void client.invalidateQueries({ queryKey: keys.library })
    }
  }

  const addImages = async (files: File[]) => {
    const room = MAX_IMAGES - currentImages().length
    if (room <= 0) {
      toast.error(`A character can have up to ${MAX_IMAGES} reference images.`)
      return
    }
    setUploading(Math.min(room, files.length))
    try {
      const driver = status?.storage ?? (await api.get<StatusDTO>('/api/status')).storage
      const uploaded = await Promise.all(
        files.slice(0, room).map((file) => uploadTo(file, `library/characters/${character.id}`, driver)),
      )
      await saveImages([...currentImages(), ...uploaded])
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setUploading(0)
    }
  }

  const removeImage = (url: string) => saveImages(currentImages().filter((i) => i.url !== url))

  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${character.name || 'this character'} from the library?`,
      body: 'Projects that already use them keep their own copy.',
      action: 'Remove',
      danger: true,
    })
    if (!ok) return
    client.setQueryData<LibraryCharacterDTO[]>(keys.library, (prev) =>
      prev?.filter((c) => c.id !== character.id),
    )
    try {
      await api.del(`/api/library/characters/${character.id}`)
    } catch (error) {
      toast.error(errorText(error))
      void client.invalidateQueries({ queryKey: keys.library })
    }
  }

  return (
    <li className="flex flex-col gap-3 bg-panel px-5 py-5">
      <DropZone accept="image/*" multiple onFiles={addImages} className="rounded-[var(--radius-control)]">
        {({ open, dragging }) => (
          <div className="flex flex-wrap gap-2">
            {character.images.map((image) => (
              <div
                key={image.url}
                className="group relative size-20 overflow-hidden rounded-[var(--radius-control)] bg-sunk"
              >
                {/* biome-ignore lint/performance/noImgElement: user uploads */}
                <img
                  src={image.url}
                  alt={`${character.name || 'Character'} reference`}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(image.url)}
                  aria-label="Remove image"
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-film/80 text-film-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div
                key={`u${i}`}
                className="grid size-20 place-items-center rounded-[var(--radius-control)] bg-sunk"
              >
                <Spinner className="text-ink-3" />
              </div>
            ))}
            {character.images.length + uploading < MAX_IMAGES && (
              <button
                type="button"
                onClick={open}
                className={cn(
                  'flex size-20 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed text-[12px] transition-colors',
                  dragging
                    ? 'border-ink bg-kodak-wash text-ink'
                    : 'border-line-strong text-ink-2 hover:border-ink hover:text-ink',
                )}
              >
                <ImagePlus className="size-5" aria-hidden />
                {character.images.length === 0 ? 'Add image' : 'Add another'}
              </button>
            )}
          </div>
        )}
      </DropZone>
      <Field label="Name" hint="Scenes and scripts use this exact name.">
        <SyncedInput
          value={character.name}
          maxLength={100}
          onValue={(name) => patch({ name })}
          placeholder="Cappy"
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Description" hint="How they look: species, shape, colors, clothes. Be specific.">
        <SyncedTextarea
          value={character.description}
          maxLength={2000}
          onValue={(description) => patch({ description })}
          placeholder="Chubby brown 2D cartoon capybara, round body, tiny ears, sleepy half-closed eyes, a small orange on its head"
          className="min-h-20"
        />
      </Field>
      <PosesEditor character={character} />
      <div>
        <Button variant="danger" size="sm" onClick={remove} icon={<Trash2 className="size-3.5" />}>
          Remove
        </Button>
      </div>
      {element}
    </li>
  )
}

/** A light checkerboard behind cut-outs, so their transparent parts show. */
const CHECKER =
  'bg-sunk [background-image:conic-gradient(var(--color-line)_25%,transparent_0_50%,var(--color-line)_0_75%,transparent_0)] [background-size:14px_14px]'

const fileName = (file: File) =>
  file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 60)

/**
 * A character's poses: cut-outs with transparent backgrounds (PNG or WebP), each named (happy,
 * hungry…). Layered scenes put them in front of a background; an eyes-closed version makes the
 * character blink in the video.
 */
function PosesEditor({ character }: { character: LibraryCharacterDTO }) {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const [uploading, setUploading] = useState(0)
  const [timer] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())
  const [suggestions, setSuggestions] = useState<PoseSuggestion[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [touching, setTouching] = useState<CharacterPose | null>(null)
  const folder = `library/characters/${character.id}`
  const latest = () =>
    client.getQueryData<LibraryCharacterDTO[]>(keys.library)?.find((c) => c.id === character.id)?.poses ??
    character.poses

  const show = (poses: CharacterPose[]) =>
    client.setQueryData<LibraryCharacterDTO[]>(keys.library, (prev) =>
      prev?.map((c) => (c.id === character.id ? { ...c, poses } : c)),
    )
  const save = async (poses: CharacterPose[]) => {
    const before = latest()
    show(poses)
    try {
      await api.patch(`/api/library/characters/${character.id}`, { poses })
    } catch (error) {
      toast.error(errorText(error))
      show(before)
    }
  }
  const driver = async () => status?.storage ?? (await api.get<StatusDTO>('/api/status')).storage

  const addPoses = async (files: File[]) => {
    setUploading(files.length)
    try {
      const where = await driver()
      const added = await Promise.all(
        files.map(async (file) => {
          // A plain background is removed and empty margins trimmed, in the browser.
          const stored = await uploadTo(await cutOut(file), folder, where)
          return {
            id: crypto.randomUUID(),
            name: fileName(file) || 'Pose',
            url: stored.url,
            key: stored.key,
            blinkUrl: null,
            blinkKey: null,
          }
        }),
      )
      await save([...latest(), ...added])
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setUploading(0)
    }
  }

  const addBlink = async (poseId: string, file: File) => {
    try {
      const stored = await uploadTo(await cutOut(file), folder, await driver())
      await save(
        latest().map((p) => (p.id === poseId ? { ...p, blinkUrl: stored.url, blinkKey: stored.key } : p)),
      )
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const rename = (poseId: string, name: string) => {
    const next = latest().map((p) => (p.id === poseId ? { ...p, name } : p))
    show(next)
    clearTimeout(timer.get(poseId))
    timer.set(
      poseId,
      setTimeout(() => void save(latest()), 700),
    )
  }

  /** A touched-up pose replaces its pictures in place; the scenes using it follow. */
  const saveTouchUp = async (poseId: string, files: { pose: File; blink: File | null }) => {
    const where = await driver()
    const [picture, blink] = await Promise.all([
      uploadTo(files.pose, folder, where),
      files.blink ? uploadTo(files.blink, folder, where) : null,
    ])
    await save(
      latest().map((p) =>
        p.id === poseId
          ? {
              ...p,
              url: picture.url,
              key: picture.key,
              ...(blink ? { blinkUrl: blink.url, blinkKey: blink.key } : {}),
            }
          : p,
      ),
    )
    toast.success('Pose touched up', { description: 'Scenes using it show the new picture.' })
  }

  const suggest = async () => {
    setAsking(true)
    try {
      const { suggestions: next } = await api.post<{ suggestions: PoseSuggestion[] }>(
        `/api/library/characters/${character.id}/suggest-poses`,
      )
      setSuggestions(next)
      if (next.length === 0) toast('No missing poses found', { description: 'The scripts are covered.' })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setAsking(false)
    }
  }

  return (
    <Field
      label="Poses"
      hint="Pictures of the character on a plain background (the background is removed for you) or with a transparent one. Scenes put them in front of a background; add an eyes-closed version and the character blinks."
      aside={
        status?.gemini.configured ? (
          <Button
            variant="ghost"
            size="sm"
            busy={asking}
            onClick={suggest}
            icon={<Sparkles className="size-3.5" />}
          >
            What poses do I need?
          </Button>
        ) : undefined
      }
    >
      {touching && (
        <PoseTouchUp
          pose={touching}
          onClose={() => setTouching(null)}
          onSave={(files) => saveTouchUp(touching.id, files)}
        />
      )}
      {suggestions && suggestions.length > 0 && (
        <PoseSuggestions
          name={character.name}
          suggestions={suggestions}
          onClose={() => setSuggestions(null)}
        />
      )}
      <DropZone
        accept="image/png,image/webp,image/jpeg"
        multiple
        onFiles={addPoses}
        className="rounded-[var(--radius-control)]"
      >
        {({ open, dragging }) => (
          <div className="flex flex-wrap gap-2">
            {character.poses.map((pose) => (
              <div key={pose.id} className="flex w-28 flex-col gap-1">
                <div
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-[var(--radius-control)]',
                    CHECKER,
                  )}
                >
                  {/* biome-ignore lint/performance/noImgElement: user uploads */}
                  <img src={pose.url} alt={pose.name} className="size-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setTouching(pose)}
                    aria-label={`Touch up ${pose.name || 'pose'}`}
                    title="Touch up: clear leftover background"
                    className="absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-film/80 text-film-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <Eraser className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(latest().filter((p) => p.id !== pose.id))}
                    aria-label={`Remove ${pose.name || 'pose'}`}
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-film/80 text-film-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <Input
                  value={pose.name}
                  maxLength={60}
                  onChange={(e) => rename(pose.id, e.target.value)}
                  aria-label="Pose name"
                  className="h-8 px-2 text-[12.5px]"
                />
                {pose.blinkUrl ? (
                  <span className="text-[11.5px] text-ok">Blinks</span>
                ) : (
                  <DropZone
                    accept="image/png,image/webp,image/jpeg"
                    onFiles={([file]) => file && void addBlink(pose.id, file)}
                  >
                    {({ open: pick }) => (
                      <button
                        type="button"
                        onClick={pick}
                        className="text-left text-[11.5px] text-ink-3 hover:text-ink"
                      >
                        + Eyes closed
                      </button>
                    )}
                  </DropZone>
                )}
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div
                key={`u${i}`}
                className="grid size-28 place-items-center rounded-[var(--radius-control)] bg-sunk"
              >
                <Spinner className="text-ink-3" />
              </div>
            ))}
            <button
              type="button"
              onClick={open}
              className={cn(
                'flex size-28 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed text-[12px] transition-colors',
                dragging
                  ? 'border-ink bg-kodak-wash text-ink'
                  : 'border-line-strong text-ink-2 hover:border-ink hover:text-ink',
              )}
            >
              <ImagePlus className="size-5" aria-hidden />
              Add poses
            </button>
          </div>
        )}
      </DropZone>
    </Field>
  )
}

/**
 * The poses the scripts call for that the character doesn't have yet, each with a prompt to make
 * it in any image tool, on a plain background so it cuts out cleanly.
 */
function PoseSuggestions({
  name,
  suggestions,
  onClose,
}: {
  name: string
  suggestions: PoseSuggestion[]
  onClose: () => void
}) {
  return (
    <div className="mb-3 rounded-[var(--radius-control)] border border-line bg-sunk">
      <div className="flex items-start justify-between gap-3 border-b border-line px-3 py-2.5">
        <p className="text-[13px] leading-snug text-ink-2">
          Poses your scripts need. Make each one from its prompt in your image tool (attach{' '}
          {name || 'the character'}’s reference picture), then add it here with that name.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton
            text={suggestions.map((s) => `${s.name}\n${s.prompt}`).join('\n\n')}
            label="Copy all"
            done="Copied"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the suggestions"
            className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-panel hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <ol className="divide-y divide-line">
        {suggestions.map((s) => (
          <li key={s.name} className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13.5px] font-semibold">{s.name}</p>
              <CopyButton text={s.prompt} label="Copy prompt" />
            </div>
            <p className="text-[12.5px] text-ink-3">{s.why}</p>
            <p className="text-[13px] leading-relaxed">{s.prompt}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Backgrounds shared by every video: scenes and thumbnails put characters in front of them. */
function BackgroundsSection() {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const { data: backgrounds, isLoading } = useBackgrounds()
  const { confirm, element } = useConfirm()
  const [uploading, setUploading] = useState(0)
  const [timer] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())

  const add = async (files: File[]) => {
    setUploading(files.length)
    try {
      const driver = status?.storage ?? (await api.get<StatusDTO>('/api/status')).storage
      for (const file of files) {
        const id = crypto.randomUUID()
        const stored = await uploadTo(file, `library/backgrounds/${id}`, driver)
        const row = await api.post<LibraryBackgroundDTO>('/api/library/backgrounds', {
          id,
          name: fileName(file),
          url: stored.url,
          key: stored.key,
        })
        client.setQueryData<LibraryBackgroundDTO[]>(keys.backgrounds, (prev) => [...(prev ?? []), row])
        setUploading((n) => Math.max(0, n - 1))
      }
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setUploading(0)
    }
  }

  const rename = (id: string, name: string) => {
    client.setQueryData<LibraryBackgroundDTO[]>(keys.backgrounds, (prev) =>
      prev?.map((b) => (b.id === id ? { ...b, name } : b)),
    )
    clearTimeout(timer.get(id))
    timer.set(
      id,
      setTimeout(async () => {
        try {
          await api.patch(`/api/library/backgrounds/${id}`, { name })
        } catch (error) {
          toast.error(errorText(error))
        }
      }, 700),
    )
  }

  const remove = async (background: LibraryBackgroundDTO) => {
    const ok = await confirm({
      title: `Delete ${background.name || 'this background'}?`,
      body: 'Videos already posted are not affected.',
      action: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/api/library/backgrounds/${background.id}`)
      client.setQueryData<LibraryBackgroundDTO[]>(keys.backgrounds, (prev) =>
        prev?.filter((b) => b.id !== background.id),
      )
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <Panel
      title="Backgrounds"
      description="Places your characters appear in (kitchen, garden, bedroom…). A scene can be a background with a character's pose in front, picked by you or by the AI."
    >
      <DropZone accept="image/*" multiple onFiles={add} className="rounded-b-[var(--radius-panel)]">
        {({ open, dragging }) => (
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading && (
              <div className="aspect-video animate-pulse-soft rounded-[var(--radius-control)] bg-line/50" />
            )}
            {backgrounds?.map((background) => (
              <div key={background.id} className="flex flex-col gap-1.5">
                <div className="group relative aspect-video overflow-hidden rounded-[var(--radius-control)] bg-sunk">
                  {/* biome-ignore lint/performance/noImgElement: user uploads */}
                  <img src={background.url} alt={background.name} className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => void remove(background)}
                    aria-label={`Delete ${background.name || 'background'}`}
                    className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-film/80 text-film-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <Input
                  value={background.name}
                  maxLength={100}
                  onChange={(e) => rename(background.id, e.target.value)}
                  aria-label="Background name"
                  placeholder="Kitchen"
                  className="h-8 px-2 text-[13px]"
                />
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div
                key={`u${i}`}
                className="grid aspect-video place-items-center rounded-[var(--radius-control)] bg-sunk"
              >
                <Spinner className="text-ink-3" />
              </div>
            ))}
            <button
              type="button"
              onClick={open}
              className={cn(
                'flex aspect-video flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-dashed text-[13px] transition-colors',
                dragging
                  ? 'border-ink bg-kodak-wash text-ink'
                  : 'border-line-strong text-ink-2 hover:border-ink hover:text-ink',
              )}
            >
              <ImagePlus className="size-5" aria-hidden />
              Add backgrounds
            </button>
          </div>
        )}
      </DropZone>
      {element}
    </Panel>
  )
}
