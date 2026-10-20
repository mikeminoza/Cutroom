'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Layers, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { SyncedInput, SyncedTextarea } from '@/components/project/fields'
import { api, errorText } from '@/lib/api'
import type { LibraryCharacterDTO, SeriesDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useLibrary, useSeriesList } from '@/lib/hooks'
import { Button, Dialog, Field, Input, Panel, Textarea, useConfirm } from './ui'

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
  const { data: characters, isLoading } = useLibrary()
  return (
    <Panel
      title="Characters"
      description="Save a character from a project's Characters step. Adding one to a project gives that project its own copy."
    >
      {isLoading ? (
        <div className="m-5 h-24 animate-pulse-soft rounded bg-line/50" />
      ) : !characters?.length ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <UserRound className="size-6 text-ink-3" aria-hidden />
          <p className="max-w-[52ch] text-[14px] text-ink-2">
            No saved characters yet. Use “Save to library” on a character in any project.
          </p>
        </div>
      ) : (
        <ul className="grid gap-px bg-line md:grid-cols-2">
          {characters.map((c) => (
            <LibraryCharacterCard key={c.id} character={c} />
          ))}
          {characters.length % 2 === 1 && <li aria-hidden className="hidden bg-panel md:block" />}
        </ul>
      )}
    </Panel>
  )
}

function LibraryCharacterCard({ character }: { character: LibraryCharacterDTO }) {
  const client = useQueryClient()
  const { confirm, element } = useConfirm()
  const [timer] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())

  const patch = (fields: Partial<Pick<LibraryCharacterDTO, 'name' | 'description'>>) => {
    client.setQueryData<LibraryCharacterDTO[]>(keys.library, (prev) =>
      prev?.map((c) => (c.id === character.id ? { ...c, ...fields } : c)),
    )
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
      <div className="flex flex-wrap gap-2">
        {character.images.length === 0 && (
          <div className="grid size-20 place-items-center rounded-[var(--radius-control)] bg-sunk text-[12px] text-ink-3">
            No image
          </div>
        )}
        {character.images.map((image) => (
          // biome-ignore lint/performance/noImgElement: user uploads
          <img
            key={image.url}
            src={image.url}
            alt={`${character.name || 'Character'} reference`}
            className="size-20 rounded-[var(--radius-control)] object-cover"
          />
        ))}
      </div>
      <Field label="Name">
        <SyncedInput value={character.name} maxLength={100} onValue={(name) => patch({ name })} />
      </Field>
      <Field label="Description">
        <SyncedTextarea
          value={character.description}
          maxLength={2000}
          onValue={(description) => patch({ description })}
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
