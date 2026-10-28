'use client'

import {
  CADENCES,
  type Cadence,
  type ChannelDetails,
  clockLabel,
  MARKETS,
  marketOf,
  presetSlots,
  slotDays,
} from '@cutroom/shared/setup'
import { type AppSettings, languageName, type PostingSlot, YOUTUBE_CATEGORIES } from '@cutroom/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { keys, useSettings, useStatus } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { AiSetup } from './ai-setup'
import { RoadToMonetization } from './monetization'
import { Button, ButtonLink, Panel, ProgressBar, Segmented, Select, StatusPill, useConfirm } from './ui'

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
  /** Shown under the tip, full width: a picker. */
  extra?: React.ReactNode
}

interface Section {
  title: string
  description?: string
  items: TipItem[]
}

/** Categories that suit explainer and comedy channels. YouTube's own ids. */
const FITTING_CATEGORIES = ['27', '24', '23']

const STUDIO = 'https://studio.youtube.com/'
const SLOT_TIME = '15:00'
const external = { target: '_blank', rel: 'noreferrer' } as const

function slotSummary(slots: PostingSlot[], timezone: string): string {
  if (slots.length === 0) return 'no posting slots'
  const times = [...new Set(slots.map((s) => clockLabel(s.time)))]
  return `${slotDays(slots, true)} at ${times.join(' / ')} (${timezone})`
}

/**
 * A checklist for growing the channel. Each setting has one home, which the tips link to: the
 * channel's own settings are on the YouTube channel page, Cutroom's defaults in Settings. Only
 * the target audience, the posting presets and "Set up with AI" live here.
 */
export function SetupPage() {
  const { data: settings } = useSettings()
  const { data: status } = useStatus()
  const client = useQueryClient()
  const { confirm, element: confirmDialog } = useConfirm()
  const [channelId, setChannelId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [cadence, setCadence] = useState<Cadence>(3)

  const channels = status?.channels ?? []
  const channel =
    channels.find((c) => c.id === channelId) ?? channels.find((c) => c.isDefault) ?? channels[0] ?? null
  // The same data, and cache, as the YouTube channel page.
  const youtube = useQuery({
    queryKey: keys.channel(channel?.id ?? null),
    queryFn: () =>
      api.get<{ details: ChannelDetails } | null>(
        `/api/channel?channel=${encodeURIComponent(channel?.id ?? '')}`,
      ),
    enabled: Boolean(channel),
    retry: false,
  })
  const yt = youtube.data?.details ?? null

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
  const tick = (id: string) => (
    <Button
      size="sm"
      variant={ticked.has(id) ? 'ghost' : 'plain'}
      busy={busy === id}
      onClick={() => toggleTick(id)}
    >
      {ticked.has(id) ? 'Undo' : 'Mark as done'}
    </Button>
  )
  /** Where a YouTube setting is changed: the channel page, or Settings to connect one first. */
  const channelLink = channel ? (
    <ButtonLink href="/channel" size="sm">
      YouTube channel
    </ButtonLink>
  ) : (
    <ButtonLink href="/settings" size="sm">
      Connect YouTube
    </ButtonLink>
  )
  const defaultsLink = (
    <ButtonLink href="/settings#defaults" size="sm">
      Settings
    </ButtonLink>
  )

  const countryDone = Boolean(
    yt && yt.country === market.code && yt.defaultLanguage.startsWith(market.language),
  )
  const scheduleDone = settings.timezone === market.timezone && settings.slots.length >= 2
  const aboutDone = Boolean(yt && yt.description.trim().length >= 100 && yt.keywords.length >= 3)
  const categoryName =
    YOUTUBE_CATEGORIES.find((c) => c.id === defaults.categoryId)?.name ?? `category ${defaults.categoryId}`
  const verified = yt?.longUploads === 'allowed' || ticked.has('verify')
  const audienceDone = settings.niche.audience.trim().length >= 40
  const nicheLink = (
    <ButtonLink href="/settings#niche" size="sm">
      Channel niche
    </ButtonLink>
  )
  const reference = settings.niche.reference ?? null

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
          action: !countryDone && channelLink,
        },
        {
          id: 'audience',
          title: 'A specific target audience',
          state: audienceDone ? 'done' : 'todo',
          body: (
            <>
              {settings.niche.audience.trim() && `Now: ${settings.niche.audience.trim()}. `}
              Not "everyone": an age range, what they are curious about and what else they watch. Scripts,
              titles and ideas are written for them. Adults and teens are worth far more to advertisers than
              kids.
            </>
          ),
          action: nicheLink,
        },
        {
          id: 'pillars',
          title: '2–4 content pillars',
          state: (settings.niche.pillars?.length ?? 0) >= 2 ? 'done' : 'todo',
          body: (
            <>
              {(settings.niche.pillars?.length ?? 0) > 0 && `Now: ${settings.niche.pillars?.join('; ')}. `}
              The kinds of video the channel keeps making, so viewers know what they subscribe for, while the
              uploads stay varied enough that YouTube never sees them as copies of one template. New ideas fit
              one of them.
            </>
          ),
          action: nicheLink,
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
          action: (
            <ButtonLink href="/settings#schedule" size="sm" variant="ghost">
              Edit slots
            </ButtonLink>
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
          action: (
            <>
              {studioLink}
              {tick('studio-times')}
            </>
          ),
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
          action: defaultsLink,
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
          action: defaultsLink,
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
          action: channelLink,
        },
      ],
    },
    {
      title: 'Upload settings',
      items: [
        {
          id: 'category',
          title: 'A category that fits',
          state: FITTING_CATEGORIES.includes(defaults.categoryId) ? 'done' : 'todo',
          body: `Now: ${categoryName}. Explainers fit Education; videos that are mostly jokes fit Entertainment or Comedy. It helps YouTube place your videos next to similar ones.`,
          action: defaultsLink,
        },
        {
          id: 'kids',
          title: 'Not made for kids',
          state: defaults.madeForKids ? 'todo' : 'done',
          body: "A cartoon look doesn't make a video made for kids: say No unless children are your audience. Made-for-kids videos lose comments, the notification bell and personalised ads. The whole channel's setting is on the YouTube channel page.",
          action: defaults.madeForKids && defaultsLink,
        },
        {
          id: 'captions',
          title: 'A caption track on every upload',
          state: 'auto',
          body: 'Cutroom uploads captions timed to the voice-over with each video, for people who watch muted and for search.',
        },
        {
          id: 'languages',
          title: 'Titles and descriptions in other languages',
          state: defaults.translateTo.length ? 'done' : 'todo',
          body: (
            <>
              {defaults.translateTo.length > 0 &&
                `Now: ${defaults.translateTo.map(languageName).join(', ')}. `}
              YouTube shows viewers who watch in Spanish, Portuguese or Hindi a title and description in their
              own language, so the video turns up in their searches too. Gemini translates them as each video
              posts.
            </>
          ),
          action: defaultsLink,
        },
      ],
    },
    {
      title: 'On YouTube',
      description: 'Some of these only YouTube Studio can do: tick them off here.',
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
              {!yt && tick('verify')}
            </>
          ),
        },
        {
          id: 'trailer',
          title: 'A channel trailer',
          state: yt?.trailer ? 'done' : 'todo',
          body: "Plays at the top of your channel for people who haven't subscribed yet: a short video that shows what the channel is.",
          action: !yt?.trailer && channelLink,
        },
        {
          id: 'branding',
          title: 'Profile picture, banner and handle',
          state: ticked.has('branding') ? 'done' : 'todo',
          body: "Use your main character's face for the profile picture so it's recognisable when tiny, and a banner that says what the channel is about. The YouTube channel page can draw both with AI; upload them in Studio.",
          action: (
            <>
              {channel && (
                <ButtonLink href="/channel" size="sm" variant="ghost">
                  Make with AI
                </ButtonLink>
              )}
              {tick('branding')}
            </>
          ),
        },
        {
          id: 'end-screen',
          title: 'An end screen on every video',
          state: ticked.has('end-screen') ? 'done' : 'todo',
          body: "Add a subscribe button and a 'best for viewer' video to the last 5–20 seconds of one video, then use Import from video on each new one.",
          action: (
            <>
              {studioLink}
              {tick('end-screen')}
            </>
          ),
        },
        {
          id: 'home',
          title: 'Home tab sections',
          state: ticked.has('home') ? 'done' : 'todo',
          body: 'Add sections such as popular uploads and a playlist per series to the channel’s home tab.',
          action: (
            <>
              {studioLink}
              {tick('home')}
            </>
          ),
        },
      ],
    },
    {
      title: 'Stay monetizable',
      items: [
        {
          id: 'two-step',
          title: 'Turn on 2-Step Verification',
          state: ticked.has('two-step') ? 'done' : 'todo',
          body: 'The Partner Program needs it on the Google account that owns the channel, and it keeps the channel from being taken over.',
          action: (
            <>
              <ButtonLink
                href="https://myaccount.google.com/signinoptions/twosv"
                size="sm"
                variant="ghost"
                icon={<ExternalLink className="size-3.5" />}
                {...external}
              >
                Google account
              </ButtonLink>
              {tick('two-step')}
            </>
          ),
        },
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
          A checklist for growing a channel like yours. Set it all up at once with AI, or follow each tip to
          where it's changed.
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
            Connect YouTube in Settings so these tips can check your channel.
          </p>
        )}
        {youtube.error && <p className="mt-3 text-[13px] text-bad">{errorText(youtube.error)}</p>}
      </header>

      <div className="flex flex-col gap-6">
        <AiSetup settings={settings} channel={channel} yt={yt} geminiReady={geminiReady} confirm={confirm} />
        <RoadToMonetization channel={channel} />
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
