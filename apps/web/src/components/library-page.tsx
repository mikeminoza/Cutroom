'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Layers, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { SyncedInput, SyncedTextarea } from '@/components/project/fields'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { LibraryCharacterDTO, SeriesDTO, StatusDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useLibrary, useSeriesList, useStatus } from '@/lib/hooks'
import { uploadTo } from '@/lib/upload'
import { Button, Dialog, DropZone, Field, Input, Panel, Spinner, Textarea, useConfirm } from './ui'

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
      <div>
        <Button variant="danger" size="sm" onClick={remove} icon={<Trash2 className="size-3.5" />}>
          Remove
        </Button>
      </div>
      {element}
    </li>
  )
}
