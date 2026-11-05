'use client'

// The checklist rows of Channel setup and Grow the channel, and the ticks for the steps only
// YouTube Studio can do (kept in settings.setup.done, shared by both pages).
import type { AppSettings } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { keys } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { Button, StatusPill } from './ui'

export type TipState = 'done' | 'todo' | 'auto' | 'info'

const STATE: Record<TipState, { tone: Tone; label: string }> = {
  done: { tone: 'ok', label: 'Done' },
  auto: { tone: 'ok', label: 'Cutroom does this' },
  todo: { tone: 'you', label: 'To do' },
  info: { tone: 'idle', label: 'Good to know' },
}

export interface TipItem {
  id: string
  title: string
  state: TipState
  body: React.ReactNode
  action?: React.ReactNode
  /** Shown under the tip, full width: a picker. */
  extra?: React.ReactNode
}

/** `anchored`: the row is a link target, #<item id>. */
export function TipRow({ item, anchored = false }: { item: TipItem; anchored?: boolean }) {
  const state = STATE[item.state]
  return (
    <li
      id={anchored ? item.id : undefined}
      className="grid scroll-mt-6 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[14.5px] font-semibold">{item.title}</h3>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
        <div className="mt-1.5 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-2">{item.body}</div>
      </div>
      {item.action && <div className="flex flex-wrap items-start gap-2 sm:justify-end">{item.action}</div>}
      {item.extra && <div className="sm:col-span-2">{item.extra}</div>}
    </li>
  )
}

/** Steps ticked off by hand, and a "Mark as done" button for each. */
export function useTicks(settings: AppSettings | undefined) {
  const client = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const ticked = new Set(settings?.setup.done ?? [])

  const toggle = async (id: string) => {
    if (!settings) return
    const undo = ticked.has(id)
    setBusy(id)
    try {
      const done = undo ? [...ticked].filter((t) => t !== id) : [...ticked, id]
      const saved = await api.put<AppSettings>('/api/settings', { ...settings, setup: { done } })
      client.setQueryData(keys.settings, saved)
      toast.success(undo ? 'Marked as still to do' : 'Marked as done')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const button = (id: string) => (
    <Button
      size="sm"
      variant={ticked.has(id) ? 'ghost' : 'plain'}
      busy={busy === id}
      onClick={() => toggle(id)}
    >
      {ticked.has(id) ? 'Undo' : 'Mark as done'}
    </Button>
  )

  return { ticked, button }
}
