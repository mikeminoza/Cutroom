'use client'

import { type PostCheck, postChecks } from '@cutroom/shared/review'
import { totalDuration } from '@cutroom/shared/timing'
import { EMPTY_POST, hasPicture } from '@cutroom/shared/types'
import { Check, CircleAlert, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Panel } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectFull } from '@/lib/dto'
import { useSaver, useStatus } from '@/lib/hooks'
import type { StepId } from '@/lib/stage'

type Note = { level: 'good' | 'look' | 'fix'; text: string }

/** The checks for this project as it is now. */
export function finalChecks(data: ProjectFull): PostCheck[] {
  const { project, scenes } = data
  return postChecks({
    post: { ...EMPTY_POST, ...project.post },
    format: project.format,
    duration: project.voiceoverDuration ?? totalDuration(scenes),
    thumbnailUrl: project.thumbnailUrl,
    musicUrl: project.musicUrl,
    artStyle: project.artStyle,
    missingPictures: scenes.filter((s) => !hasPicture(s)).length,
  })
}

const ICON = {
  fix: { icon: X, className: 'bg-bad text-panel' },
  look: { icon: CircleAlert, className: 'bg-kodak text-on-kodak' },
  ok: { icon: Check, className: 'bg-ok text-panel' },
  good: { icon: Check, className: 'bg-ok text-panel' },
} as const

function Mark({ level }: { level: keyof typeof ICON }) {
  const { icon: Icon, className } = ICON[level]
  return (
    <span
      aria-hidden
      className={cn('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full', className)}
    >
      <Icon className="size-3" strokeWidth={3} />
    </span>
  )
}

/**
 * The final check before posting: what YouTube would refuse or do badly (fix), what usually costs
 * views or ad money (look), and what is fine, worked out from the post itself; plus an optional AI
 * read of whether the title, thumbnail, description and opening sell one video honestly.
 */
export function FinalCheck({ data, goTo }: { data: ProjectFull; goTo: (step: StepId) => void }) {
  const { project } = data
  const { saver } = useSaver(project.id)
  const { data: status } = useStatus()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [busy, setBusy] = useState(false)
  const checks = finalChecks(data)
  const fix = checks.filter((c) => c.level === 'fix').length
  const look = checks.filter((c) => c.level === 'look').length

  const review = async () => {
    await saver.flushAll()
    setBusy(true)
    try {
      setNotes((await api.post<{ notes: Note[] }>(`/api/projects/${project.id}/ai/packaging`)).notes)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="final-check" className="scroll-mt-6">
      <Panel
        title="Final check"
        description={
          fix || look
            ? `${[fix && `${fix} to fix`, look && `${look} to look at`].filter(Boolean).join(', ')}. Worth a minute before the video goes out.`
            : 'Everything checked looks right.'
        }
        actions={
          status?.gemini.configured !== false && (
            <Button
              variant="plain"
              size="sm"
              busy={busy}
              onClick={review}
              icon={<Sparkles className="size-3.5" />}
            >
              {notes ? 'Review again' : 'Review the packaging'}
            </Button>
          )
        }
      >
        <ul className="divide-y divide-line">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2.5 px-5 py-2.5 text-[13.5px]">
              <Mark level={check.level} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{check.title}</span>
                <span className="block text-[12.5px] leading-snug text-ink-2">{check.detail}</span>
              </span>
              {check.level !== 'ok' && check.step !== 'publish' && (
                <button
                  type="button"
                  onClick={() => goTo(check.step)}
                  className="text-[12.5px] font-medium underline underline-offset-4"
                >
                  Go there
                </button>
              )}
            </li>
          ))}
        </ul>
        {notes && (
          <section aria-label="Packaging review" className="border-t border-line px-5 py-3.5">
            <h3 className="text-[13px] font-semibold">Title, thumbnail and opening</h3>
            {notes.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-2">Nothing to add.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {notes.map((note) => (
                  <li key={note.text} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                    <Mark level={note.level} />
                    <span>{note.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </Panel>
    </div>
  )
}
