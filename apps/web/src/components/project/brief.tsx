'use client'

import { ART_STYLES } from '@cutroom/shared/types'
import { ArrowRight } from 'lucide-react'
import { Button, Field, Panel, Segmented, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useSaver } from '@/lib/hooks'
import { SyncedInput, SyncedTextarea } from './fields'
import type { StepProps } from './workspace'

const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['tl', 'Filipino'],
  ['id', 'Indonesian'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
]

export function BriefStep({ data, goTo }: StepProps) {
  const { project } = data
  const { saver } = useSaver(project.id)
  const portrait = project.format === 'portrait'
  const words = Math.round(project.targetMinutes * 60 * 2.5)

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <Panel
        title="What the video is about"
        description="Gemini reads this when it writes the script and the post details."
      >
        <div className="flex flex-col gap-5 px-5 py-5">
          <Field label="Topic" htmlFor="topic">
            <SyncedTextarea
              id="topic"
              value={project.topic}
              onValue={(topic) => saver.project({ topic })}
              placeholder="Why octopuses are smarter than we thought"
              className="min-h-24"
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Audience" htmlFor="audience" hint="Who is watching?">
              <SyncedInput
                id="audience"
                value={project.audience}
                onValue={(audience) => saver.project({ audience })}
                placeholder="Curious adults, no science background"
              />
            </Field>
            <Field label="Tone" htmlFor="tone">
              <SyncedInput
                id="tone"
                value={project.tone}
                onValue={(tone) => saver.project({ tone })}
                placeholder="Warm, playful, a little dramatic"
              />
            </Field>
          </div>
          <Field
            label="Notes for the script"
            htmlFor="notes"
            hint="Facts to include, a call to action, things to avoid."
          >
            <SyncedTextarea
              id="notes"
              value={project.notes}
              onValue={(notes) => saver.project({ notes })}
              className="min-h-20"
            />
          </Field>
          <Field label="Language" htmlFor="language" className="sm:max-w-60">
            <Select
              id="language"
              value={project.language}
              onChange={(e) => saver.project({ language: e.target.value }, 0)}
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel title="Shape">
          <div className="flex flex-col gap-5 px-5 py-5">
            <Field label="Format">
              <Segmented
                ariaLabel="Format"
                value={project.format}
                onChange={(format) => saver.project({ format }, 0)}
                options={[
                  { value: 'landscape', label: 'Video 16:9' },
                  { value: 'portrait', label: 'Short 9:16' },
                ]}
                className="w-full"
              />
            </Field>
            <Field
              label="Target length"
              aside={`about ${words.toLocaleString()} words`}
              hint="Only used when Gemini writes the script. Your voice-over sets the real length."
            >
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={portrait ? 0.25 : 1}
                  max={portrait ? 3 : 30}
                  step={portrait ? 0.25 : 1}
                  value={project.targetMinutes}
                  onChange={(e) => saver.project({ targetMinutes: Number(e.target.value) })}
                  className="w-full accent-ink"
                  aria-label="Target length in minutes"
                />
                <span className="tc w-16 text-right text-[14px] font-medium">
                  {project.targetMinutes < 1
                    ? `${Math.round(project.targetMinutes * 60)} s`
                    : `${project.targetMinutes} min`}
                </span>
              </div>
            </Field>
            <Field
              label="New image every"
              hint="Shorter keeps viewers watching. Each scene needs its own image."
            >
              <Segmented
                ariaLabel="Seconds per scene"
                value={String(project.pace)}
                onChange={(pace) => saver.project({ pace: Number(pace) }, 0)}
                options={['3', '4', '6', '8', '10'].map((v) => ({ value: v, label: `${v} s` }))}
                className="w-full"
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Look" description="Added to every image prompt so all scenes share one style.">
          <div className="flex flex-col gap-3 px-5 py-5">
            <SyncedInput
              aria-label="Art style"
              value={project.artStyle}
              onValue={(artStyle) => saver.project({ artStyle })}
              placeholder="Describe the art style"
            />
            <div className="flex flex-wrap gap-1.5">
              {ART_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => saver.project({ artStyle: style }, 0)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
                    project.artStyle === style
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                  )}
                >
                  {style.split(',')[0]}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <div className="flex justify-end">
          <Button variant="plain" onClick={() => goTo('characters')} icon={<ArrowRight className="size-4" />}>
            Characters
          </Button>
        </div>
      </div>
    </div>
  )
}
