'use client'

import { buildImagePrompt, sceneCharacters } from '@cutroom/shared/prompts'
import { formatTimecode } from '@cutroom/shared/timing'
import { MOTIONS, type Motion, normalizeTransition, outputSize, TRANSITIONS } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Download,
  ImagePlus,
  Images,
  Replace,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Button,
  CopyButton,
  DropZone,
  Kbd,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  Spinner,
  Switch,
  Tip,
  useConfirm,
  useFilePicker,
} from '@/components/ui'
import { ApiError, api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { CharacterDTO, ProjectFull, SceneDTO } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useSaver, useStatus } from '@/lib/hooks'
import { imageSize, isImage, sceneNumberFromName } from '@/lib/upload'
import { useUploader } from './fields'
import { MOTION_LABEL, TRANSITION_LABEL } from './script'
import type { StepProps } from './workspace'

type Progress = Record<string, number>

/**
 * Image generation in progress. It lives outside the component so it carries on, and stays
 * visible, when you switch to another step and back: no scene is requested (and billed) twice.
 */
const generation = {
  scenes: new Set<string>(),
  batches: new Map<string, { done: number; total: number; stop: boolean }>(),
  version: 0,
  listeners: new Set<() => void>(),
}

function emitGeneration() {
  generation.version++
  for (const listener of generation.listeners) listener()
}

function subscribeGeneration(listener: () => void) {
  generation.listeners.add(listener)
  return () => {
    generation.listeners.delete(listener)
  }
}

/** Re-renders whenever generation starts, finishes or makes progress. */
function useGeneration() {
  return useSyncExternalStore(
    subscribeGeneration,
    () => generation.version,
    () => 0,
  )
}

export function ImagesStep({ data, selectedSceneId, selectScene, goTo }: StepProps) {
  const { project, scenes, characters } = data
  const { saver } = useSaver(project.id)
  const client = useQueryClient()
  const upload = useUploader(project.id)
  const { data: status } = useStatus()
  const { confirm, element: confirmDialog } = useConfirm()
  const [progress, setProgress] = useState<Progress>({})
  const [missingOnly, setMissingOnly] = useState(false)
  useGeneration()
  const generating = generation.scenes
  const batch = generation.batches.get(project.id) ?? null
  const done = scenes.filter((s) => s.imageUrl).length
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const canGenerate = status?.gemini.configured === true

  /** Gemini paints one scene. Returns 'stop' when nothing else will work either (billing, key). */
  const generateOne = useCallback(
    async (scene: SceneDTO): Promise<'ok' | 'failed' | 'stop'> => {
      if (generation.scenes.has(scene.id)) return 'failed'
      generation.scenes.add(scene.id)
      emitGeneration()
      try {
        // Prompt edits are saved with a short delay; make sure Gemini gets the latest one.
        await saver.flushAll()
        const updated = await api.post<SceneDTO | { ok: false }>(`/api/scenes/${scene.id}/image`)
        if ('id' in updated) {
          client.setQueryData<ProjectFull>(keys.project(project.id), (prev) =>
            prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updated.id ? updated : s)) } : prev,
          )
        }
        return 'ok'
      } catch (error) {
        toast.error(`Scene ${scene.index + 1}: ${errorText(error)}`)
        return error instanceof ApiError && [400, 401, 402].includes(error.status) ? 'stop' : 'failed'
      } finally {
        generation.scenes.delete(scene.id)
        emitGeneration()
      }
    },
    [client, project.id, saver],
  )

  const generateScene = async (scene: SceneDTO) => {
    if (
      scene.imageUrl &&
      !(await confirm({
        title: `Replace scene ${scene.index + 1}'s image?`,
        body: 'Gemini makes a new picture from the prompt. The current image is deleted.',
        action: 'Generate new image',
      }))
    ) {
      return
    }
    await generateOne(scene)
  }

  /**
   * Every scene still without an image, two at a time. It keeps going if you open another step
   * (its progress lives outside this component), and only one batch runs per project.
   */
  const generateMissing = async () => {
    if (generation.batches.has(project.id)) return
    const targets = scenesRef.current.filter((s) => !s.imageUrl && !generation.scenes.has(s.id))
    if (targets.length === 0) return
    const run = { done: 0, total: targets.length, stop: false }
    generation.batches.set(project.id, run)
    emitGeneration()
    let next = 0
    let made = 0
    try {
      await Promise.all(
        [0, 1].map(async () => {
          while (next < targets.length && !run.stop) {
            const scene = targets[next++]
            const outcome = await generateOne(scene)
            run.done++
            if (outcome === 'ok') made++
            if (outcome === 'stop') run.stop = true
            emitGeneration()
          }
        }),
      )
    } finally {
      generation.batches.delete(project.id)
      emitGeneration()
    }
    if (made) toast.success(`Generated ${plural(made, 'image')}`)
  }

  const uploadTo = useCallback(
    async (scene: SceneDTO, file: File) => {
      if (!isImage(file)) {
        toast.error(`${file.name} is not an image.`)
        return false
      }
      setProgress((p) => ({ ...p, [scene.id]: 0 }))
      try {
        const size = await imageSize(file)
        const stored = await upload(file, 'scenes', (f) => setProgress((p) => ({ ...p, [scene.id]: f })))
        await saver.scene(
          scene.id,
          { imageUrl: stored.url, imageWidth: size.width, imageHeight: size.height },
          0,
        )
        return true
      } catch (error) {
        toast.error(`Scene ${scene.index + 1}: ${errorText(error)}`)
        return false
      } finally {
        setProgress((p) => {
          const { [scene.id]: _, ...rest } = p
          return rest
        })
      }
    },
    [saver, upload],
  )

  /** One image into one scene, then move on to the next scene still missing its image. */
  const uploadOne = useCallback(
    async (scene: SceneDTO, file: File) => {
      const ok = await uploadTo(scene, file)
      if (!ok) return
      const list = scenesRef.current
      const next =
        list.find((s) => s.index > scene.index && !s.imageUrl) ??
        list.find((s) => !s.imageUrl && s.id !== scene.id)
      if (next) selectScene(next.id)
    },
    [selectScene, uploadTo],
  )

  /** Many images: matched by the number in the file name, the rest fill empty scenes in order. */
  const uploadMany = useCallback(
    async (files: File[]) => {
      const list = scenesRef.current
      const images = files
        .filter(isImage)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      const plan = new Map<string, File>()
      const leftovers: File[] = []
      for (const file of images) {
        const n = sceneNumberFromName(file.name)
        const scene = n ? list[n - 1] : undefined
        if (scene && !plan.has(scene.id)) plan.set(scene.id, file)
        else leftovers.push(file)
      }
      for (const scene of list) {
        if (leftovers.length === 0) break
        if (!scene.imageUrl && !plan.has(scene.id)) plan.set(scene.id, leftovers.shift()!)
      }
      if (plan.size === 0) {
        toast.error('No empty scenes left for these images. Drop an image on a scene to replace it.')
        return
      }
      const entries = [...plan.entries()]
      let placed = 0
      for (let i = 0; i < entries.length; i += 3) {
        const batch = entries.slice(i, i + 3)
        const results = await Promise.all(
          batch.map(([id, file]) => {
            const scene = list.find((s) => s.id === id)!
            return uploadTo(scene, file)
          }),
        )
        placed += results.filter(Boolean).length
      }
      toast.success(`Placed ${plural(placed, 'image')}`, {
        description: leftovers.length
          ? `${plural(leftovers.length, 'file')} had no empty scene to go to.`
          : undefined,
      })
    },
    [uploadTo],
  )

  // Paste anywhere on the page (outside text fields) to fill the selected scene.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const file = Array.from(event.clipboardData?.files ?? []).find(isImage)
      if (!file) return
      const list = scenesRef.current
      const scene = list.find((s) => s.id === selectedSceneId) ?? list.find((s) => !s.imageUrl)
      if (!scene) return
      event.preventDefault()
      void uploadOne(scene, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [selectedSceneId, uploadOne])

  const picker = useFilePicker('image/*', true, uploadMany)
  const downloadPrompts = () => {
    const text = scenes
      .map((scene) => {
        const cast = sceneCharacters(scene, characters)
        return [
          `Scene ${scene.index + 1}  (${formatTimecode(scene.start)} – ${formatTimecode(scene.end)})`,
          cast.length ? `Attach reference images for: ${cast.map((c) => c.name).join(', ')}` : null,
          '',
          buildImagePrompt(scene, { artStyle: project.artStyle, format: project.format, characters }),
        ]
          .filter((line) => line !== null)
          .join('\n')
      })
      .join('\n\n────────────────────────────────────────\n\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project.title || 'video').replace(/[^\w-]+/g, '-').toLowerCase()}-image-prompts.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (scenes.length === 0) {
    return (
      <Panel title="Scene images">
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="max-w-[46ch] text-[14px] text-ink-2">
            Split the script into scenes first. Each scene needs one image.
          </p>
          <Button variant="go" onClick={() => goTo('script')}>
            Go to Script
          </Button>
        </div>
      </Panel>
    )
  }

  const visible = missingOnly ? scenes.filter((s) => !s.imageUrl || progress[s.id] !== undefined) : scenes
  const complete = done === scenes.length

  return (
    <div className="flex flex-col gap-5">
      <DropZone accept="image/*" multiple onFiles={uploadMany} className="rounded-[var(--radius-panel)]">
        {({ dragging }) => (
          <Panel className={cn(dragging && 'border-ink bg-kodak-wash')}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
              <div className="min-w-56 flex-1">
                <p className="text-[15px]">
                  <span className="tc text-[22px] font-semibold">{done}</span>
                  <span className="text-ink-2"> of {plural(scenes.length, 'scene')} have an image</span>
                </p>
                <ProgressBar value={done / scenes.length} tone="you" className="mt-2 max-w-md" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canGenerate &&
                  (batch ? (
                    <Button
                      variant="plain"
                      onClick={() => {
                        batch.stop = true
                        emitGeneration()
                      }}
                      icon={<Square className="size-3.5" />}
                    >
                      Stop ({batch.done} of {batch.total})
                    </Button>
                  ) : (
                    !complete && (
                      <Tip
                        content={`Uses ${status?.gemini.imageModel}. Image models need billing on your Gemini key.`}
                      >
                        <Button variant="go" onClick={generateMissing} icon={<Sparkles className="size-4" />}>
                          Generate {scenes.length - done} with AI
                        </Button>
                      </Tip>
                    )
                  ))}
                <Button variant="plain" onClick={downloadPrompts} icon={<Download className="size-4" />}>
                  All prompts (.txt)
                </Button>
                <Button
                  variant={complete || canGenerate ? 'plain' : 'go'}
                  onClick={picker.open}
                  icon={<Images className="size-4" />}
                >
                  Upload many
                </Button>
                {picker.input}
                {complete && (
                  <Button
                    variant="go"
                    onClick={() => goTo('preview')}
                    icon={<ArrowRight className="size-4" />}
                  >
                    Preview
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-5 py-3 text-[13px] text-ink-2">
              <p className="max-w-[78ch] flex-1">
                {dragging ? (
                  'Drop to place them: files named like scene-03.png go to that scene, the rest fill empty scenes in order.'
                ) : (
                  <>
                    {canGenerate
                      ? 'Generate the pictures with AI (character reference images are attached for you), or copy a prompt into your own image tool and drop the result on its scene.'
                      : 'Copy a prompt into your image tool with the reference images attached, then drop the result on its scene.'}{' '}
                    Or select a scene and press <Kbd>Ctrl</Kbd> <Kbd>V</Kbd> to paste a copied image.
                  </>
                )}
              </p>
              <div className="w-52">
                <Switch
                  checked={missingOnly}
                  onCheckedChange={setMissingOnly}
                  label="Only scenes without images"
                />
              </div>
            </div>
          </Panel>
        )}
      </DropZone>

      <ol className="flex flex-col gap-3">
        {visible.map((scene) => (
          <SceneImageRow
            key={scene.id}
            data={data}
            scene={scene}
            characters={characters}
            selected={scene.id === selectedSceneId}
            progress={progress[scene.id]}
            onSelect={() => selectScene(scene.id)}
            onFile={(file) => uploadOne(scene, file)}
            generating={generating.has(scene.id)}
            onGenerate={canGenerate && !batch ? () => generateScene(scene) : undefined}
          />
        ))}
      </ol>
      {missingOnly && visible.length === 0 && (
        <p className="rounded-[var(--radius-panel)] border border-line bg-panel px-5 py-8 text-center text-[14px] text-ink-2">
          Every scene has an image.
        </p>
      )}
      {confirmDialog}
    </div>
  )
}

function SceneImageRow({
  data,
  scene,
  characters,
  selected,
  progress,
  onSelect,
  onFile,
  generating,
  onGenerate,
}: {
  data: ProjectFull
  scene: SceneDTO
  characters: CharacterDTO[]
  selected: boolean
  progress: number | undefined
  onSelect: () => void
  onFile: (file: File) => void
  generating: boolean
  /** Undefined when AI images are not available (no Gemini key, or a batch is running). */
  onGenerate?: () => void
}) {
  const { project } = data
  const { saver } = useSaver(project.id)
  const ref = useRef<HTMLLIElement>(null)
  const prompt = useMemo(
    () => buildImagePrompt(scene, { artStyle: project.artStyle, format: project.format, characters }),
    [scene, project.artStyle, project.format, characters],
  )
  const cast = sceneCharacters(scene, characters)
  const portrait = project.format === 'portrait'
  const target = outputSize(project.format, project.resolution)
  const lowRes =
    scene.imageWidth && scene.imageHeight
      ? scene.imageWidth < target.width * 0.75 || scene.imageHeight < target.height * 0.75
      : false
  const [expanded, setExpanded] = useState(false)
  const set = (patch: Partial<SceneDTO>) => saver.scene(scene.id, patch, 0)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onSelect}
      onKeyDown={undefined}
      className={cn(
        'grid gap-x-5 gap-y-4 rounded-[var(--radius-panel)] border bg-panel p-4 outline-none sm:grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_200px]',
        selected ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line',
      )}
    >
      <DropZone accept="image/*" onFiles={([file]) => onFile(file)} className="rounded-[var(--radius-frame)]">
        {({ open, dragging }) => (
          <Frame
            scene={scene}
            portrait={portrait}
            dragging={dragging}
            progress={progress}
            generating={generating}
            onPick={open}
            onFocusPoint={(x, y) => set({ focusX: x, focusY: y })}
          />
        )}
      </DropZone>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tc grid h-6 min-w-6 place-items-center rounded-[4px] bg-ink px-1 text-[12px] font-semibold text-paper">
            {scene.index + 1}
          </span>
          <span className="tc text-[13px] text-ink-2">
            {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
          </span>
          <span className="tc text-[12.5px] text-ink-3">
            {(scene.end - scene.start).toFixed(1)} s on screen
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[14px] leading-snug text-ink-2">“{scene.narration}”</p>

        <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-sunk">
          <p
            className={cn(
              'px-3 pt-2.5 text-[13px] leading-relaxed whitespace-pre-line text-ink',
              !expanded && 'line-clamp-3',
            )}
          >
            {prompt}
          </p>
          <div className="flex flex-wrap items-center gap-2 px-2 py-2">
            <CopyButton text={prompt} label="Copy prompt" variant="dark" />
            {(onGenerate || generating) && (
              <Button
                variant="plain"
                size="sm"
                busy={generating}
                disabled={!onGenerate || progress !== undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  onGenerate?.()
                }}
                icon={<Sparkles className="size-3.5" />}
              >
                {generating ? 'Generating…' : scene.imageUrl ? 'Generate again' : 'Generate'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Show all'}
            </Button>
            {cast.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[12px] text-ink-3">Attach</span>
                {cast.flatMap((c) =>
                  c.images
                    .slice(0, 2)
                    .map((img) => <ReferenceThumb key={img.url} url={img.url} name={c.name} />),
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:col-span-2 xl:col-span-1">
        {scene.imageUrl ? (
          <>
            <Segmented
              ariaLabel="Image fit"
              value={scene.fit}
              onChange={(fit) => set({ fit })}
              options={[
                { value: 'cover', label: 'Fill', hint: 'Crop to fill the frame' },
                { value: 'contain', label: 'Fit', hint: 'Show the whole image on a blurred background' },
              ]}
              className="w-full"
            />
            <Select
              aria-label="Camera motion"
              value={scene.motion}
              onChange={(e) => set({ motion: e.target.value as Motion })}
            >
              {MOTIONS.map((m) => (
                <option key={m} value={m}>
                  {MOTION_LABEL[m]}
                </option>
              ))}
            </Select>
            {scene.index > 0 && (
              <Select
                aria-label="Transition in"
                value={normalizeTransition(scene.transition)}
                onChange={(e) => set({ transition: e.target.value })}
              >
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'cut' ? 'Cut in' : `${TRANSITION_LABEL[t]} in`}
                  </option>
                ))}
              </Select>
            )}
            {lowRes && (
              <p className="flex gap-1.5 text-[12.5px] leading-snug text-kodak-ink">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {scene.imageWidth}×{scene.imageHeight} is small for a {target.width}×{target.height} video. It
                may look soft.
              </p>
            )}
            {scene.fit === 'cover' && (
              <p className="text-[12px] text-ink-3">Click the picture to choose what stays in frame.</p>
            )}
            <div className="mt-auto flex gap-1.5">
              <DropZone accept="image/*" onFiles={([file]) => onFile(file)}>
                {({ open }) => (
                  <Button variant="plain" size="sm" onClick={open} icon={<Replace className="size-3.5" />}>
                    Replace
                  </Button>
                )}
              </DropZone>
              <Button
                variant="danger"
                size="sm"
                onClick={() => set({ imageUrl: null })}
                icon={<Trash2 className="size-3.5" />}
              >
                Remove
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] leading-snug text-ink-3">
            {scene.shot ? `${scene.shot}. ` : ''}
            {MOTION_LABEL[scene.motion]} once the image is in.
          </p>
        )}
      </div>
    </li>
  )
}

function Frame({
  scene,
  portrait,
  dragging,
  progress,
  generating,
  onPick,
  onFocusPoint,
}: {
  scene: SceneDTO
  portrait: boolean
  dragging: boolean
  progress: number | undefined
  generating: boolean
  onPick: () => void
  onFocusPoint: (x: number, y: number) => void
}) {
  const size = portrait ? 'h-[196px] w-[110px]' : 'h-[124px] w-[220px]'
  if (generating) {
    return (
      <div
        className={cn(
          'flex shrink-0 flex-col items-center justify-center gap-2 rounded-[var(--radius-frame)] bg-film text-[12.5px] text-paper/80',
          size,
        )}
      >
        <Spinner />
        <span className="px-2 text-center leading-tight">Gemini is painting…</span>
      </div>
    )
  }
  if (!scene.imageUrl || progress !== undefined) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onPick()
        }}
        className={cn(
          'relative flex shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-frame)] text-[12.5px] transition-colors',
          size,
          dragging
            ? 'bg-kodak-wash text-ink shadow-[0_0_0_2px_var(--color-ink)]'
            : 'hatch bg-sunk text-ink-2 shadow-[inset_0_0_0_1px_var(--color-kodak-deep)] hover:text-ink',
        )}
      >
        {progress !== undefined ? (
          <>
            <span>Uploading</span>
            <ProgressBar value={progress} tone="you" className="w-3/4" />
          </>
        ) : (
          <>
            <ImagePlus className="size-5" aria-hidden />
            <span className="px-2 text-center leading-tight">Drop, paste or choose</span>
          </>
        )}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-label={
        scene.fit === 'cover' ? 'Click to choose what stays in frame' : `Scene ${scene.index + 1} image`
      }
      className={cn(
        'relative block shrink-0 overflow-hidden rounded-[var(--radius-frame)] bg-film',
        scene.fit === 'cover' ? 'cursor-crosshair' : 'cursor-default',
        size,
      )}
      onClick={(e) => {
        if (scene.fit !== 'cover') return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
        onFocusPoint(Math.round(x * 100) / 100, Math.round(y * 100) / 100)
      }}
    >
      {scene.fit === 'contain' && (
        // biome-ignore lint/performance/noImgElement: user uploads
        <img
          src={scene.imageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-md"
        />
      )}
      {/* biome-ignore lint/performance/noImgElement: user uploads */}
      <img
        src={scene.imageUrl}
        alt={`Scene ${scene.index + 1}`}
        className={cn('relative size-full', scene.fit === 'cover' ? 'object-cover' : 'object-contain')}
        style={
          scene.fit === 'cover'
            ? { objectPosition: `${scene.focusX * 100}% ${scene.focusY * 100}%` }
            : undefined
        }
      />
      {scene.fit === 'cover' && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-kodak bg-ink/40"
          style={{ left: `${scene.focusX * 100}%`, top: `${scene.focusY * 100}%` }}
        />
      )}
    </button>
  )
}

/** A character reference image you can copy to the clipboard and paste into your image tool. */
function ReferenceThumb({ url, name }: { url: string; name: string }) {
  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      const blob = await toPngBlob(url)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success(`${name}'s reference image copied`, { description: 'Paste it into your image tool.' })
    } catch {
      window.open(url, '_blank', 'noopener')
    }
  }
  return (
    <Tip content={`Copy ${name}'s reference image`}>
      <button
        type="button"
        onClick={copy}
        className="size-8 overflow-hidden rounded-full ring-1 ring-line-strong hover:ring-2 hover:ring-ink"
      >
        {/* biome-ignore lint/performance/noImgElement: user uploads */}
        <img src={url} alt={name} className="size-full object-cover" />
      </button>
    </Tip>
  )
}

async function toPngBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  const source = await response.blob()
  if (source.type === 'image/png') return source
  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Copy failed'))), 'image/png'),
  )
}
