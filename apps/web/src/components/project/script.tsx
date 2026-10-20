'use client'

import {
  countWords,
  formatTimecode,
  splitBySentences,
  totalDuration,
  WORDS_PER_SECOND,
} from '@cutroom/shared/timing'
import {
  MOTIONS,
  type Motion,
  normalizeTransition,
  TRANSITIONS,
  type Transition,
} from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, Plus, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, Field, Menu, Panel, Select, Textarea, useConfirm } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { CharacterDTO, ProjectFull, SceneDTO } from '@/lib/dto'
import { formatLength } from '@/lib/format'
import { keys, useProjectAction, useSaver, useStatus } from '@/lib/hooks'
import { SyncedInput, SyncedTextarea } from './fields'
import type { StepProps } from './workspace'

export const MOTION_LABEL: Record<Motion, string> = {
  'zoom-in': 'Slow zoom in',
  'zoom-out': 'Slow zoom out',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right',
  none: 'Still',
}

export const TRANSITION_LABEL: Record<Transition, string> = {
  cut: 'Cut',
  crossfade: 'Crossfade',
  'fade-black': 'Dip to black',
}

export function ScriptStep({ data, selectedSceneId, selectScene, goTo }: StepProps) {
  const { project, scenes } = data
  const { saver } = useSaver(project.id)
  const action = useProjectAction(project.id)
  const { data: status } = useStatus()
  const { confirm, element } = useConfirm()
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<'split' | 'write' | 'local' | null>(null)
  const words = countWords(project.script)

  const confirmReplace = async () =>
    scenes.length === 0 ||
    confirm({
      title: 'Replace your scenes?',
      body: `Splitting again replaces all ${scenes.length} scenes${scenes.some((s) => s.imageUrl) ? ' and removes their uploaded images' : ''}.`,
      action: 'Replace scenes',
      danger: true,
    })

  const split = async () => {
    if (!(await confirmReplace())) return
    setBusy('split')
    const full = await action(`/api/projects/${project.id}/ai/scenes`, {}, undefined)
    setBusy(null)
    if (full) toast.success(`Split into ${full.scenes.length} scenes`)
  }

  const splitLocally = async () => {
    if (!(await confirmReplace())) return
    setBusy('local')
    const drafts = splitBySentences(project.script, project.pace)
    const full = await action(`/api/projects/${project.id}/scenes`, { drafts })
    setBusy(null)
    if (full) toast.success(`Split into ${full.scenes.length} scenes by sentence`)
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Panel
        className="xl:sticky xl:top-4"
        title="Script"
        description="Paste the narration exactly as it will be spoken, or let Gemini draft it from your brief."
        actions={
          <Button
            variant="plain"
            size="sm"
            icon={<Sparkles className="size-3.5" />}
            onClick={() => setWriting(true)}
          >
            Write with AI
          </Button>
        }
      >
        <div className="px-5 py-4">
          <SyncedTextarea
            aria-label="Script"
            value={project.script}
            onValue={(script) => saver.project({ script })}
            placeholder="Paste your script here."
            className="min-h-[46vh] text-[15px] leading-[1.7] xl:min-h-[52vh]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="tc text-[13px] text-ink-2">
              {words.toLocaleString()} words · about {formatLength(words / WORDS_PER_SECOND)} spoken
            </span>
            <div className="ml-auto flex items-center gap-2">
              {status?.gemini.configured === false ? (
                <Button
                  variant={scenes.length ? 'plain' : 'go'}
                  busy={busy === 'local'}
                  disabled={!project.script.trim()}
                  onClick={splitLocally}
                  icon={<Scissors className="size-4" />}
                >
                  Split into scenes
                </Button>
              ) : (
                <>
                  <Menu
                    trigger={
                      <Button
                        variant="ghost"
                        size="md"
                        aria-label="More ways to split"
                        icon={<ChevronDown className="size-4" />}
                      />
                    }
                    items={[{ label: 'Split by sentence (no AI)', onSelect: splitLocally }]}
                  />
                  <Button
                    variant={scenes.length ? 'plain' : 'go'}
                    busy={busy === 'split'}
                    disabled={!project.script.trim()}
                    onClick={split}
                    icon={<Scissors className="size-4" />}
                  >
                    {scenes.length ? 'Split again' : 'Split into scenes'}
                  </Button>
                </>
              )}
            </div>
          </div>
          {busy === 'split' && (
            <p className="mt-3 text-[13px] text-ink-2">
              Gemini is storyboarding your script. Long scripts take up to a minute.
            </p>
          )}
        </div>
      </Panel>

      <ScenesPanel data={data} selectedSceneId={selectedSceneId} selectScene={selectScene} goTo={goTo} />

      <WriteDialog
        open={writing}
        onOpenChange={setWriting}
        data={data}
        busy={busy === 'write'}
        onWrite={async (notes) => {
          if (
            project.script.trim() &&
            !(await confirm({
              title: 'Replace your script?',
              body: 'Gemini writes a new script from your brief. Your current script is replaced.',
              action: 'Replace script',
              danger: true,
            }))
          ) {
            return
          }
          setBusy('write')
          const full = await action(`/api/projects/${project.id}/ai/script`, { notes }, 'Script written')
          setBusy(null)
          if (full) setWriting(false)
        }}
      />
      {element}
    </div>
  )
}

function WriteDialog({
  open,
  onOpenChange,
  data,
  busy,
  onWrite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: ProjectFull
  busy: boolean
  onWrite: (notes: string) => void
}) {
  const [notes, setNotes] = useState(data.project.notes)
  const { project } = data
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Write the script with Gemini"
      description={
        project.topic.trim()
          ? `About ${project.targetMinutes < 1 ? `${Math.round(project.targetMinutes * 60)} seconds` : `${project.targetMinutes} minutes`} on: ${project.topic}`
          : 'Add a topic on the Brief step first.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="go" busy={busy} disabled={!project.topic.trim()} onClick={() => onWrite(notes)}>
            Write script
          </Button>
        </>
      }
    >
      <Field
        label="Anything else Gemini should know?"
        hint="Facts to include, a hook idea, a call to action."
      >
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-28" />
      </Field>
    </Dialog>
  )
}

function ScenesPanel({ data, selectedSceneId, selectScene, goTo }: StepProps) {
  const { project, scenes } = data
  const action = useProjectAction(project.id)
  const duration = totalDuration(scenes)

  if (scenes.length === 0) {
    return (
      <Panel title="Scenes">
        <div className="px-6 py-14 text-center">
          <p className="mx-auto max-w-[46ch] text-[14px] leading-relaxed text-ink-2">
            Scenes appear here once the script is split. Each one gets its narration, a timestamp, a
            description of the picture and a ready-to-copy image prompt.
          </p>
        </div>
      </Panel>
    )
  }

  return (
    <Panel
      title={`${scenes.length} scenes`}
      description={`${formatLength(duration)} in total. Timing is estimated until you match the scenes to the voice-over.`}
      actions={
        <Button
          variant="plain"
          size="sm"
          onClick={() => goTo('voiceover')}
          icon={<ArrowRight className="size-3.5" />}
        >
          Voice-over
        </Button>
      }
    >
      <ol className="divide-y divide-line">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            projectId={project.id}
            characters={data.characters}
            selected={scene.id === selectedSceneId}
            onSelect={() => selectScene(scene.id)}
            onAddAfter={() => action(`/api/projects/${project.id}/scenes`, { afterIndex: scene.index })}
          />
        ))}
      </ol>
    </Panel>
  )
}

function SceneCard({
  scene,
  projectId,
  characters,
  selected,
  onSelect,
  onAddAfter,
}: {
  scene: SceneDTO
  projectId: string
  characters: CharacterDTO[]
  selected: boolean
  onSelect: () => void
  onAddAfter: () => void
}) {
  const { saver } = useSaver(projectId)
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  const set = (patch: Partial<SceneDTO>, delay?: number) => saver.scene(scene.id, patch, delay)

  useEffect(() => {
    if (selected) {
      setOpen(true)
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selected])

  const remove = async () => {
    try {
      const full = await api.del<ProjectFull>(`/api/scenes/${scene.id}`)
      client.setQueryData(keys.project(projectId), full)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <li
      ref={ref}
      className={cn('px-5 py-4 transition-colors', selected && 'bg-kodak-wash/50')}
      onFocusCapture={onSelect}
    >
      <div className="flex items-center gap-3">
        <span className="tc grid h-6 min-w-6 place-items-center rounded-[4px] bg-ink px-1 text-[12px] font-semibold text-paper">
          {scene.index + 1}
        </span>
        <span className="tc text-[13px] text-ink-2">
          {formatTimecode(scene.start)} – {formatTimecode(scene.end)}
        </span>
        <span className="text-[12.5px] text-ink-3">{MOTION_LABEL[scene.motion]}</span>
        {scene.imageUrl && (
          // biome-ignore lint/performance/noImgElement: user uploads
          <img src={scene.imageUrl} alt="" className="ml-auto h-7 w-12 rounded-[3px] object-cover" />
        )}
        <Menu
          trigger={
            <button
              type="button"
              aria-label={`Scene ${scene.index + 1} actions`}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-ink-3 hover:bg-sunk hover:text-ink',
                !scene.imageUrl && 'ml-auto',
              )}
            >
              •••
            </button>
          }
          items={[
            { label: 'Add scene after', onSelect: onAddAfter, icon: <Plus className="size-3.5" /> },
            'divider',
            { label: 'Delete scene', onSelect: remove, danger: true, icon: <Trash2 className="size-3.5" /> },
          ]}
        />
      </div>
      <SyncedTextarea
        aria-label={`Scene ${scene.index + 1} narration`}
        value={scene.narration}
        onValue={(narration) => set({ narration })}
        className="mt-3 min-h-0 [field-sizing:content] text-[14.5px]"
        rows={2}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        {open
          ? 'Hide picture details'
          : scene.visual
            ? `Picture: ${scene.visual.slice(0, 70)}${scene.visual.length > 70 ? '…' : ''}`
            : 'Picture details'}
      </button>
      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="What we see" className="sm:col-span-2">
            <SyncedTextarea
              value={scene.visual}
              onValue={(visual) => set({ visual })}
              className="min-h-16 [field-sizing:content]"
            />
          </Field>
          <Field
            label="Image prompt"
            className="sm:col-span-2"
            hint="The art style and character descriptions are added automatically on the Images step."
          >
            <SyncedTextarea
              value={scene.imagePrompt}
              onValue={(imagePrompt) => set({ imagePrompt })}
              className="min-h-16 [field-sizing:content]"
            />
          </Field>
          <Field label="Shot">
            <SyncedInput value={scene.shot} onValue={(shot) => set({ shot })} placeholder="Medium close-up" />
          </Field>
          <Field label="Camera motion">
            <Select value={scene.motion} onChange={(e) => set({ motion: e.target.value as Motion }, 0)}>
              {MOTIONS.map((m) => (
                <option key={m} value={m}>
                  {MOTION_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transition in" hint="How this picture replaces the previous one.">
            <Select
              value={normalizeTransition(scene.transition)}
              onChange={(e) => set({ transition: e.target.value }, 0)}
            >
              {TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {TRANSITION_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          {characters.length > 0 && (
            <Field label="Characters in the picture" className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c) => {
                  const name = c.name || 'Unnamed'
                  const on = scene.characters.some((n) => n.toLowerCase() === name.toLowerCase())
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set(
                          {
                            characters: on
                              ? scene.characters.filter((n) => n.toLowerCase() !== name.toLowerCase())
                              : [...scene.characters, name],
                          },
                          0,
                        )
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[12.5px]',
                        on
                          ? 'border-ink bg-ink text-paper'
                          : 'border-line text-ink-2 hover:border-line-strong',
                      )}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            </Field>
          )}
          <Field label="On-screen text" hint="A few words shown at the top while the scene plays.">
            <SyncedInput
              value={scene.onScreenText}
              maxLength={200}
              onValue={(onScreenText) => set({ onScreenText })}
            />
          </Field>
          <Field label="Notes" hint="For you: a sound effect or music cue. Not used in the video.">
            <SyncedInput value={scene.notes} onValue={(notes) => set({ notes })} />
          </Field>
        </div>
      )}
    </li>
  )
}
