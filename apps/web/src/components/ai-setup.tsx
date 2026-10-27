'use client'

import type { ChannelSetupDraft } from '@cutroom/shared/ai'
import {
  type ChannelDetails,
  clockLabel,
  MARKETS,
  marketOf,
  presetSlots,
  scheduleLine,
  slotDays,
} from '@cutroom/shared/setup'
import { type AppSettings, YOUTUBE_CATEGORIES } from '@cutroom/shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ChannelDTO } from '@/lib/dto'
import { keys } from '@/lib/hooks'
import { Button, ButtonLink, Input, Panel, Textarea, type useConfirm } from './ui'

type Confirm = ReturnType<typeof useConfirm>['confirm']
type Key =
  | 'description'
  | 'keywords'
  | 'country'
  | 'trailer'
  | 'tags'
  | 'schedule'
  | 'footer'
  | 'category'
  | 'kids'

interface Proposal {
  key: Key
  where: 'youtube' | 'cutroom'
  title: string
  now: string
  why: string
  /** An editor or a preview of the new value. */
  body?: React.ReactNode
}

const SLOT_TIME = '15:00'
const categoryName = (id: string) => YOUTUBE_CATEGORIES.find((c) => c.id === id)?.name ?? `category ${id}`
const list = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '')

/**
 * "Set up with AI": one Gemini draft of the whole setup, shown as proposals to tick and edit.
 * Nothing changes until Apply, and the YouTube part only after a confirm.
 */
export function AiSetup({
  settings,
  channel,
  yt,
  geminiReady,
  confirm,
}: {
  settings: AppSettings
  channel: ChannelDTO | null
  yt: ChannelDetails | null
  geminiReady: boolean
  confirm: Confirm
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<ChannelSetupDraft | null>(null)
  const [busy, setBusy] = useState<'draft' | 'apply' | null>(null)
  const [picked, setPicked] = useState<Set<Key>>(new Set())
  const [description, setDescription] = useState('')
  const [keywords, setKeywords] = useState('')
  const [footer, setFooter] = useState<string | null>(null)

  const market = marketOf(settings.niche.market)
  const zone = market ?? MARKETS[0]
  const nicheReady = Boolean(settings.niche.description.trim())
  const { defaults } = settings

  const newSlots = draft ? presetSlots(draft.cadence.perWeek, SLOT_TIME) : []
  const footerSlots = picked.has('schedule') ? newSlots : settings.slots
  const footerText =
    footer ?? [scheduleLine(footerSlots), draft?.subscribeLine ?? ''].filter(Boolean).join('\n')

  const run = async () => {
    setBusy('draft')
    try {
      const next = await api.post<ChannelSetupDraft>('/api/setup/suggest', { channel: channel?.id })
      setDraft(next)
      setDescription(next.description)
      setKeywords(next.keywords.join(', '))
      setFooter(null)
      // What is already set up stays unticked: tick it to replace it.
      const alreadySet: Partial<Record<Key, boolean>> = {
        description: (yt?.description.trim().length ?? 0) >= 100,
        keywords: (yt?.keywords.length ?? 0) >= 3,
        footer: Boolean(defaults.descriptionFooter.trim()),
      }
      setPicked(
        new Set(
          proposalsFor(next)
            .filter((p) => !alreadySet[p.key])
            .map((p) => p.key),
        ),
      )
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  /** What the draft would change: only what differs from now, and YouTube only when connected. */
  function proposalsFor(d: ChannelSetupDraft): Proposal[] {
    const out: Proposal[] = []
    const slots = presetSlots(d.cadence.perWeek, SLOT_TIME)
    if (yt) {
      out.push({
        key: 'description',
        where: 'youtube',
        title: 'Channel description',
        now: yt.description.trim() ? `${yt.description.trim().length} characters` : 'none',
        why: 'Written from your channel niche. The first sentence is the one search shows.',
      })
      out.push({
        key: 'keywords',
        where: 'youtube',
        title: 'Channel keywords',
        now: yt.keywords.length ? yt.keywords.join(', ') : 'none',
        why: 'Search phrases for the channel as a whole.',
      })
      if (market && (yt.country !== market.code || !yt.defaultLanguage.startsWith(market.language))) {
        out.push({
          key: 'country',
          where: 'youtube',
          title: `Country ${market.label}, language English`,
          now: `${yt.country || 'no country'}, ${yt.defaultLanguage || 'no language'}`,
          why: 'From who your videos are for.',
        })
      }
      if (d.trailer && d.trailer.id !== yt.trailer) {
        out.push({
          key: 'trailer',
          where: 'youtube',
          title: `Channel trailer: ${d.trailer.title}`,
          now: yt.trailer ? 'another video' : 'none',
          why: d.trailer.why,
        })
      }
    }
    const newTags = d.tags.filter((t) => !defaults.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
    if (newTags.length) {
      out.push({
        key: 'tags',
        where: 'cutroom',
        title: `Add ${newTags.length} ${newTags.length === 1 ? 'tag' : 'tags'} to every video`,
        now: defaults.tags.length ? defaults.tags.join(', ') : 'none',
        why: 'Broad tags for the channel; each video still gets its own.',
      })
    }
    const sameSchedule =
      settings.timezone === zone.timezone &&
      settings.slots.length === slots.length &&
      slots.every((s) => settings.slots.some((x) => x.day === s.day && x.time === s.time))
    if (!sameSchedule) {
      out.push({
        key: 'schedule',
        where: 'cutroom',
        title: `${d.cadence.perWeek === 7 ? 'A video every day' : `${d.cadence.perWeek} videos a week`}: ${slotDays(slots, true)} at ${clockLabel(SLOT_TIME)} ${zone.zone}`,
        now: `${slotDays(settings.slots, true) || 'no slots'} (${settings.timezone})`,
        why: d.cadence.why,
      })
    }
    out.push({
      key: 'footer',
      where: 'cutroom',
      title: 'Description footer',
      now: defaults.descriptionFooter.trim() ? 'your current footer' : 'none',
      why: 'Under every description: when new videos come out and a reason to subscribe.',
    })
    if (d.category.id !== defaults.categoryId) {
      out.push({
        key: 'category',
        where: 'cutroom',
        title: `Category: ${categoryName(d.category.id)}`,
        now: categoryName(defaults.categoryId),
        why: d.category.why,
      })
    }
    if (d.madeForKids.value !== defaults.madeForKids) {
      out.push({
        key: 'kids',
        where: 'cutroom',
        title: d.madeForKids.value ? 'Uploads made for kids' : 'Uploads not made for kids',
        now: defaults.madeForKids ? 'made for kids' : 'not made for kids',
        why: d.madeForKids.why,
      })
    }
    return out
  }

  const proposals = draft ? proposalsFor(draft) : []
  const chosen = proposals.filter((p) => picked.has(p.key))
  const toggle = (key: Key) => {
    const next = new Set(picked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked(next)
  }

  const apply = async () => {
    if (!draft || chosen.length === 0) return
    const onYoutube = chosen.filter((p) => p.where === 'youtube')
    const inCutroom = chosen.filter((p) => p.where === 'cutroom')
    const parts = [
      inCutroom.length &&
        `${inCutroom.length} ${inCutroom.length === 1 ? 'Cutroom setting' : 'Cutroom settings'}`,
      onYoutube.length &&
        channel &&
        `${onYoutube.length} ${onYoutube.length === 1 ? 'change' : 'changes'} on ${channel.title} on YouTube`,
    ].filter((p): p is string => Boolean(p))
    const ok = await confirm({
      title: `Apply ${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'}?`,
      body: `Saves ${list(parts)}. Everything else stays as it is.`,
      action: 'Apply',
    })
    if (!ok) return
    setBusy('apply')
    const has = (key: Key) => picked.has(key) && proposals.some((p) => p.key === key)
    try {
      if (inCutroom.length) {
        const next: AppSettings = {
          ...settings,
          ...(has('schedule') ? { timezone: zone.timezone, slots: newSlots } : {}),
          defaults: {
            ...defaults,
            ...(has('tags') ? { tags: [...new Set([...defaults.tags, ...draft.tags])].slice(0, 30) } : {}),
            ...(has('footer') ? { descriptionFooter: footerText.trim() } : {}),
            ...(has('category') ? { categoryId: draft.category.id } : {}),
            ...(has('kids') ? { madeForKids: draft.madeForKids.value } : {}),
          },
        }
        const saved = await api.put<AppSettings>('/api/settings', next)
        client.setQueryData(keys.settings, saved)
        await client.invalidateQueries({ queryKey: keys.schedule })
      }
      if (onYoutube.length && channel) {
        const patch: Record<string, unknown> = { channel: channel.id }
        if (has('description')) patch.description = description.trim()
        if (has('keywords'))
          patch.keywords = keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        if (has('country') && market) {
          patch.country = market.code
          patch.defaultLanguage = market.language
        }
        if (has('trailer') && draft.trailer) patch.trailer = draft.trailer.id
        try {
          const now = await api.patch<ChannelDetails | null>('/api/channel', patch)
          client.setQueryData<{ details: ChannelDetails } | null>(keys.channel(channel.id), (prev) =>
            prev && now ? { ...prev, details: now } : prev,
          )
        } catch (error) {
          toast.error(
            inCutroom.length
              ? `Your Cutroom settings were saved, but YouTube refused the channel changes: ${errorText(error)}`
              : errorText(error),
          )
          return
        }
      }
      toast.success(`Applied ${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'}`)
      setDraft(null)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const editors: Partial<Record<Key, React.ReactNode>> = {
    description: (
      <Textarea
        aria-label="Channel description"
        rows={5}
        maxLength={1000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    ),
    keywords: (
      <Input aria-label="Channel keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
    ),
    tags: draft && (
      <div className="flex flex-wrap gap-1.5">
        {draft.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-line px-2.5 py-0.5 text-[12.5px] text-ink-2">
            {tag}
          </span>
        ))}
      </div>
    ),
    footer: (
      <Textarea
        aria-label="Description footer"
        rows={3}
        maxLength={2000}
        value={footerText}
        onChange={(e) => setFooter(e.target.value)}
      />
    ),
  }

  return (
    <Panel
      title="Set up with AI"
      description="Gemini reads your channel niche and drafts the whole setup: the channel's description, keywords and trailer on YouTube, and the schedule, footer, tags and upload settings in Cutroom. Pick what to keep; nothing changes until you apply it."
      actions={
        <Button
          variant={draft ? 'plain' : 'go'}
          size="sm"
          icon={<Sparkles className="size-3.5" />}
          busy={busy === 'draft'}
          disabled={!geminiReady || !nicheReady || busy === 'apply'}
          onClick={run}
        >
          {draft ? 'Draft again' : 'Draft the setup'}
        </Button>
      }
    >
      {!geminiReady || !nicheReady ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">
          {!geminiReady ? 'Add GEMINI_API_KEY to use this. ' : ''}
          {!nicheReady && (
            <>
              Describe your channel first: the draft is written from it.{' '}
              <ButtonLink href="/settings#niche" size="sm" variant="ghost">
                Channel niche
              </ButtonLink>
            </>
          )}
        </p>
      ) : !draft ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">
          {channel
            ? `Takes about half a minute. Drafts for ${channel.title}${market ? `, written for viewers in ${market.name}` : ''}.`
            : 'Connect YouTube in Settings to include the channel itself; the Cutroom settings can be drafted without it.'}
          {!market && ' Choose who your videos are for below first, so posting times use their clock.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {proposals.map((p) => {
              const on = picked.has(p.key)
              const editor = editors[p.key]
              return (
                <li key={p.key} className={cn('px-5 py-3.5', !on && 'opacity-60')}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.key)}
                      className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold">{p.title}</span>
                        <span className="rounded-full border border-line px-2 py-[1px] text-[11.5px] text-ink-3">
                          {p.where === 'youtube' ? 'On YouTube' : 'In Cutroom'}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">
                        {p.why} <span className="text-ink-3">Now: {p.now}.</span>
                      </span>
                    </span>
                  </label>
                  {editor && on && <div className="mt-2.5 sm:pl-7">{editor}</div>}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={busy === 'apply'}>
              Discard
            </Button>
            <Button
              variant="go"
              size="sm"
              busy={busy === 'apply'}
              disabled={chosen.length === 0}
              onClick={apply}
            >
              Apply {chosen.length} {chosen.length === 1 ? 'change' : 'changes'}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
