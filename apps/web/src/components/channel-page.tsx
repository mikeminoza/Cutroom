'use client'

import { type ChannelDetails, formatChannelKeywords, KEYWORDS_LIMIT } from '@cutroom/shared/setup'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ImagePlus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import { keys, useStatus } from '@/lib/hooks'
import {
  Button,
  ButtonLink,
  Field,
  Input,
  Panel,
  Segmented,
  Select,
  StatusPill,
  Textarea,
  useConfirm,
  useFilePicker,
} from './ui'

interface Choice {
  id: string
  name: string
}

interface ChannelData {
  details: ChannelDetails
  uploads: { id: string; title: string; publishedAt: string | null }[]
  languages: Choice[]
  regions: Choice[]
}

interface Form {
  description: string
  keywords: string
  country: string
  defaultLanguage: string
  trailer: string
}

type WatermarkTiming = 'end' | 'entire' | 'custom'

const external = { target: '_blank', rel: 'noreferrer' } as const
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const formOf = (d: ChannelDetails): Form => ({
  description: d.description,
  keywords: d.keywords.join(', '),
  country: d.country,
  defaultLanguage: d.defaultLanguage,
  trailer: d.trailer,
})

const keywordList = (text: string) =>
  text
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

const studio = (id: string, path = '') => `https://studio.youtube.com/channel/${id}${path}`

/** Keeps the current value selectable even when YouTube's list leaves it out. */
const withCurrent = (list: Choice[], current: string): Choice[] =>
  current && !list.some((c) => c.id === current) ? [{ id: current, name: current }, ...list] : list

export function ChannelPage() {
  const { data: status } = useStatus()
  const [channelId, setChannelId] = useState<string | null>(null)
  const channels = status?.channels ?? []
  const channel =
    channels.find((c) => c.id === channelId) ?? channels.find((c) => c.isDefault) ?? channels[0] ?? null
  const query = useQuery({
    queryKey: keys.channel(channel?.id ?? null),
    queryFn: () =>
      api.get<ChannelData | null>(`/api/channel?channel=${encodeURIComponent(channel?.id ?? '')}`),
    enabled: Boolean(channel),
    retry: false,
  })

  return (
    <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[34px]">YouTube channel</h1>
          <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
            Your channel's details and settings, changed here instead of in YouTube Studio. Changes go to
            YouTube when you save them.
          </p>
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
      </header>

      {status && !channel ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="max-w-[46ch] text-[14px] text-ink-2">
              Connect your YouTube channel in Settings to see and change its details here.
            </p>
            <ButtonLink href="/settings" variant="go">
              Go to Settings
            </ButtonLink>
          </div>
        </Panel>
      ) : query.error ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="max-w-[56ch] text-[14px] text-bad">{errorText(query.error)}</p>
            <Button onClick={() => query.refetch()} icon={<RotateCcw className="size-4" />}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : !query.data || !channel ? (
        <div className="h-96 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />
      ) : (
        <ChannelView key={query.data.details.id} data={query.data} channelId={channel.id} />
      )}
    </div>
  )
}

function ChannelView({ data, channelId }: { data: ChannelData; channelId: string }) {
  const { details } = data
  const client = useQueryClient()
  const { confirm, element: confirmDialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)

  /** Saves a change on YouTube and shows the channel as YouTube now has it. */
  const update = async (key: string, patch: Record<string, unknown>, message: string): Promise<boolean> => {
    setBusy(key)
    try {
      const next = await api.patch<ChannelDetails | null>('/api/channel', { channel: channelId, ...patch })
      if (next)
        client.setQueryData<ChannelData | null>(keys.channel(channelId), (prev) =>
          prev ? { ...prev, details: next } : prev,
        )
      await client.invalidateQueries({ queryKey: keys.channelSetup(channelId) })
      toast.success(message)
      return true
    } catch (error) {
      toast.error(errorText(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Profile details={details} />
      <DetailsForm data={data} busy={busy === 'details'} confirm={confirm} update={update} />
      <Audience details={details} busy={busy === 'kids'} confirm={confirm} update={update} />
      <Watermark channelId={channelId} confirm={confirm} />
      <StudioOnly details={details} />
      {confirmDialog}
    </div>
  )
}

type Confirm = ReturnType<typeof useConfirm>['confirm']
type Update = (key: string, patch: Record<string, unknown>, message: string) => Promise<boolean>

function Profile({ details }: { details: ChannelDetails }) {
  const joined = details.publishedAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
        new Date(details.publishedAt),
      )
    : null
  const verified = details.longUploads === 'allowed'
  const stats = [
    {
      label: 'Subscribers',
      value: details.subscribers === null ? 'Hidden' : compact.format(details.subscribers),
    },
    { label: 'Views', value: compact.format(details.views) },
    { label: 'Videos', value: compact.format(details.videos) },
  ]
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-5">
        {details.thumbnail ? (
          // biome-ignore lint/performance/noImgElement: YouTube's own image host
          <img
            src={details.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className="size-16 shrink-0 rounded-full bg-sunk object-cover ring-1 ring-line"
          />
        ) : (
          <span className="size-16 shrink-0 rounded-full bg-sunk ring-1 ring-line" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="wide truncate text-[20px] font-semibold">{details.title}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">
            {[details.handle, joined && `Joined ${joined}`].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={verified ? 'ok' : 'you'}>{verified ? 'Verified' : 'Not verified'}</StatusPill>
            {details.privacy && details.privacy !== 'public' && (
              <StatusPill tone="you">{details.privacy === 'private' ? 'Private' : 'Unlisted'}</StatusPill>
            )}
            {details.madeForKids && <StatusPill tone="idle">Made for kids</StatusPill>}
            {details.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-line px-2 py-[2px] text-[12px] text-ink-3"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink
            href={`https://www.youtube.com/${details.handle || `channel/${details.id}`}`}
            size="sm"
            variant="ghost"
            icon={<ExternalLink className="size-3.5" />}
            {...external}
          >
            View channel
          </ButtonLink>
          <ButtonLink
            href={studio(details.id)}
            size="sm"
            variant="ghost"
            icon={<ExternalLink className="size-3.5" />}
            {...external}
          >
            YouTube Studio
          </ButtonLink>
        </div>
      </div>
      <dl className="grid grid-cols-3 border-t border-line">
        {stats.map((s, i) => (
          <div key={s.label} className={cn('px-5 py-3', i > 0 && 'border-l border-line')}>
            <dt className="text-[12px] text-ink-3">{s.label}</dt>
            <dd className="tc mt-0.5 text-[18px] font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>
      {!verified && (
        <p className="border-t border-line px-5 py-3 text-[13px] text-ink-2">
          Custom thumbnails and videos over 15 minutes need a verified account.{' '}
          <a
            href="https://www.youtube.com/verify"
            {...external}
            className="font-medium text-ink underline underline-offset-2"
          >
            Verify it on YouTube
          </a>
          .
        </p>
      )}
    </Panel>
  )
}

function DetailsForm({
  data,
  busy,
  confirm,
  update,
}: {
  data: ChannelData
  busy: boolean
  confirm: Confirm
  update: Update
}) {
  const { details } = data
  const [form, setForm] = useState<Form>(() => formOf(details))
  // After a save, show what YouTube now has.
  useEffect(() => setForm(formOf(details)), [details])
  const saved = formOf(details)
  const changed = (Object.keys(form) as (keyof Form)[]).filter((k) =>
    k === 'keywords'
      ? formatChannelKeywords(keywordList(form.keywords)) !==
        formatChannelKeywords(keywordList(saved.keywords))
      : form[k].trim() !== saved[k].trim(),
  )
  const keywordsLength = formatChannelKeywords(keywordList(form.keywords)).length
  const keywordsCut = keywordList(form.keywords).length > 0 && keywordsLength >= KEYWORDS_LIMIT - 20

  const regions = useMemo(() => withCurrent(data.regions, details.country), [data.regions, details.country])
  const languages = useMemo(
    () => withCurrent(data.languages, details.defaultLanguage),
    [data.languages, details.defaultLanguage],
  )
  const uploads = useMemo(
    () =>
      details.trailer && !data.uploads.some((u) => u.id === details.trailer)
        ? [
            { id: details.trailer, title: 'Current trailer (an older video)', publishedAt: null },
            ...data.uploads,
          ]
        : data.uploads,
    [data.uploads, details.trailer],
  )

  const LABEL: Record<keyof Form, string> = {
    description: 'description',
    keywords: 'keywords',
    country: 'country',
    defaultLanguage: 'language',
    trailer: 'trailer',
  }
  const save = async () => {
    const names = changed.map((k) => LABEL[k])
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
    const ok = await confirm({
      title: `Save to ${details.title} on YouTube?`,
      body: `Changes the channel's ${list}. Nothing else on the channel changes.`,
      action: 'Save to YouTube',
    })
    if (!ok) return
    const patch: Record<string, unknown> = {}
    for (const k of changed) patch[k] = k === 'keywords' ? keywordList(form.keywords) : form[k].trim()
    await update('details', patch, 'Channel details saved on YouTube')
  }

  return (
    <Panel
      title="Channel details"
      description="What viewers see on your channel's About page, and how YouTube files the channel."
      actions={
        <>
          {changed.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setForm(saved)} disabled={busy}>
              Undo changes
            </Button>
          )}
          <Button variant="go" size="sm" busy={busy} disabled={changed.length === 0} onClick={save}>
            Save to YouTube
          </Button>
        </>
      }
    >
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
        <Field
          label="Description"
          className="sm:col-span-2"
          aside={`${form.description.length} / 1,000`}
          hint="The first sentence shows in search: say plainly what viewers get, in the words people search for."
        >
          <Textarea
            rows={7}
            maxLength={1000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field
          label="Keywords"
          className="sm:col-span-2"
          aside={`${keywordsLength} / ${KEYWORDS_LIMIT}`}
          hint={
            keywordsCut
              ? 'Near YouTube’s 500-character limit: keywords past it are left out.'
              : 'Separate with commas. Short phrases people search for, most important first.'
          }
        >
          <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        </Field>
        <Field
          label="Country"
          hint="Doesn't limit who can watch; YouTube uses it for things like Partner Program terms."
        >
          <Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            <option value="" disabled>
              Not set
            </option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language" hint="The language of the channel's name and description.">
          <Select
            value={form.defaultLanguage}
            onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })}
          >
            <option value="" disabled>
              Not set
            </option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Channel trailer"
          className="sm:col-span-2"
          hint="Plays at the top of your channel for people who haven't subscribed yet. Pick a short video that shows what the channel is."
        >
          <Select value={form.trailer} onChange={(e) => setForm({ ...form, trailer: e.target.value })}>
            <option value="">No trailer</option>
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.title || u.id}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Panel>
  )
}

function Audience({
  details,
  busy,
  confirm,
  update,
}: {
  details: ChannelDetails
  busy: boolean
  confirm: Confirm
  update: Update
}) {
  const declared = details.selfDeclaredMadeForKids ?? details.madeForKids ?? false
  const overridden = details.madeForKids === true && details.selfDeclaredMadeForKids === false
  const choose = async (value: 'no' | 'yes') => {
    const kids = value === 'yes'
    if (kids === declared) return
    const ok = await confirm({
      title: kids ? 'Set the whole channel as made for kids?' : 'Set the channel as not made for kids?',
      body: kids
        ? 'Every video then counts as made for kids: comments, the notification bell, the mini player and personalised ads are turned off on all of them.'
        : "Only choose this if children aren't your audience. A cartoon look alone doesn't make a video made for kids.",
      action: kids ? 'Made for kids' : 'Not made for kids',
    })
    if (ok)
      await update(
        'kids',
        { madeForKids: kids },
        kids ? 'Channel set as made for kids' : 'Channel set as not made for kids',
      )
  }
  return (
    <Panel
      title="Audience"
      description="Whether the channel is made for kids. YouTube asks this by law (COPPA); each video can still say otherwise."
    >
      <div className="flex flex-col gap-3 px-5 py-5">
        <Segmented<'no' | 'yes'>
          ariaLabel="Made for kids"
          value={declared ? 'yes' : 'no'}
          onChange={choose}
          options={[
            { value: 'no', label: "No, it's not made for kids" },
            { value: 'yes', label: "Yes, it's made for kids" },
          ]}
          className={cn('self-start', busy && 'pointer-events-none opacity-60')}
        />
        {overridden && (
          <p className="text-[13px] text-kodak-ink">
            YouTube has set your channel as made for kids after its own review, so it stays that way whatever
            is chosen here. You can ask for a review in YouTube Studio.
          </p>
        )}
      </div>
    </Panel>
  )
}

function Watermark({ channelId, confirm }: { channelId: string; confirm: Confirm }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [timing, setTiming] = useState<WatermarkTiming>('end')
  const [start, setStart] = useState('0')
  const [busy, setBusy] = useState<'set' | 'remove' | null>(null)
  const picker = useFilePicker('image/png,image/jpeg', false, ([picked]) => {
    if (!picked) return
    if (!['image/png', 'image/jpeg'].includes(picked.type)) {
      toast.error('Pick a PNG or JPG image.')
      return
    }
    if (picked.size > 1024 * 1024) {
      toast.error('The watermark image must be 1 MB or smaller.')
      return
    }
    setFile(picked)
  })
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const set = async () => {
    if (!file) return
    setBusy('set')
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('timing', timing)
      form.set('start', start)
      form.set('channel', channelId)
      const res = await fetch('/api/channel/watermark', { method: 'POST', body: form })
      if (!res.ok)
        throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (HTTP ${res.status}).`)
      toast.success('Watermark set on all your videos')
      setFile(null)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    const ok = await confirm({
      title: 'Remove the watermark?',
      body: 'It disappears from all of your videos.',
      action: 'Remove watermark',
      danger: true,
    })
    if (!ok) return
    setBusy('remove')
    try {
      await api.del(`/api/channel/watermark?channel=${encodeURIComponent(channelId)}`)
      toast.success('Watermark removed')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title="Video watermark"
      description="A small image in the corner of every video; viewers on a computer can click it to subscribe. YouTube doesn't let apps see the current one, so it isn't shown here."
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={picker.open}
            className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-frame)] border border-dashed border-line-strong bg-sunk text-ink-3 hover:text-ink"
            aria-label="Choose a watermark image"
          >
            {preview ? (
              // biome-ignore lint/performance/noImgElement: local preview of the chosen file
              <img src={preview} alt="" className="size-full object-contain" />
            ) : (
              <ImagePlus className="size-5" aria-hidden />
            )}
          </button>
          {picker.input}
          <p className="max-w-[46ch] text-[13px] leading-snug text-ink-3">
            A square PNG or JPG, at least 150 × 150 pixels and up to 1 MB. One colour on a transparent
            background reads best; your character's face works well.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<WatermarkTiming>
            ariaLabel="When the watermark shows"
            value={timing}
            onChange={setTiming}
            options={[
              { value: 'end', label: 'End of video', hint: 'The last 15 seconds' },
              { value: 'entire', label: 'Entire video' },
              { value: 'custom', label: 'From a set time' },
            ]}
          />
          {timing === 'custom' && (
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              From
              <Input
                type="number"
                aria-label="Start time in seconds"
                min={0}
                step={1}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-20"
              />
              seconds
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="go" size="sm" disabled={!file} busy={busy === 'set'} onClick={set}>
            Set watermark
          </Button>
          <Button variant="ghost" size="sm" busy={busy === 'remove'} onClick={remove}>
            Remove watermark
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function StudioOnly({ details }: { details: ChannelDetails }) {
  const items = [
    {
      title: 'Profile picture and banner',
      text: "YouTube's API can't change these.",
      href: studio(details.id, '/editing/images'),
    },
    {
      title: 'Name and handle',
      text: 'Changed by the channel owner only.',
      href: studio(details.id, '/editing/details'),
    },
    {
      title: 'Home tab sections',
      text: 'Featured video and playlists on the channel page.',
      href: studio(details.id, '/editing/sections'),
    },
  ]
  return (
    <Panel title="Only in YouTube Studio" description="These can't be changed from outside YouTube.">
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.title} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p className="text-[14px] font-semibold">{item.title}</p>
              <p className="text-[13px] text-ink-3">{item.text}</p>
            </div>
            <ButtonLink
              href={item.href}
              size="sm"
              variant="ghost"
              icon={<ExternalLink className="size-3.5" />}
              {...external}
            >
              Open in Studio
            </ButtonLink>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
