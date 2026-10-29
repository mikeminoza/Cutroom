'use client'

import type { HookCheck, ScriptClaim, ScriptEdit } from '@cutroom/shared/ai'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Mic, Sparkles, Stethoscope, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Panel, Segmented } from '@/components/ui'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectFull } from '@/lib/dto'
import { keys, useSaver, useStatus } from '@/lib/hooks'

const KIND: Record<ScriptEdit['kind'], string> = {
  funnier: 'Funnier',
  tighter: 'Tighter',
  clearer: 'Clearer',
  cut: 'Cut',
}

const VERDICT: Record<ScriptClaim['verdict'], { label: string; className: string }> = {
  ok: { label: 'Looks right', className: 'bg-ok-wash text-ok' },
  check: { label: 'Check this', className: 'bg-kodak-wash text-kodak-ink' },
  wrong: { label: 'Likely wrong', className: 'bg-bad-wash text-bad' },
}

type Review = { edits: ScriptEdit[]; claims: ScriptClaim[] }

/** "Changed in the script and scenes 3 and 4." */
function changedWhere(edit: { script: boolean; scenes: number[] }, hasScenes: boolean): string {
  const scenes = edit.scenes
  const sceneText = scenes.length
    ? `${scenes.length === 1 ? 'scene' : 'scenes'} ${scenes.length > 1 ? `${scenes.slice(0, -1).join(', ')} and ${scenes.at(-1)}` : scenes[0]}`
    : ''
  if (edit.script && sceneText) return `Changed in the script and ${sceneText}.`
  if (sceneText) return `Changed in ${sceneText}.`
  return hasScenes
    ? 'Changed in the script. It spans two scenes, so edit them under Scenes, or split again.'
    : 'Changed in the script.'
}

/**
 * The script doctor: Gemini reads the script like an editor. "Check the hook" rates the first 15
 * seconds and offers three stronger openings; "Punch up and check facts" suggests funnier, tighter
 * lines in the narrator's voice and flags claims to check. Nothing changes until a suggestion is
 * accepted, and then it changes in the script and in the scenes that hold the words.
 */
export function ScriptDoctor({ data }: { data: ProjectFull }) {
  const { project, scenes } = data
  const client = useQueryClient()
  const { saver } = useSaver(project.id)
  const { data: status } = useStatus()
  const [busy, setBusy] = useState<'hook' | 'review' | null>(null)
  const [hook, setHook] = useState<HookCheck | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [tab, setTab] = useState<'edits' | 'claims'>('edits')
  const [applying, setApplying] = useState<string | null>(null)
  const ready = status?.gemini.configured !== false
  const hasScript = Boolean(project.script.trim() || scenes.some((s) => s.narration.trim()))

  const run = async (kind: 'hook' | 'review') => {
    await saver.flushAll()
    setBusy(kind)
    try {
      if (kind === 'hook') setHook(await api.post<HookCheck>(`/api/projects/${project.id}/ai/hook`))
      else {
        const next = await api.post<Review>(`/api/projects/${project.id}/ai/review`)
        setReview(next)
        setTab(next.edits.length ? 'edits' : 'claims')
      }
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  /** Puts `replacement` where `original` is, in the script and its scenes. */
  const accept = async (key: string, original: string, replacement: string): Promise<boolean> => {
    setApplying(key)
    try {
      await saver.flushAll()
      const { edit, ...full } = await api.post<ProjectFull & { edit: { script: boolean; scenes: number[] } }>(
        `/api/projects/${project.id}/script-edit`,
        { original, replacement },
      )
      client.setQueryData(keys.project(project.id), full)
      toast.success(changedWhere(edit, scenes.length > 0))
      return true
    } catch (error) {
      toast.error(errorText(error))
      return false
    } finally {
      setApplying(null)
    }
  }

  const dropEdit = (original: string) =>
    setReview((r) => (r ? { ...r, edits: r.edits.filter((e) => e.original !== original) } : r))
  const dropClaim = (quote: string) =>
    setReview((r) => (r ? { ...r, claims: r.claims.filter((c) => c.quote !== quote) } : r))

  return (
    <Panel
      title="Script doctor"
      description="Gemini reads the script like an editor: the opening, the jokes and the facts. Nothing changes until you accept a suggestion."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="plain"
            size="sm"
            busy={busy === 'hook'}
            disabled={!ready || !hasScript || busy !== null}
            onClick={() => run('hook')}
            icon={<Sparkles className="size-3.5" />}
          >
            Check the hook
          </Button>
          <Button
            variant="plain"
            size="sm"
            busy={busy === 'review'}
            disabled={!ready || !hasScript || busy !== null}
            onClick={() => run('review')}
            icon={<Stethoscope className="size-3.5" />}
          >
            Punch up and check facts
          </Button>
        </div>
      }
    >
      {!ready ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">Add GEMINI_API_KEY to use the script doctor.</p>
      ) : !hook && !review ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">
          {hasScript
            ? 'Most viewers who leave do it in the first 30 seconds: check the hook first. The punch-up rewrites flat lines in your narrator’s voice and flags health and science claims to check, since YouTube removes medical misinformation.'
            : 'Write or paste the script first.'}
        </p>
      ) : null}
      {project.voiceoverUrl && (hook || review) && (
        <p className="flex items-center gap-2 border-b border-line bg-kodak-wash px-5 py-2.5 text-[13px] text-kodak-ink">
          <Mic className="size-3.5 shrink-0" aria-hidden />
          The voice-over is already recorded: changes you accept are only heard once it is recorded again.
        </p>
      )}

      {hook && (
        <section aria-label="The hook" className="flex flex-col gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'tc grid size-11 shrink-0 place-items-center rounded-full text-[17px] font-semibold',
                hook.score >= 8
                  ? 'bg-ok-wash text-ok'
                  : hook.score >= 6
                    ? 'bg-kodak-wash text-kodak-ink'
                    : 'bg-bad-wash text-bad',
              )}
              title="How well the opening hooks a new viewer, out of 10"
            >
              {hook.score}
            </span>
            <div className="min-w-0 text-[13.5px]">
              <p className="font-medium">{hook.verdict}</p>
              {hook.problems.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-ink-2">
                  {hook.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <p
                className={cn('mt-1.5 flex items-start gap-1.5', hook.promise.kept ? 'text-ok' : 'text-bad')}
              >
                {hook.promise.kept ? (
                  <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                )}
                <span>
                  {hook.promise.kept
                    ? 'Pays off the title and thumbnail. '
                    : 'Doesn’t pay off the title yet. '}
                  <span className="text-ink-2">{hook.promise.note}</span>
                </span>
              </p>
            </div>
          </div>
          {hook.replaces && (
            <p className="text-[12.5px] text-ink-3">
              Opening now: <span className="text-ink-2">“{hook.replaces}”</span>
            </p>
          )}
          <ol className="grid gap-2.5 md:grid-cols-3">
            {hook.openings.map((opening, i) => (
              <li
                key={opening.text}
                className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line px-3.5 py-3"
              >
                <p className="text-[13.5px] leading-snug">{opening.text}</p>
                <p className="text-[12.5px] leading-snug text-ink-3">{opening.why}</p>
                <Button
                  variant="plain"
                  size="sm"
                  className="mt-auto self-start"
                  busy={applying === `opening-${i}`}
                  disabled={!hook.replaces || opening.text === hook.replaces}
                  onClick={async () => {
                    if (await accept(`opening-${i}`, hook.replaces, opening.text))
                      setHook({ ...hook, replaces: opening.text })
                  }}
                >
                  {opening.text === hook.replaces ? 'In the script' : 'Use this opening'}
                </Button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {review && (
        <section aria-label="Punch-ups and facts" className="flex flex-col gap-3 px-5 py-4">
          <Segmented<'edits' | 'claims'>
            ariaLabel="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'edits', label: `Punch-ups (${review.edits.length})` },
              {
                value: 'claims',
                label: `Facts (${review.claims.filter((c) => c.verdict !== 'ok').length} to check)`,
              },
            ]}
            className="self-start"
          />
          {tab === 'edits' &&
            (review.edits.length === 0 ? (
              <p className="text-[13.5px] text-ink-2">Nothing left to punch up.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {review.edits.map((edit) => (
                  <li
                    key={edit.original}
                    className="rounded-[var(--radius-control)] border border-line px-3.5 py-3"
                  >
                    <p className="text-[12.5px] text-ink-3">
                      <span className="mr-1.5 rounded-full bg-sunk px-2 py-0.5 font-medium text-ink-2">
                        {KIND[edit.kind]}
                      </span>
                      {edit.why}
                    </p>
                    <p className="mt-2 text-[13.5px] text-ink-3 line-through decoration-ink-3/60">
                      “{edit.original}”
                    </p>
                    <p className="mt-1 text-[14px]">
                      {edit.suggestion ? `“${edit.suggestion}”` : <span className="text-ink-3">(cut)</span>}
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        variant="plain"
                        size="sm"
                        busy={applying === edit.original}
                        onClick={async () => {
                          if (await accept(edit.original, edit.original, edit.suggestion))
                            dropEdit(edit.original)
                        }}
                        icon={<Check className="size-3.5" />}
                      >
                        Accept
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => dropEdit(edit.original)}>
                        Skip
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          {tab === 'claims' &&
            (review.claims.length === 0 ? (
              <p className="text-[13.5px] text-ink-2">No factual claims to check.</p>
            ) : (
              <>
                <p className="text-[12.5px] text-ink-3">
                  Gemini can be wrong too: look up anything marked “Check this” before you post.
                </p>
                <ul className="flex flex-col gap-2.5">
                  {review.claims.map((claim) => (
                    <li
                      key={claim.quote}
                      className="rounded-[var(--radius-control)] border border-line px-3.5 py-3"
                    >
                      <p className="text-[12.5px] text-ink-2">
                        <span
                          className={cn(
                            'mr-1.5 rounded-full px-2 py-0.5 font-medium',
                            VERDICT[claim.verdict].className,
                          )}
                        >
                          {VERDICT[claim.verdict].label}
                        </span>
                        {claim.note}
                      </p>
                      <p className="mt-2 text-[13.5px]">“{claim.quote}”</p>
                      {claim.safer && (
                        <p className="mt-1 text-[13.5px] text-ink-2">
                          Safer: <span className="text-ink">“{claim.safer}”</span>
                        </p>
                      )}
                      <div className="mt-2.5 flex gap-2">
                        {claim.safer && (
                          <Button
                            variant="plain"
                            size="sm"
                            busy={applying === claim.quote}
                            onClick={async () => {
                              if (await accept(claim.quote, claim.quote, claim.safer)) dropClaim(claim.quote)
                            }}
                          >
                            Use the safer wording
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => dropClaim(claim.quote)}>
                          {claim.verdict === 'ok' ? 'OK' : 'Keep as it is'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </section>
      )}
    </Panel>
  )
}
