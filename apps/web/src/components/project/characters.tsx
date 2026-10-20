'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookmarkPlus, ImagePlus, Library, Plus, Trash2, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, DropZone, Field, Menu, Panel, Spinner, useConfirm } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import type { CharacterDTO, ProjectFull } from '@/lib/dto'
import { keys, useLibrary } from '@/lib/hooks'
import { SyncedInput, SyncedTextarea, useUploader } from './fields'
import type { StepProps } from './workspace'

export function CharactersStep({ data, goTo }: StepProps) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)
  const projectId = data.project.id
  const library = useLibrary()

  const add = async (libraryId?: string) => {
    setAdding(true)
    try {
      const character = await api.post<CharacterDTO>(
        `/api/projects/${projectId}/characters`,
        libraryId ? { libraryId } : {},
      )
      client.setQueryData<ProjectFull>(keys.project(projectId), (prev) =>
        prev ? { ...prev, characters: [...prev.characters, character] } : prev,
      )
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Characters"
        description="Recurring people, mascots or avatars. Their description goes into every scene prompt that features them, and their reference images go with it (attached for you when Gemini makes the pictures). That is what keeps them looking the same from scene to scene."
        actions={
          <>
            {(library.data?.length ?? 0) > 0 && (
              <Menu
                trigger={
                  <Button variant="ghost" busy={adding} icon={<Library className="size-4" />}>
                    Add from library
                  </Button>
                }
                items={(library.data ?? []).map((c) => ({
                  label: c.name || 'Unnamed character',
                  onSelect: () => void add(c.id),
                }))}
              />
            )}
            <Button variant="plain" busy={adding} onClick={() => add()} icon={<Plus className="size-4" />}>
              Add character
            </Button>
          </>
        }
      >
        {data.characters.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <UserRound className="size-7 text-ink-3" aria-hidden />
            <p className="max-w-[52ch] text-[14px] text-ink-2">
              No characters yet. Skip this step if your video has no recurring character.
            </p>
            <Button variant="go" busy={adding} onClick={() => add()} icon={<Plus className="size-4" />}>
              Add a character
            </Button>
          </div>
        ) : (
          <ul className="grid gap-px bg-line md:grid-cols-2">
            {data.characters.map((character) => (
              <CharacterCard key={character.id} character={character} projectId={projectId} />
            ))}
            {data.characters.length % 2 === 1 && <li aria-hidden className="hidden bg-panel md:block" />}
          </ul>
        )}
      </Panel>
      <div className="flex justify-end">
        <Button variant="plain" onClick={() => goTo('script')} icon={<ArrowRight className="size-4" />}>
          Script
        </Button>
      </div>
    </div>
  )
}

function CharacterCard({ character, projectId }: { character: CharacterDTO; projectId: string }) {
  const client = useQueryClient()
  const upload = useUploader(projectId)
  const [uploading, setUploading] = useState(0)
  const { confirm, element } = useConfirm()

  const replaceInCache = (next: CharacterDTO) =>
    client.setQueryData<ProjectFull>(keys.project(projectId), (prev) =>
      prev ? { ...prev, characters: prev.characters.map((c) => (c.id === next.id ? next : c)) } : prev,
    )

  const timers = useState(() => new Map<string, ReturnType<typeof setTimeout>>())[0]
  const patch = (fields: Partial<CharacterDTO>, delay = 700) => {
    replaceInCache({ ...character, ...fields })
    const key = Object.keys(fields).join(',')
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(async () => {
        try {
          await api.patch<CharacterDTO>(`/api/characters/${character.id}`, fields)
        } catch (error) {
          toast.error(errorText(error))
        }
      }, delay),
    )
  }

  const addImages = async (files: File[]) => {
    const room = 6 - character.images.length
    if (room <= 0) {
      toast.error('A character can have up to 6 reference images.')
      return
    }
    setUploading(Math.min(room, files.length))
    try {
      const uploaded = await Promise.all(files.slice(0, room).map((file) => upload(file, 'characters')))
      const images = [...character.images, ...uploaded]
      const saved = await api.patch<CharacterDTO>(`/api/characters/${character.id}`, { images })
      replaceInCache(saved)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setUploading(0)
    }
  }

  const removeImage = async (url: string) => {
    const images = character.images.filter((i) => i.url !== url)
    replaceInCache({ ...character, images })
    try {
      await api.patch(`/api/characters/${character.id}`, { images })
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const [saving, setSaving] = useState(false)
  const saveToLibrary = async () => {
    setSaving(true)
    try {
      await api.post('/api/library/characters', {
        characterId: character.id,
        name: character.name,
        description: character.description,
      })
      await client.invalidateQueries({ queryKey: keys.library })
      toast.success(`${character.name || 'Character'} saved to the library`, {
        description: 'Add it to any project from the Characters step.',
      })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${character.name || 'this character'}?`,
      body: 'Their reference images are deleted. Scenes that mention them keep the name in their text.',
      action: 'Remove character',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/api/characters/${character.id}`)
      client.setQueryData<ProjectFull>(keys.project(projectId), (prev) =>
        prev ? { ...prev, characters: prev.characters.filter((c) => c.id !== character.id) } : prev,
      )
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <li className="flex flex-col gap-4 bg-panel px-5 py-5">
      <DropZone accept="image/*" multiple onFiles={addImages} className="rounded-[var(--radius-control)]">
        {({ open, dragging }) => (
          <div className="flex flex-wrap gap-2">
            {character.images.map((image) => (
              <div
                key={image.url}
                className="group relative size-24 overflow-hidden rounded-[var(--radius-control)] bg-sunk"
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
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-ink/80 text-paper opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div
                key={`u${i}`}
                className="grid size-24 place-items-center rounded-[var(--radius-control)] bg-sunk"
              >
                <Spinner className="text-ink-3" />
              </div>
            ))}
            {character.images.length + uploading < 6 && (
              <button
                type="button"
                onClick={open}
                className={`flex size-24 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed text-[12px] transition-colors ${dragging ? 'border-ink bg-kodak-wash text-ink' : 'border-line-strong text-ink-2 hover:border-ink hover:text-ink'}`}
              >
                <ImagePlus className="size-5" aria-hidden />
                {character.images.length === 0 ? 'Add avatar' : 'Add another'}
              </button>
            )}
          </div>
        )}
      </DropZone>
      <Field label="Name" hint="Use this exact name in scenes.">
        <SyncedInput value={character.name} onValue={(name) => patch({ name })} placeholder="Milo" />
      </Field>
      <Field label="Description" hint="Appearance only: face, hair, age, clothes, colors. Be specific.">
        <SyncedTextarea
          value={character.description}
          onValue={(description) => patch({ description })}
          placeholder="Friendly 30-year-old man, short curly black hair, round glasses, mustard-yellow hoodie"
          className="min-h-20"
        />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          busy={saving}
          disabled={!character.name.trim()}
          onClick={saveToLibrary}
          icon={<BookmarkPlus className="size-3.5" />}
        >
          Save to library
        </Button>
        <Button variant="danger" size="sm" onClick={remove} icon={<Trash2 className="size-3.5" />}>
          Remove
        </Button>
      </div>
      {element}
    </li>
  )
}
