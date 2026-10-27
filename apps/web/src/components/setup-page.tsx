'use client'

import {
  CADENCES,
  type Cadence,
  type ChannelDetails,
  clockLabel,
  footerTemplate,
  MARKETS,
  marketOf,
  presetSlots,
  slotDays,
} from '@cutroom/shared/setup'
import type { AppSettings, PostingSlot } from '@cutroom/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import { keys, useSettings, useStatus } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { AiSetup } from './ai-setup'
import {
  Button,
  ButtonLink,
  Input,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  StatusPill,
  Textarea,
  useConfirm,
} from './ui'

type State = 'done' | 'todo' | 'auto' | 'info'

const STATE: Record<State, { tone: Tone; label: string }> = {
  done: { tone: 'ok', label: 'Done' },
  auto: { tone: 'ok', label: 'Cutroom does this' },
  todo: { tone: 'you', label: 'To do' },
  info: { tone: 'idle', label: 'Good to know' },
}

interface TipItem {
  id: string
  title: string
  state: State
  body: React.ReactNode
  action?: React.ReactNode
  /** Shown under the tip, full width: an editor or a picker. */
  extra?: React.ReactNode
}

interface Section {
  title: string
  description?: string
  items: TipItem[]
}

/** What Gemini drafts from the niche (see /api/setup/suggest). */
interface Draft {
  description: string
  keywords: string[]
  tags: string[]
}

/** Categories that suit explainer and comedy channels. YouTube's own ids. */
const CATEGORIES = [
  { id: '27', name: 'Education' },
  { id: '24', name: 'Entertainment' },
  { id: '23', name: 'Comedy' },
]

const STUDIO = 'https://studio.youtube.com/'
const SLOT_TIME = '15:00'
const external = { target: '_blank', rel: 'noreferrer' } as const

function slotSummary(slots: PostingSlot[], timezone: string): string {
  if (slots.length === 0) return 'no posting slots'
  const times = [...new Set(slots.map((s) => clockLabel(s.time)))]
  return `${slotDays(slots, true)} at ${times.join(' / ')} (${timezone})`
}

export function SetupPage() {
  const { data: settings } = useSettings()
  const { data: status } = useStatus()
  const client = useQueryClient()
  const { confirm, element: confirmDialog } = useConfirm()
  const [channelId, setChannelId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [cadence, setCadence] = useState<Cadence>(3)
  const [footer, setFooter] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tagPicks, setTagPicks] = useState<string[] | null>(null)
  const [about, setAbout] = useState<{ description: string; keywords: string } | null>(null)

  const channels = status?.channels ?? []
  const channel =
    channels.find((c) => c.id === channelId) ?? channels.find((c) => c.isDefault) ?? channels[0] ?? null
  const youtube = useQuery({
    queryKey: keys.channelSetup(channel?.id ?? null),
    queryFn: () =>
      api.get<ChannelDetails | null>(`/api/setup/youtube?channel=${encodeURIComponent(channel?.id ?? '')}`),
    enabled: Boolean(channel),
    retry: false,
  })
  const yt = youtube.data ?? null

  if (!settings) {
    return (
      <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
        <div className="h-96 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />
      </div>
    )
  }

  const market = marketOf(settings.niche.market) ?? MARKETS[0]
  const geminiReady = status?.gemini.configured === true
  const ticked = new Set(settings.setup.done)
  const { defaults } = settings

  const save = async (next: AppSettings, message: string, key: string): Promise<boolean> => {
    setBusy(key)
    try {
      const saved = await api.put<AppSettings>('/api/settings', next)
      client.setQueryData(keys.settings, saved)
      await client.invalidateQueries({ queryKey: keys.schedule })
      toast.success(message)
      return true
    } catch (error) {
      toast.error(errorText(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  const toggleTick = (id: string) =>
    save(
      {
        ...settings,
        setup: { done: ticked.has(id) ? [...ticked].filter((t) => t !== id) : [...ticked, id] },
      },
      ticked.has(id) ? 'Marked as still to do' : 'Marked as done',
      id,
    )

  /** Changes the channel on YouTube after showing exactly what changes. */
  const updateYoutube = async (
    key: string,
    patch: { country?: string; defaultLanguage?: string; description?: string; keywords?: string[] },
    what: string,
  ): Promise<boolean> => {
    if (!channel) return false
    const ok = await confirm({
      title: `Update ${channel.title} on YouTube?`,
      body: `${what} Nothing else on the channel changes.`,
      action: 'Update channel',
    })
    if (!ok) return false
    setBusy(key)
    try {
      const next = await api.patch<ChannelDetails | null>('/api/setup/youtube', {
        channel: channel.id,
        ...patch,
      })
      client.setQueryData(keys.channelSetup(channel.id), next)
      await client.invalidateQueries({ queryKey: keys.channel(channel.id) })
      toast.success('Channel updated on YouTube')
      return true
    } catch (error) {
      toast.error(errorText(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  /** One Gemini draft feeds both the tags and the channel description. */
  const suggest = async (target: 'tags' | 'about') => {
    let result = draft
    if (!result) {
      setBusy(`suggest-${target}`)
      try {
        result = await api.post<Draft>('/api/setup/suggest', { channel: channel?.id })
        setDraft(result)
      } catch (error) {
        toast.error(errorText(error))
        return
      } finally {
        setBusy(null)
      }
    }
    if (target === 'tags') setTagPicks(result.tags)
    else setAbout({ description: result.description, keywords: result.keywords.join(', ') })
  }

  const applyMarket = (code: string) => {
    const next = marketOf(code)
    return save(
      {
        ...settings,
        niche: { ...settings.niche, market: code },
        defaults: { ...defaults, language: next?.language ?? defaults.language },
      },
      next ? `Writing for viewers in ${next.name}` : 'Target audience cleared',
      'market',
    )
  }

  const applySchedule = async () => {
    const slots = presetSlots(cadence, SLOT_TIME)
    const ok = await confirm({
      title: 'Replace your posting slots?',
      body: `Your ${settings.slots.length} slots become ${slotDays(slots, true)} at ${clockLabel(SLOT_TIME)} ${market.zone} (${market.timezone}). Videos already scheduled keep their times.`,
      action: 'Use this schedule',
    })
    if (ok)
      await save({ ...settings, timezone: market.timezone, slots }, 'Posting schedule updated', 'schedule')
  }

  const applyAbout = async () => {
    if (!about) return
    const keywords = about.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    const ok = await updateYoutube(
      'about',
      { description: about.description.trim(), keywords },
      'Replaces the channel description and keywords with the ones you edited.',
    )
    if (ok) setAbout(null)
  }

  const studioLink = (
    <ButtonLink
      href={STUDIO}
      size="sm"
      variant="ghost"
      icon={<ExternalLink className="size-3.5" />}
      {...external}
    >
      YouTube Studio
    </ButtonLink>
  )
  const manual = (id: string, link: React.ReactNode = studioLink) => (
    <>
      {link}
      <Button
        size="sm"
        variant={ticked.has(id) ? 'ghost' : 'plain'}
        busy={busy === id}
        onClick={() => toggleTick(id)}
      >
        {ticked.has(id) ? 'Undo' : 'Mark as done'}
      </Button>
    </>
  )
  const connectLink = (
    <ButtonLink href="/settings" size="sm">
      Connect YouTube
    </ButtonLink>
  )
  const suggestButton = (target: 'tags' | 'about') => (
    <Button
      size="sm"
      icon={<Sparkles className="size-3.5" />}
      busy={busy === `suggest-${target}`}
      disabled={!geminiReady || busy?.startsWith('suggest')}
      title={geminiReady ? undefined : 'Add GEMINI_API_KEY to use this'}
      onClick={() => suggest(target)}
    >
      Draft with AI
    </Button>
  )

  const countryDone = Boolean(
    yt && yt.country === market.code && yt.defaultLanguage.startsWith(market.language),
  )
  const scheduleDone = settings.timezone === market.timezone && settings.slots.length >= 2
  const aboutDone = Boolean(yt && yt.description.trim().length >= 100 && yt.keywords.length >= 3)
  const categoryDone = CATEGORIES.some((c) => c.id === defaults.categoryId)
  const verified = yt?.longUploads === 'allowed' || ticked.has('verify')
  const reference = settings.niche.reference ?? null
  const picks = tagPicks ?? []

  const sections: Section[] = [
    {
      title: 'Audience and language',
      items: [
        {
          id: 'market',
          title: 'Who your videos are for',
          state: settings.niche.market ? 'done' : 'todo',
          body: settings.niche.market
            ? `Scripts, titles, descriptions and ideas are written for viewers in ${market.name}: ${market.writing}.`
            : 'Pick the country you make videos for. Scripts, titles, descriptions and ideas are then written for it: spelling, units and references.',
          action: (
            <Select
              aria-label="Target audience"
              value={settings.niche.market}
              disabled={busy === 'market'}
              onChange={(e) => applyMarket(e.target.value)}
              className="w-52"
            >
              <option value="">Choose a country</option>
              {MARKETS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </Select>
          ),
        },
        {
          id: 'channel-country',
          title: `Channel country: ${market.label}`,
          state: countryDone ? 'done' : 'todo',
          body: `Your channel's country and language on YouTube${
            yt ? ` (now ${yt.country || 'not set'}, ${yt.defaultLanguage || 'no language'})` : ''
          }. It doesn't limit who can watch; YouTube uses it for things like Partner Program eligibility and the channel's details.`,
          action: !channel
            ? connectLink
            : !countryDone && (
                <Button
                  size="sm"
                  busy={busy === 'channel-country'}
                  disabled={!yt}
                  onClick={() =>
                    updateYoutube(
                      'channel-country',
                      { country: market.code, defaultLanguage: market.language },
                      `Sets the country to ${market.label} and the default language to English.`,
                    )
                  }
                >
                  Update on YouTube
                </Button>
              ),
        },
      ],
    },
    {
      title: 'Posting schedule',
      items: [
        {
          id: 'schedule',
          title: `The same times every week, on ${market.zone}`,
          state: scheduleDone ? 'done' : 'todo',
          body: (
            <>
              Now: {slotSummary(settings.slots, settings.timezone)}. Videos upload early and YouTube makes
              them public at the slot time, so set the slots on your viewers' clock. Sticking to the same days
              matters more than the exact hour: in a study of 40 million US uploads, weekends did only a few
              percent better and the upload hour barely changed 30-day views.
            </>
          ),
          extra: (
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<string>
                ariaLabel="Videos a week"
                value={String(cadence)}
                onChange={(value) => setCadence(Number(value) as Cadence)}
                options={CADENCES.map((n) => ({
                  value: String(n),
                  label: n === 7 ? 'Daily' : `${n} a week`,
                }))}
              />
              <span className="text-[13px] text-ink-3">
                {slotDays(presetSlots(cadence), true)} at {clockLabel(SLOT_TIME)} {market.zone}
              </span>
              <Button size="sm" busy={busy === 'schedule'} onClick={applySchedule}>
                Use this schedule
              </Button>
            </div>
          ),
        },
        {
          id: 'shorts',
          title: 'Shorts from every long video',
          state: settings.shorts.count > 0 ? 'done' : 'todo',
          body: 'Shorts bring in new viewers. After each long video posts, Cutroom drafts Shorts from its best moments for you to check.',
          action: (
            <ButtonLink href="/settings#shorts" size="sm">
              Shorts settings
            </ButtonLink>
          ),
        },
        {
          id: 'studio-times',
          title: 'Check when your viewers are online',
          state: ticked.has('studio-times') ? 'done' : 'todo',
          body: 'Once the channel has viewers, YouTube Studio → Analytics → Audience shows when they are on YouTube. Move your slots to an hour or two before the busiest time.',
          action: manual('studio-times'),
        },
      ],
    },
    {
      title: 'Titles and thumbnails',
      items: [
        {
          id: 'titles',
          title: 'Short titles with the hook up front',
          state: 'auto',
          body: "The AI writes titles of at most 60 characters with the hook in the first 40, so phones don't cut off the part that makes people click: honest curiosity, no ALL CAPS, no emoji. It learns from your most-viewed titles as the channel grows.",
        },
        {
          id: 'reference',
          title: 'Learn from a channel in your niche',
          state: reference ? 'done' : 'todo',
          body: reference
            ? `Following ${reference.title}: its most-viewed titles guide new titles and ideas until your channel has views of its own.`
            : 'Pick a successful channel like yours. Until yours has views of its own, its most-viewed titles guide new titles and ideas.',
          action: (
            <ButtonLink href="/settings#niche" size="sm">
              Channel niche
            </ButtonLink>
          ),
        },
        {
          id: 'thumbnails',
          title: 'Thumbnails with a face and 2–4 big words',
          state: 'auto',
          body: "On the Publish step, the thumbnail maker puts your character's pose, with a clear expression, over a background, plus a few big words that add to the title instead of repeating it.",
        },
      ],
    },
    {
      title: 'Descriptions and tags',
      items: [
        {
          id: 'footer',
          title: 'A footer on every description',
          state: defaults.descriptionFooter.trim() ? 'done' : 'todo',
          body: "Goes under each video's description and chapters: when new videos come out and a reason to subscribe. Each video still gets its own description, chapters and 3 hashtags.",
          action: footer === null && (
            <Button
              size="sm"
              onClick={() => setFooter(defaults.descriptionFooter.trim() || footerTemplate(settings.slots))}
            >
              {defaults.descriptionFooter.trim() ? 'Edit footer' : 'Draft footer'}
            </Button>
          ),
          extra: footer !== null && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Description footer"
                rows={4}
                maxLength={2000}
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="go"
                  busy={busy === 'footer'}
                  onClick={async () => {
                    const ok = await save(
                      { ...settings, defaults: { ...defaults, descriptionFooter: footer.trim() } },
                      'Footer saved',
                      'footer',
                    )
                    if (ok) setFooter(null)
                  }}
                >
                  Save footer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFooter(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ),
        },
        {
          id: 'tags',
          title: 'A few tags for every video',
          state: defaults.tags.length >= 3 ? 'done' : 'todo',
          body: (
            <>
              {defaults.tags.length > 0 && `Now: ${defaults.tags.join(', ')}. `}
              Tags help YouTube only a little, mostly with misspellings of your topic; titles, thumbnails and
              the first line of the description matter far more. Each video also gets 10–15 tags of its own.
            </>
          ),
          action: tagPicks === null && suggestButton('tags'),
          extra: tagPicks !== null && draft && (
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.tags.map((tag) => {
                const on = picks.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTagPicks(on ? picks.filter((t) => t !== tag) : [...picks, tag])}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
                      on ? 'border-ink bg-ink text-paper' : 'border-line text-ink-2 hover:border-ink-3',
                    )}
                  >
                    {tag}
                  </button>
                )
              })}
              <Button
                size="sm"
                variant="go"
                className="ml-1"
                disabled={picks.length === 0}
                busy={busy === 'tags'}
                onClick={async () => {
                  const tags = [...new Set([...defaults.tags, ...picks])].slice(0, 30)
                  const ok = await save(
                    { ...settings, defaults: { ...defaults, tags } },
                    'Tags saved',
                    'tags',
                  )
                  if (ok) setTagPicks(null)
                }}
              >
                Add {picks.length} {picks.length === 1 ? 'tag' : 'tags'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTagPicks(null)}>
                Cancel
              </Button>
            </div>
          ),
        },
        {
          id: 'about',
          title: 'Channel description and keywords on YouTube',
          state: aboutDone ? 'done' : 'todo',
          body: (
            <>
              {yt &&
                `Now: ${yt.description.trim() ? `${yt.description.trim().length} characters` : 'no description'}, ${yt.keywords.length} ${yt.keywords.length === 1 ? 'keyword' : 'keywords'}. `}
              The About text tells viewers and YouTube what the channel is. Say plainly in the first sentence
              what viewers get, in the words people search for.
            </>
          ),
          action: !channel
            ? connectLink
            : about === null && (
                <>
                  {suggestButton('about')}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!yt}
                    onClick={() =>
                      yt && setAbout({ description: yt.description, keywords: yt.keywords.join(', ') })
                    }
                  >
                    Edit
                  </Button>
                </>
              ),
          extra: about !== null && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Channel description"
                rows={6}
                maxLength={1000}
                value={about.description}
                onChange={(e) => setAbout({ ...about, description: e.target.value })}
              />
              <Input
                aria-label="Channel keywords"
                placeholder="Keywords, separated by commas"
                value={about.keywords}
                onChange={(e) => setAbout({ ...about, keywords: e.target.value })}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="go" busy={busy === 'about'} onClick={applyAbout}>
                  Update on YouTube
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAbout(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ),
        },
      ],
    },
    {
      title: 'Upload settings',
      items: [
        {
          id: 'category',
          title: 'A category that fits',
          state: categoryDone ? 'done' : 'todo',
          body: 'Explainers fit Education; videos that are mostly jokes fit Entertainment or Comedy. It helps YouTube place your videos next to similar ones.',
          action: (
            <Segmented<string>
              ariaLabel="Category"
              value={categoryDone ? defaults.categoryId : ''}
              onChange={(categoryId) =>
                save(
                  { ...settings, defaults: { ...defaults, categoryId } },
                  `Category set to ${CATEGORIES.find((c) => c.id === categoryId)?.name}`,
                  'category',
                )
              }
              options={CATEGORIES.map((c) => ({ value: c.id, label: c.name }))}
            />
          ),
        },
        {
          id: 'kids',
          title: 'Not made for kids',
          state: defaults.madeForKids ? 'todo' : 'done',
          body: "A cartoon look doesn't make a video made for kids: say No unless children are your audience. Made-for-kids videos lose comments, the notification bell and personalised ads. Set the same for the whole channel in YouTube Studio → Settings → Channel → Advanced settings.",
          action: defaults.madeForKids && (
            <Button
              size="sm"
              busy={busy === 'kids'}
              onClick={() =>
                save(
                  { ...settings, defaults: { ...defaults, madeForKids: false } },
                  'Set to not made for kids',
                  'kids',
                )
              }
            >
              Set to No
            </Button>
          ),
        },
        {
          id: 'captions',
          title: 'A caption track on every upload',
          state: 'auto',
          body: 'Cutroom uploads captions timed to the voice-over with each video, for people who watch muted and for search.',
        },
      ],
    },
    {
      title: 'On YouTube',
      description: "YouTube's API can't do these, so they are done in YouTube Studio. Tick them off here.",
      items: [
        {
          id: 'verify',
          title: 'Verify your account',
          state: verified ? 'done' : 'todo',
          body: `Custom thumbnails need it (Cutroom uploads one with each video), and so do videos over 15 minutes. It takes a phone number.${yt ? ' Cutroom checks this for you.' : ''}`,
          action: !verified && (
            <>
              <ButtonLink
                href="https://www.youtube.com/verify"
                size="sm"
                icon={<ExternalLink className="size-3.5" />}
                {...external}
              >
                Verify on YouTube
              </ButtonLink>
              {!yt && manual('verify', null)}
            </>
          ),
        },
        {
          id: 'branding',
          title: 'Profile picture, banner and handle',
          state: ticked.has('branding') ? 'done' : 'todo',
          body: "Use your main character's face for the profile picture so it's recognisable when tiny, and a banner that says what the channel is about and when new videos come out.",
          action: manual('branding'),
        },
        {
          id: 'end-screen',
          title: 'An end screen on every video',
          state: ticked.has('end-screen') ? 'done' : 'todo',
          body: "Add a subscribe button and a 'best for viewer' video to the last 5–20 seconds of one video, then use Import from video on each new one.",
          action: manual('end-screen'),
        },
        {
          id: 'trailer',
          title: 'Channel trailer and home page',
          state: ticked.has('trailer') ? 'done' : 'todo',
          body: "Pick a short, strong video as the trailer for people who haven't subscribed yet, and add sections such as popular uploads and a playlist per series to the home tab.",
          action: manual('trailer'),
        },
      ],
    },
    {
      title: 'Stay monetizable',
      items: [
        {
          id: 'original',
          title: 'Make every video clearly your own',
          state: 'info',
          body: "YouTube's inauthentic-content rule demonetizes channels whose uploads look mass-produced or made from a template with little variation. Being faceless or using an AI voice isn't the problem: YouTube looks at the pattern across a channel's recent uploads. Write original scripts with your own angle, keep a recognisable narrator and character, and vary the formats.",
          action: (
            <ButtonLink
              href="https://support.google.com/youtube/answer/1311392"
              size="sm"
              variant="ghost"
              icon={<ExternalLink className="size-3.5" />}
              {...external}
            >
              YouTube's policy
            </ButtonLink>
          ),
        },
      ],
    },
  ]

  const counted = sections.flatMap((s) => s.items).filter((i) => i.state !== 'info')
  const doneCount = counted.filter((i) => i.state === 'done' || i.state === 'auto').length

  return (
    <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8">
        <h1 className="display text-[34px]">Channel setup</h1>
        <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
          Tips for growing a channel like yours, most of them one click to apply. Nothing changes on YouTube
          until you confirm it.
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-56 flex-1">
            <p className="text-[15px]">
              <span className="tc text-[22px] font-semibold">{doneCount}</span>
              <span className="text-ink-2"> of {counted.length} done</span>
            </p>
            <ProgressBar value={doneCount / counted.length} tone="you" className="mt-2 max-w-md" />
          </div>
          {channels.length > 1 && channel && (
            <Select
              aria-label="Channel"
              value={channel.id}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-56"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
        </div>
        {status && !channel && (
          <p className="mt-3 text-[13px] text-ink-3">
            Connect YouTube in Settings so these tips can check and update your channel.
          </p>
        )}
        {youtube.error && <p className="mt-3 text-[13px] text-bad">{errorText(youtube.error)}</p>}
      </header>

      <div className="flex flex-col gap-6">
        <AiSetup settings={settings} channel={channel} yt={yt} geminiReady={geminiReady} confirm={confirm} />
        {sections.map((section) => (
          <Panel key={section.title} title={section.title} description={section.description}>
            <ul className="divide-y divide-line">
              {section.items.map((item) => (
                <Tip key={item.id} item={item} />
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      {confirmDialog}
    </div>
  )
}

function Tip({ item }: { item: TipItem }) {
  const state = STATE[item.state]
  return (
    <li className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
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
