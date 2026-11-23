'use client'

import { buildImagePrompt, sceneCharacters } from '@cutroom/shared/prompts'
import { formatTimecode } from '@cutroom/shared/timing'
import {
  EMPTY_LAYER,
  hasPicture,
  LAYER_SIDES,
  type LayerSide,
  MOTIONS,
  type Motion,
  normalizeTransition,
  outputSize,
  type SceneLayer,
  TRANSITIONS,
} from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Download,
  Hourglass,
  ImagePlus,
  Images,
  Layers,
  LayoutGrid,
  List,
  Replace,
  Send,
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
  Tip,
  useConfirm,
  useFilePicker,
} from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { CharacterDTO, ProjectFull, SceneDTO, SceneLayerChange } from '@/lib/dto'
import { flowProject, sendToFlow, useFlowExtension } from '@/lib/flow-extension'
import { plural } from '@/lib/format'
import { keys, useBackgrounds, useLibrary, useProjectAction, useSaver, useStatus } from '@/lib/hooks'
import { downloadScenePrompts, scenePrompts } from '@/lib/scene-prompts'
import { streamAnswer } from '@/lib/stream'
import { STOPPED_BY_YOU } from '@/lib/tasks'
import { imageSize, isImage, sceneNumberFromName } from '@/lib/upload'
import { useUploader } from './fields'
import { LayeredPicture } from './layered-picture'
import { MOTION_LABEL, TRANSITION_LABEL } from './script'
import { runningTask, StillRunning } from './still-running'
import type { StepProps } from './workspace'

type Progress = Record<string, number>

/**
 * Scene pictures this tab asked Gemini for (each scene's Generate button). It lives outside the
 * component so it stays visible when you switch to another step and back: no scene is requested
 * (and billed) twice. Generate missing runs on the server instead (ProjectFull.pictures).
 */
const generation = {
  scenes: new Set<string>(),
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
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useImagesView()
  useGeneration()
  // Generate missing runs on the server: shown whenever the page is open, also after a reload.
  const pictures = data.pictures
  const batchRunning = pictures?.running === true
  const [queueing, setQueueing] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Pictures being made on the server (Generate missing, or a scene's Generate pressed in another
  // tab or before a reload) and the ones waiting their turn, by scene.
  const making = new Set<string>()
  const waiting = new Set<string>()
  for (const task of data.tasks) {
    if (task.kind !== 'picture') continue
    for (const id of task.sceneIds) (task.status === 'running' ? making : waiting).add(id)
  }
  const isGenerating = (scene: SceneDTO) => generation.scenes.has(scene.id) || making.has(scene.id)
  // Why Gemini didn't make a scene's picture last time, for scenes still without one.
  const withoutPicture = new Set(scenes.filter((s) => !hasPicture(s)).map((s) => s.id))
  const notMade = new Map(
    (pictures?.failed ?? []).filter((f) => withoutPicture.has(f.sceneId)).map((f) => [f.sceneId, f.error]),
  )
  // An error every picture would hit (billing, the daily limit) stopped the rest.
  const geminiStopped = pictures?.stopped && pictures.stopped !== STOPPED_BY_YOU ? pictures.stopped : null
  const done = scenes.filter(hasPicture).length
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const canGenerate = status?.gemini.configured === true
  const action = useProjectAction(project.id)
  const { data: backgrounds } = useBackgrounds()
  const { data: library } = useLibrary()
  const hasLayers = (backgrounds?.length ?? 0) > 0 || (library ?? []).some((c) => c.poses.length > 0)
  const [composing, setComposing] = useState(false)
  // Picked on the server for a request this page didn't make: the pictures show once saved.
  const composingElsewhere = composing ? null : runningTask(data, ['compose'])
  const flow = useFlowExtension()
  const [sendingToFlow, setSendingToFlow] = useState(false)

  /**
   * Hands every scene's prompt (and the characters' pictures) to the Cutroom for Flow extension:
   * it makes the pictures in Google Flow one by one, and each lands on its scene here.
   */
  const makeInFlow = async () => {
    setSendingToFlow(true)
    try {
      // Prompt edits are saved with a short delay; send the latest ones.
      await saver.flushAll()
      const latest = client.getQueryData<ProjectFull>(keys.project(project.id)) ?? data
      const answer = await sendToFlow(await flowProject(latest))
      if (!answer.ok) {
        toast.error(answer.error ?? 'The Cutroom for Flow extension didn’t take the scenes.')
        return
      }
      const missing = latest.scenes.filter((s) => !hasPicture(s)).length
      toast.success(
        missing ? `Sent ${plural(missing, 'scene')} to make in Flow` : 'Sent the scenes to Flow',
        {
          description: `${
            answer.panel
              ? 'Press Start in the Cutroom for Flow panel.'
              : 'Click the Cutroom for Flow icon in Chrome’s toolbar, then press Start.'
          } Keep this tab open: each picture lands on its scene here.`,
          duration: 12_000,
        },
      )
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSendingToFlow(false)
    }
  }

  /**
   * Gemini paints one scene, in this tab's request. The server records it while it runs, so the
   * scene shows it still being made after a reload, and it can't be asked for twice.
   */
  const generateOne = useCallback(
    async (scene: SceneDTO) => {
      if (generation.scenes.has(scene.id)) return
      generation.scenes.add(scene.id)
      emitGeneration()
      try {
        // Prompt edits are saved with a short delay; make sure Gemini gets the latest one.
        await saver.flushAll()
        const updated = await api.post<SceneDTO | { ok: false }>(`/api/scenes/${scene.id}/image`)
        if ('id' in updated) {
          // Its task ended with this answer: the scene doesn't wait for the next check to say so.
          client.setQueryData<ProjectFull>(keys.project(project.id), (prev) =>
            prev
              ? {
                  ...prev,
                  scenes: prev.scenes.map((s) => (s.id === updated.id ? updated : s)),
                  tasks: prev.tasks.filter((t) => t.kind !== 'picture' || !t.sceneIds.includes(updated.id)),
                }
              : prev,
          )
        }
      } catch (error) {
        toast.error(`Scene ${scene.index + 1}: ${errorText(error)}`)
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
   * Every scene still without a picture, made by Gemini on the server two at a time: it goes on
   * with this window closed, and each picture shows on its scene once it's saved.
   */
  const generateMissing = async () => {
    setQueueing(true)
    await action(`/api/projects/${project.id}/ai/pictures`, {})
    setQueueing(false)
  }

  /** The pictures not started are left; the ones being made are finished. */
  const stopMissing = async () => {
    setStopping(true)
    await action(`/api/projects/${project.id}/ai/pictures/stop`, {})
    setStopping(false)
  }

  // Finished while you watch: told at once, as before.
  const wasRunning = useRef(batchRunning)
  const notMadeCount = notMade.size
  useEffect(() => {
    if (wasRunning.current && pictures && !pictures.running) {
      if (pictures.made) toast.success(`Generated ${plural(pictures.made, 'image')}`)
      if (geminiStopped) toast.error(geminiStopped)
      else if (notMadeCount) {
        toast.error(`Gemini didn’t make ${plural(notMadeCount, 'picture')}`, {
          description: 'Each of those scenes says why.',
        })
      }
    }
    wasRunning.current = batchRunning
  }, [pictures, batchRunning, geminiStopped, notMadeCount])

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
        list.find((s) => s.index > scene.index && !hasPicture(s)) ??
        list.find((s) => !hasPicture(s) && s.id !== scene.id)
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
        if (!hasPicture(scene) && !plan.has(scene.id)) plan.set(scene.id, leftovers.shift()!)
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
      const scene = list.find((s) => s.id === selectedSceneId) ?? list.find((s) => !hasPicture(s))
      if (!scene) return
      event.preventDefault()
      void uploadOne(scene, file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [selectedSceneId, uploadOne])

  /**
   * Gemini picks a Library background and pose for each scene still without a picture. Each scene
   * shows its pick as soon as it's saved, while Gemini goes on with the rest.
   */
  const compose = async () => {
    setComposing(true)
    const before = scenesRef.current.filter(hasPicture).length
    try {
      await saver.flushAll()
      const full = await streamAnswer<ProjectFull, { scenes: SceneLayerChange[] }>(
        `/api/projects/${project.id}/ai/compose`,
        {},
        {
          partial: ({ scenes: changed }) =>
            client.setQueryData<ProjectFull>(keys.project(project.id), (prev) =>
              prev
                ? {
                    ...prev,
                    scenes: prev.scenes.map((s) => {
                      const change = changed.find((c) => c.id === s.id)
                      return change ? { ...s, layer: change.layer } : s
                    }),
                  }
                : prev,
            ),
        },
      )
      // A check on the project still under way would bring back how it was before.
      await client.cancelQueries({ queryKey: keys.project(project.id) })
      client.setQueryData(keys.project(project.id), full)
      void client.invalidateQueries({ queryKey: keys.projects })
      const added = full.scenes.filter(hasPicture).length - before
      if (added > 0) toast.success(`Built ${plural(added, 'scene')} from the Library`)
      else
        toast('Nothing in the Library fitted the remaining scenes', {
          description: 'Name your backgrounds and poses so the AI can tell them apart.',
        })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setComposing(false)
    }
  }

  const picker = useFilePicker('image/*', true, uploadMany)
  const downloadPrompts = () => downloadScenePrompts(project.title, scenePrompts(data))

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

  const shown = (s: SceneDTO) =>
    filter === 'missing'
      ? !hasPicture(s) || progress[s.id] !== undefined
      : filter === 'no-character'
        ? !s.imageUrl && !s.layer?.poseUrl
        : true
  const visible = scenes.filter(shown)
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
                  <span className="text-ink-2"> of {plural(scenes.length, 'scene')} have a picture</span>
                </p>
                <ProgressBar value={done / scenes.length} tone="you" className="mt-2 max-w-md" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canGenerate && !complete && !batchRunning && (
                  <Tip
                    content={`Uses ${status?.gemini.imageModel}. Image models need billing on your Gemini key.`}
                  >
                    <Button
                      variant={hasLayers ? 'plain' : 'go'}
                      busy={queueing}
                      onClick={generateMissing}
                      icon={<Sparkles className="size-4" />}
                    >
                      Generate {scenes.length - done} with AI
                    </Button>
                  </Tip>
                )}
                {canGenerate && hasLayers && !complete && !batchRunning && (
                  <Tip content="Free: the AI reads each scene and picks a background and a character pose from your Library.">
                    <Button
                      variant="go"
                      busy={composing}
                      disabled={composingElsewhere !== null}
                      onClick={compose}
                      icon={<Layers className="size-4" />}
                    >
                      Pick backgrounds and poses with AI
                    </Button>
                  </Tip>
                )}
                {flow && (
                  <Tip content="The Cutroom for Flow extension makes each picture in Google Flow, with your character attached, and puts it on its scene here.">
                    <Button
                      variant={!complete && !canGenerate ? 'go' : 'plain'}
                      busy={sendingToFlow}
                      onClick={makeInFlow}
                      icon={<Send className="size-4" />}
                    >
                      {complete ? 'Make in Flow' : `Make ${scenes.length - done} in Flow`}
                    </Button>
                  </Tip>
                )}
                <Button variant="plain" onClick={downloadPrompts} icon={<Download className="size-4" />}>
                  All prompts (.txt)
                </Button>
                <Button
                  variant={complete || canGenerate || flow ? 'plain' : 'go'}
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
            {composingElsewhere && (
              <StillRunning task={composingElsewhere} className="border-t border-line px-5 py-3" />
            )}
            {composing && (
              <p
                aria-live="polite"
                className="flex items-center gap-2 border-t border-line px-5 py-3 text-[13px] text-ink-2"
              >
                <Spinner className="shrink-0 text-ink-3" />
                Gemini is picking a background and pose for each scene: each shows as soon as it’s picked.
              </p>
            )}
            {pictures?.running && (
              <div
                aria-live="polite"
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3"
              >
                <Spinner className="shrink-0 text-ink-3" />
                <span className="text-[14px]">
                  Making pictures: {pictures.done} of {pictures.total}…
                </span>
                <ProgressBar
                  value={pictures.done / pictures.total}
                  tone="you"
                  className="min-w-32 max-w-64 flex-1"
                />
                <Button
                  variant="plain"
                  size="sm"
                  busy={stopping}
                  onClick={stopMissing}
                  className="ml-auto"
                  icon={<Square className="size-3.5" />}
                >
                  Stop
                </Button>
                <p className="basis-full text-[12.5px] text-ink-3">
                  You can close this window: Gemini keeps making them on the server, and each one shows on its
                  scene once it’s saved.
                </p>
              </div>
            )}
            {!pictures?.running && geminiStopped && !complete && (
              <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-[13px] text-bad">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>Gemini stopped making pictures: {geminiStopped}</span>
              </p>
            )}
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
                    {hasLayers
                      ? ' Scenes can also be built from your Library: a background with a character pose in front.'
                      : ' Add backgrounds and character poses in the Library to build scenes from them.'}
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<Filter>
                  ariaLabel="Which scenes to show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'missing', label: 'No picture', hint: 'Scenes still without a picture' },
                    ...(hasLayers
                      ? [
                          {
                            value: 'no-character' as const,
                            label: 'No character',
                            hint: 'Scenes without an uploaded picture or a character pose',
                          },
                        ]
                      : []),
                  ]}
                />
                <Segmented<ImagesView>
                  ariaLabel="Layout"
                  value={view}
                  onChange={setView}
                  options={[
                    {
                      value: 'list',
                      label: <List className="size-4" aria-label="List" />,
                      hint: 'One row per scene, to edit',
                    },
                    {
                      value: 'grid',
                      label: <LayoutGrid className="size-4" aria-label="Grid" />,
                      hint: 'Every picture at a glance; click one to edit it',
                    },
                  ]}
                />
              </div>
            </div>
          </Panel>
        )}
      </DropZone>

      {view === 'grid' ? (
        <ol
          className={cn(
            'grid gap-x-2.5 gap-y-3',
            project.format === 'portrait'
              ? 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10'
              : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
          )}
        >
          {visible.map((scene) => (
            <SceneTile
              key={scene.id}
              scene={scene}
              format={project.format}
              selected={scene.id === selectedSceneId}
              busy={progress[scene.id] !== undefined || isGenerating(scene)}
              waiting={waiting.has(scene.id)}
              notMade={notMade.get(scene.id) ?? null}
              onOpen={() => {
                selectScene(scene.id)
                setView('list')
              }}
              onFile={(file) => uploadOne(scene, file)}
            />
          ))}
        </ol>
      ) : (
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
              generating={isGenerating(scene)}
              waiting={waiting.has(scene.id)}
              notMade={notMade.get(scene.id) ?? null}
              onGenerate={
                canGenerate && !batchRunning && !waiting.has(scene.id)
                  ? () => generateScene(scene)
                  : undefined
              }
            />
          ))}
        </ol>
      )}
      {filter !== 'all' && visible.length === 0 && (
        <p className="rounded-[var(--radius-panel)] border border-line bg-panel px-5 py-8 text-center text-[14px] text-ink-2">
          {filter === 'missing' ? 'Every scene has a picture.' : 'Every scene has a character.'}
        </p>
      )}
      {confirmDialog}
    </div>
  )
}

type Filter = 'all' | 'missing' | 'no-character'
type ImagesView = 'list' | 'grid'
const VIEW_KEY = 'cutroom-images-view'

/** List or grid, remembered in this browser. */
function useImagesView(): [ImagesView, (view: ImagesView) => void] {
  const [view, setView] = useState<ImagesView>('list')
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'grid') setView('grid')
    } catch {
      // Storage blocked: start with the list.
    }
  }, [])
  const choose = (next: ImagesView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  }
  return [view, choose]
}

/**
 * One scene in the grid: its picture (uploaded or layered), number and length. Drop an image on
 * it to fill it; click it to edit the scene in the list.
 */
function SceneTile({
  scene,
  format,
  selected,
  busy,
  waiting,
  notMade,
  onOpen,
  onFile,
}: {
  scene: SceneDTO
  format: SceneFormat
  selected: boolean
  busy: boolean
  /** Its picture waits its turn on the server. */
  waiting: boolean
  /** Why Gemini didn't make its picture last time. */
  notMade: string | null
  onOpen: () => void
  onFile: (file: File) => void
}) {
  return (
    <li className="min-w-0">
      <DropZone
        accept="image/*"
        onFiles={([file]) => file && onFile(file)}
        className="rounded-[var(--radius-frame)]"
      >
        {({ dragging }) => (
          <button
            type="button"
            onClick={onOpen}
            title={notMade ? `Not made: ${notMade}` : scene.narration}
            aria-label={`Scene ${scene.index + 1}: ${scene.narration}${notMade ? `. Not made: ${notMade}` : ''}`}
            className={cn(
              'relative block w-full overflow-hidden rounded-[var(--radius-frame)] bg-film',
              format === 'portrait' ? 'aspect-[9/16]' : 'aspect-video',
              dragging
                ? 'ring-2 ring-kodak'
                : selected
                  ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper'
                  : 'ring-1 ring-line hover:ring-ink-3',
            )}
          >
            {scene.imageUrl ? (
              // biome-ignore lint/performance/noImgElement: user uploads
              <img src={scene.imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
            ) : scene.layer && hasPicture(scene) ? (
              <span className="absolute inset-0">
                <LayeredPicture layer={scene.layer} fit={scene.fit} format={format} className="size-full" />
              </span>
            ) : (
              <span className="hatch absolute inset-0 grid place-items-center bg-sunk px-1 text-center text-[11.5px] text-ink-3">
                {waiting ? 'Waiting its turn' : 'No picture'}
              </span>
            )}
            {busy && (
              <span className="absolute inset-0 grid place-items-center bg-film/60 text-film-ink">
                <Spinner />
              </span>
            )}
            {notMade && !busy && !waiting && (
              <span className="absolute top-1 right-1 rounded-[3px] bg-paper/90 p-0.5 text-bad" aria-hidden>
                <TriangleAlert className="size-3.5" />
              </span>
            )}
            <span className="tc absolute top-1 left-1 rounded-[3px] bg-ink/85 px-1 text-[11px] font-semibold text-paper">
              {scene.index + 1}
            </span>
            <span className="tc absolute right-1 bottom-1 rounded-[3px] bg-film/75 px-1 text-[10.5px] text-film-ink">
              {(scene.end - scene.start).toFixed(1)} s
            </span>
          </button>
        )}
      </DropZone>
      <p className="mt-1 truncate text-[11.5px] text-ink-3">{scene.narration}</p>
    </li>
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
  waiting,
  notMade,
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
  /** Its picture waits its turn on the server. */
  waiting: boolean
  /** Why Gemini didn't make its picture last time. */
  notMade: string | null
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
  const layered = !scene.imageUrl && hasPicture(scene)

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
            format={project.format}
            portrait={portrait}
            dragging={dragging}
            progress={progress}
            generating={generating}
            waiting={waiting}
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
        {notMade && !generating && !waiting && (
          <p className="mt-2 flex gap-1.5 text-[12.5px] leading-snug text-bad">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Not made: {notMade}
          </p>
        )}
        {!scene.imageUrl && (
          <LayerPicker scene={scene} characters={characters} onChange={(layer) => set({ layer })} />
        )}
      </div>

      <div className="flex flex-col gap-3 sm:col-span-2 xl:col-span-1">
        {scene.imageUrl || layered ? (
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
            {scene.fit === 'cover' && !layered && (
              <p className="text-[12px] text-ink-3">Click the picture to choose what stays in frame.</p>
            )}
            <div className="mt-auto flex gap-1.5">
              <DropZone accept="image/*" onFiles={([file]) => onFile(file)}>
                {({ open }) => (
                  <Button variant="plain" size="sm" onClick={open} icon={<Replace className="size-3.5" />}>
                    {layered ? 'Upload instead' : 'Replace'}
                  </Button>
                )}
              </DropZone>
              <Button
                variant="danger"
                size="sm"
                onClick={() => set(layered ? { layer: null } : { imageUrl: null })}
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
  format,
  portrait,
  dragging,
  progress,
  generating,
  waiting,
  onPick,
  onFocusPoint,
}: {
  scene: SceneDTO
  format: SceneFormat
  portrait: boolean
  dragging: boolean
  progress: number | undefined
  generating: boolean
  waiting: boolean
  onPick: () => void
  onFocusPoint: (x: number, y: number) => void
}) {
  const size = portrait ? 'h-[196px] w-[110px]' : 'h-[124px] w-[220px]'
  if (generating) {
    return (
      <div
        className={cn(
          'flex shrink-0 flex-col items-center justify-center gap-2 rounded-[var(--radius-frame)] bg-film text-[12.5px] text-film-ink/80',
          size,
        )}
      >
        <Spinner />
        <span className="px-2 text-center leading-tight">Gemini is painting…</span>
      </div>
    )
  }
  if (!scene.imageUrl && scene.layer && hasPicture(scene) && progress === undefined) {
    return (
      <LayeredPicture
        layer={scene.layer}
        fit={scene.fit}
        format={format}
        className={cn(
          'shrink-0 rounded-[var(--radius-frame)]',
          size,
          dragging && 'shadow-[0_0_0_2px_var(--color-ink)]',
        )}
      />
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
        ) : waiting ? (
          // A picture dropped meanwhile is kept: Gemini then skips this scene.
          <>
            <Hourglass className="size-5" aria-hidden />
            <span className="px-2 text-center leading-tight">Waiting its turn for Gemini</span>
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

type SceneFormat = ProjectFull['project']['format']

/**
 * A scene picture built from the Library: a background, and a character's pose in front of it.
 * The project's own characters come first; poses are grouped by character.
 */
function LayerPicker({
  scene,
  characters,
  onChange,
}: {
  scene: SceneDTO
  characters: CharacterDTO[]
  onChange: (layer: SceneLayer | null) => void
}) {
  const { data: backgrounds = [] } = useBackgrounds()
  const { data: library = [] } = useLibrary()
  const named = (name: string) => name.trim().toLowerCase()
  const inProject = new Set(characters.map((c) => named(c.name)))
  const cast = library
    .filter((c) => c.poses.length > 0)
    .sort((a, b) => Number(inProject.has(named(b.name))) - Number(inProject.has(named(a.name))))
  if (backgrounds.length === 0 && cast.length === 0) return null
  const layer = scene.layer ?? EMPTY_LAYER
  const update = (patch: Partial<SceneLayer>) => {
    const next = { ...layer, ...patch }
    onChange(next.backgroundUrl || next.poseUrl ? next : null)
  }
  const pickPose = (url: string) => {
    for (const character of cast) {
      const pose = character.poses.find((p) => p.url === url)
      if (pose) {
        update({ poseUrl: pose.url, blinkUrl: pose.blinkUrl, character: character.name, pose: pose.name })
        return
      }
    }
    update({ poseUrl: null, blinkUrl: null, character: '', pose: '' })
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Layers className="size-3.5" aria-hidden />
        Or build it
      </span>
      {backgrounds.length > 0 && (
        <Select
          aria-label="Background"
          value={layer.backgroundUrl ?? ''}
          onChange={(e) => {
            const background = backgrounds.find((b) => b.url === e.target.value)
            update({ backgroundUrl: background?.url ?? null, background: background?.name ?? '' })
          }}
          className="w-44"
        >
          <option value="">No background</option>
          {backgrounds.map((b) => (
            <option key={b.id} value={b.url}>
              {b.name || 'Untitled background'}
            </option>
          ))}
        </Select>
      )}
      {cast.length > 0 && (
        <Select
          aria-label="Character pose"
          value={layer.poseUrl ?? ''}
          onChange={(e) => pickPose(e.target.value)}
          className="w-44"
        >
          <option value="">No character</option>
          {cast.map((c) => (
            <optgroup key={c.id} label={c.name || 'Character'}>
              {c.poses.map((p) => (
                <option key={p.id} value={p.url}>
                  {p.name || 'Pose'}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
      {layer.poseUrl && (
        <Segmented<LayerSide>
          ariaLabel="Where the character stands"
          value={layer.side}
          onChange={(side) => update({ side })}
          options={LAYER_SIDES.map((side) => ({ value: side, label: SIDE_LABEL[side] }))}
        />
      )}
    </div>
  )
}

const SIDE_LABEL: Record<LayerSide, string> = { left: 'Left', center: 'Middle', right: 'Right' }

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
