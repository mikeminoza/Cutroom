'use client'

import { Check, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, CopyButton, Panel, Switch } from '@/components/ui'
import type { ProjectFull } from '@/lib/dto'
import { downloadScenePrompts, scenePrompts, scenePromptsText } from '@/lib/scene-prompts'

/**
 * The storyboard: every scene's time range, its narration and the prompt for its picture, so the
 * whole script can be read with its timing and the images made in any tool: copy one prompt,
 * copy them all, or download them.
 */
export function ScenePromptsPanel({
  data,
  timed,
  className,
}: {
  data: ProjectFull
  timed: boolean
  className?: string
}) {
  const entries = useMemo(() => scenePrompts(data), [data])
  const [missingOnly, setMissingOnly] = useState(false)
  const missing = entries.filter((entry) => !entry.hasImage).length
  const shown = missingOnly ? entries.filter((entry) => !entry.hasImage) : entries
  if (entries.length === 0) return null

  return (
    <Panel
      className={className}
      title="Storyboard"
      description={
        timed
          ? 'The whole script, scene by scene: when each picture shows, what is said, and the prompt to make the picture. Make each one in your image tool, then drop it on its scene in the Images step.'
          : 'The whole script, scene by scene: when each picture shows, what is said, and the prompt to make the picture. The times are estimates until the scenes are matched to the voice-over.'
      }
      actions={
        <>
          <CopyButton
            text={scenePromptsText(shown)}
            label={missingOnly ? `Copy ${shown.length}` : 'Copy all'}
            done="Copied"
          />
          <Button
            variant="plain"
            size="sm"
            disabled={shown.length === 0}
            onClick={() => downloadScenePrompts(data.project.title, shown)}
            icon={<Download className="size-3.5" />}
          >
            .txt
          </Button>
        </>
      }
    >
      {missing > 0 && missing < entries.length && (
        <div className="border-b border-line px-5 py-3">
          <div className="w-60">
            <Switch
              checked={missingOnly}
              onCheckedChange={setMissingOnly}
              label={`Only scenes without images (${missing})`}
            />
          </div>
        </div>
      )}
      <ol className="max-h-[40rem] overflow-y-auto">
        {shown.map((entry) => (
          <li
            key={entry.id}
            className="grid gap-x-5 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex-col sm:items-start">
              <span className="tc grid h-6 min-w-6 place-items-center rounded-[4px] bg-ink px-1 text-[12px] font-semibold text-paper">
                {entry.number}
              </span>
              <span className="tc text-[13.5px] font-medium">{entry.range}</span>
              {entry.hasImage ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-ok">
                  <Check className="size-3.5" aria-hidden />
                  Has a picture
                </span>
              ) : (
                <span className="text-[12.5px] text-ink-3">No picture yet</span>
              )}
            </div>
            <div className="min-w-0">
              {entry.narration.trim() && (
                <p className="text-[14px] leading-relaxed">“{entry.narration.trim()}”</p>
              )}
              <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-sunk px-3 py-2.5">
                <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{entry.prompt}</p>
                {entry.cast.length > 0 && (
                  <p className="mt-2 text-[12.5px] font-medium text-kodak-ink">
                    Attach reference images for: {entry.cast.join(', ')}
                  </p>
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <CopyButton text={entry.prompt} label="Copy prompt" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
