'use client'

import { WEEKDAYS } from '@cutroom/shared/schedule'
import {
  type AppSettings,
  ART_STYLES,
  type ChannelNiche,
  GEMINI_VOICES,
  type NicheReference,
  YOUTUBE_CATEGORIES,
} from '@cutroom/shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, UserRound, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ChannelDTO } from '@/lib/dto'
import { formatBytes } from '@/lib/format'
import { keys, useLibrary, usePlaylists, useSettings, useStatus, useVoices } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import {
  Button,
  ButtonLink,
  Dot,
  Field,
  Input,
  Panel,
  ProgressBar,
  Segmented,
  Select,
  Switch,
  Textarea,
  useConfirm,
} from './ui'

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  'youtube-connected': { ok: true, text: 'YouTube connected' },
  'drive-connected': { ok: true, text: 'Google Drive connected' },
  denied: { ok: false, text: 'Google sign-in was cancelled.' },
  expired: { ok: false, text: 'That sign-in link expired. Try connecting again.' },
  'no-channel': {
    ok: false,
    text: 'That Google account has no YouTube channel. Pick the account that owns your channel.',
  },
  'missing-client': { ok: false, text: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Google.' },
  failed: { ok: false, text: 'Google sign-in failed.' },
}

export function SettingsPage() {
  const params = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const result = params.get('google')
    if (!result) return
    const message = GOOGLE_MESSAGES[result] ?? GOOGLE_MESSAGES.failed
    if (message.ok) toast.success(message.text, { description: params.get('detail') ?? undefined })
    else toast.error(message.text, { description: params.get('detail') ?? undefined })
    router.replace('/settings', { scroll: false })
  }, [params, router])

  return (
    <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8">
        <h1 className="display text-[34px]">Settings</h1>
        <p className="mt-2 text-[14.5px] text-ink-2">
          Connections, your posting schedule and the defaults for new videos.
        </p>
      </header>
      <div className="flex flex-col gap-6">
        <Connections />
        <PreferencesForm />
      </div>
    </div>
  )
}

function Row({
  name,
  tone,
  status,
  detail,
  children,
  top,
}: {
  name: string
  tone: Tone
  status: string
  detail?: React.ReactNode
  children?: React.ReactNode
  /** Align to the top, for a detail that is a list. */
  top?: boolean
}) {
  return (
    <li
      className={cn(
        'grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[160px_1fr_auto]',
        top ? 'sm:items-start' : 'sm:items-center',
      )}
    >
      <span className="text-[14.5px] font-semibold">{name}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[14px]">
          <Dot tone={tone} />
          {status}
        </p>
        {detail && <div className="mt-1 text-[12.5px] leading-snug text-ink-3">{detail}</div>}
      </div>
      {children && <div className="flex gap-2 sm:justify-end">{children}</div>}
    </li>
  )
}

function Connections() {
  const { data: status, isLoading } = useStatus()
  const client = useQueryClient()
  const { confirm, element } = useConfirm()
  const [testing, setTesting] = useState(false)
  const drive = useQuery({
    queryKey: ['drive-usage'],
    queryFn: () => api.get<{ usage: { used: number; limit: number | null } | null }>('/api/google/drive'),
    enabled: Boolean(status?.drive.connected),
  })

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.status }),
      client.invalidateQueries({ queryKey: ['playlists'] }),
    ])

  const disconnectDrive = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Drive?',
      body: 'New videos stay in app storage instead. Files already in Drive are not touched.',
      action: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del('/api/google/drive')
      await refresh()
      toast.success('Disconnected')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const disconnectChannel = async (channel: ChannelDTO) => {
    const ok = await confirm({
      title: `Disconnect ${channel.title}?`,
      body: 'Videos meant for this channel are rendered, but not posted, until you connect it again. Videos already scheduled on YouTube stay scheduled.',
      action: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    try {
      await api.del(`/api/google/youtube?channel=${encodeURIComponent(channel.id)}`)
      await refresh()
      toast.success('Disconnected')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const makeDefault = async (channel: ChannelDTO) => {
    try {
      await api.patch('/api/google/youtube', { channel: channel.id })
      await refresh()
      toast.success(`${channel.title} is now the default channel`)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      const { results } = await api.post<{ results: { channel: string; ok: boolean; error?: string }[] }>(
        '/api/notifications/test',
      )
      for (const r of results) {
        if (r.ok) toast.success(`${r.channel}: test message sent`)
        else toast.error(`${r.channel}: ${r.error}`)
      }
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setTesting(false)
    }
  }

  if (isLoading || !status)
    return <div className="h-72 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />
  const googleReady = status.google.configured
  const usage = drive.data?.usage
  const channels = status.channels
  const notify = status.notifications
  const notifyNames = [
    notify.discord && 'Discord',
    notify.telegram && 'Telegram',
    notify.email && 'email',
  ].filter(Boolean) as string[]

  return (
    <Panel
      title="Connections"
      description="Keys live in environment variables, never in the browser. Google accounts connect here."
    >
      <ul className="divide-y divide-line">
        <Row
          name="Gemini"
          tone={status.gemini.configured ? 'ok' : 'you'}
          status={status.gemini.configured ? `Ready, using ${status.gemini.model}` : 'No API key'}
          detail={
            status.gemini.configured ? (
              <>
                Writes scripts, splits scenes, times the voice-over and drafts post details. Voice-overs use{' '}
                {status.gemini.ttsModel} (free tier). Pictures use {status.gemini.imageModel}, which needs
                billing turned on for the key&apos;s Google Cloud project.
              </>
            ) : (
              <>
                Get a free key at{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  aistudio.google.com/apikey
                </a>{' '}
                and set GEMINI_API_KEY for the web app and the worker.
              </>
            )
          }
        />
        <Row
          name="YouTube"
          top={channels.length > 0}
          tone={channels.length ? 'ok' : 'idle'}
          status={
            channels.length === 0
              ? 'Not connected'
              : channels.length === 1
                ? 'Connected'
                : `${channels.length} channels connected`
          }
          detail={
            channels.length === 0 ? (
              googleReady ? (
                'Connect the Google account that owns your channel.'
              ) : (
                'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see the README).'
              )
            ) : (
              <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
                {channels.map((channel) => (
                  <li key={channel.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-sunk text-[13px] font-semibold text-ink-2"
                    >
                      {channel.title.trim().charAt(0).toUpperCase() || 'Y'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-ink">{channel.title}</span>
                        {channel.isDefault && channels.length > 1 && (
                          <span className="shrink-0 rounded-full border border-line bg-sunk px-2 py-px text-[11.5px] text-ink-2">
                            Default
                          </span>
                        )}
                      </p>
                      {channel.email && <p className="truncate">{channel.email}</p>}
                      {!channel.analytics && (
                        <p className="text-kodak-ink">Reconnect to see watch time on Performance</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!channel.isDefault && (
                        <Button variant="ghost" size="sm" onClick={() => makeDefault(channel)}>
                          Make default
                        </Button>
                      )}
                      {!channel.analytics && (
                        <ButtonLink href="/api/google/connect?provider=youtube" variant="ghost" size="sm">
                          Reconnect
                        </ButtonLink>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => disconnectChannel(channel)}>
                        Disconnect
                      </Button>
                    </div>
                  </li>
                ))}
                <li>
                  <ButtonLink
                    href="/api/google/connect?provider=youtube"
                    variant="ghost"
                    size="sm"
                    disabled={!googleReady}
                    icon={<Plus className="size-3.5" />}
                    className="h-10 w-full justify-start rounded-none px-3"
                  >
                    Add another channel
                  </ButtonLink>
                </li>
              </ul>
            )
          }
        >
          {channels.length === 0 && (
            <ButtonLink
              href="/api/google/connect?provider=youtube"
              variant="go"
              size="sm"
              disabled={!googleReady}
            >
              Connect YouTube
            </ButtonLink>
          )}
        </Row>
        <Row
          name="Google Drive"
          tone={status.drive.connected ? 'ok' : 'idle'}
          status={status.drive.connected ? `Saving to ${status.drive.email}` : 'Not connected'}
          detail={
            status.drive.connected ? (
              usage ? (
                <div className="flex max-w-xs flex-col gap-1.5">
                  <span>
                    {formatBytes(usage.used)} used{usage.limit ? ` of ${formatBytes(usage.limit)}` : ''}.
                    Shared with Gmail and Photos.
                  </span>
                  {usage.limit && <ProgressBar value={usage.used / usage.limit} />}
                  {usage.limit && usage.used / usage.limit >= 0.9 && (
                    <span className="text-bad">
                      Almost full. Delete old Cutroom folders in Drive: once it is full, videos still post but
                      are no longer saved there.
                    </span>
                  )}
                </div>
              ) : (
                'Finished videos go into a Cutroom folder.'
              )
            ) : (
              'Finished videos and project files are kept in a Cutroom folder. The app only sees files it creates.'
            )
          }
        >
          {status.drive.connected ? (
            <Button variant="ghost" size="sm" onClick={disconnectDrive}>
              Disconnect
            </Button>
          ) : (
            <ButtonLink href="/api/google/connect?provider=drive" size="sm" disabled={!googleReady}>
              Connect Drive
            </ButtonLink>
          )}
        </Row>
        <Row
          name="ElevenLabs"
          tone={status.elevenlabs.configured ? 'ok' : 'idle'}
          status={status.elevenlabs.configured ? 'Ready' : 'Not set up (optional)'}
          detail={
            status.elevenlabs.configured
              ? 'Your ElevenLabs voices are available for AI voice-overs, with exact word timing.'
              : 'Paid voices with exact word timing. Set ELEVENLABS_API_KEY for the web app and the worker. Gemini voices work without it.'
          }
        />
        <Row
          name="Worker"
          tone={
            !status.worker.configured
              ? 'bad'
              : status.worker.reachable
                ? status.worker.busy
                  ? 'run'
                  : 'ok'
                : 'idle'
          }
          status={
            !status.worker.configured
              ? 'Not set up'
              : status.worker.mode === 'github'
                ? status.worker.busy
                  ? 'GitHub Actions, working on a job'
                  : 'GitHub Actions'
                : status.worker.reachable
                  ? status.worker.busy
                    ? 'Online, working on a job'
                    : 'Online'
                  : 'Asleep or unreachable'
          }
          detail={
            !status.worker.configured
              ? status.worker.mode === 'github'
                ? 'Set GITHUB_DISPATCH_TOKEN, GITHUB_REPO and WORKER_SECRET, and add the repository secrets (see DEPLOYMENT.md).'
                : 'Set WORKER_URL and WORKER_SECRET. Locally, pnpm dev starts it on port 8787.'
              : status.worker.mode === 'github'
                ? `${status.worker.url}. Each job starts its own run, so nothing sleeps.`
                : `${
                    status.worker.reachable
                      ? `${status.worker.url}. It keeps itself awake while a job runs.`
                      : 'Free Render workers sleep after 15 idle minutes and wake up in about a minute when a job starts.'
                  } A free Render worker renders slowly (a 6-minute video takes about half an hour); the free GitHub Actions worker takes a few minutes (DEPLOYMENT.md, section 11).`
          }
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => client.invalidateQueries({ queryKey: keys.status })}
          >
            Check again
          </Button>
        </Row>
        <Row
          name="Notifications"
          tone={notifyNames.length ? 'ok' : 'idle'}
          status={notifyNames.length ? `Sending to ${notifyNames.join(', ')}` : 'Not set up'}
          detail={
            notifyNames.length
              ? 'Choose which events send a message under Notifications below.'
              : 'Get a message when a video needs your approval, fails or goes out. Set up Discord, Telegram or email in the environment (see ENVIRONMENT.md).'
          }
        >
          {notifyNames.length > 0 && (
            <Button variant="ghost" size="sm" busy={testing} onClick={sendTest}>
              Send a test
            </Button>
          )}
        </Row>
        <Row
          name="Storage"
          tone={status.storage === 'blob' && !status.blobToken ? 'bad' : 'ok'}
          status={status.storage === 'blob' ? 'Vercel Blob' : 'This computer'}
          detail={
            status.storage === 'blob'
              ? status.blobToken
                ? 'Free plan: 1 GB. Large finished videos go to Drive instead.'
                : 'Add BLOB_READ_WRITE_TOKEN in Vercel. Uploads from the browser and the worker need it.'
              : 'Files are kept in .data/storage.'
          }
        />
        <Row
          name="Database"
          tone="ok"
          status={status.database === 'neon' ? 'Neon Postgres' : 'This computer'}
          detail={
            status.database === 'neon' ? undefined : 'Kept in .data/pglite. Set DATABASE_URL to use Neon.'
          }
        />
        <Row
          name="Sign-in"
          tone={status.auth ? 'ok' : 'idle'}
          status={status.auth ? 'Password required' : 'Open — anyone with the address can use it'}
          detail={status.auth ? undefined : 'Set APP_PASSWORD before deploying.'}
        />
        <Row
          name="Daily check"
          tone={status.daily === 'on' ? 'ok' : status.daily === 'needs-secret' ? 'bad' : 'idle'}
          status={
            status.daily === 'on'
              ? 'On, every day at 09:00 UTC'
              : status.daily === 'needs-secret'
                ? 'Off: CRON_SECRET is missing'
                : 'Runs only on Vercel'
          }
          detail={
            status.daily === 'needs-secret'
              ? 'Add CRON_SECRET on Vercel and redeploy. Until then, stalled uploads wait for you to open the app, and Performance only updates when you press Refresh.'
              : 'Resumes uploads that stalled while no tab was open, and refreshes the Performance numbers.'
          }
        />
      </ul>
      {element}
    </Panel>
  )
}

function PreferencesForm() {
  const { data: saved } = useSettings()
  const { data: status } = useStatus()
  const client = useQueryClient()
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const settings = draft ?? saved ?? null
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const playlists = usePlaylists(null, Boolean(status?.youtube.connected))
  const voices = useVoices(Boolean(status?.elevenlabs.configured))
  // Switching to ElevenLabs before its voice list arrives leaves the voice blank; fill it once it loads.
  const firstVoice = voices.data?.elevenlabs[0]?.id
  useEffect(() => {
    if (firstVoice && draft?.voice.provider === 'elevenlabs' && !draft.voice.voice) {
      setDraft({ ...draft, voice: { ...draft.voice, voice: firstVoice } })
    }
  }, [draft, firstVoice])
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return ['UTC']
    }
  }, [])

  if (!settings) return <div className="h-96 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />

  const update = (patch: Partial<AppSettings>) => setDraft({ ...settings, ...patch })
  const updateDefaults = (patch: Partial<AppSettings['defaults']>) =>
    setDraft({ ...settings, defaults: { ...settings.defaults, ...patch } })

  const save = async () => {
    if (!settings.voice.voice.trim()) {
      toast.error('Pick a default AI voice, or switch the voice service back to Gemini.')
      return
    }
    setBusy(true)
    try {
      const next = await api.put<AppSettings>('/api/settings', settings)
      client.setQueryData(keys.settings, next)
      await client.invalidateQueries({ queryKey: keys.schedule })
      setDraft(null)
      toast.success('Settings saved')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const slotsFor = (day: number) =>
    settings.slots.filter((s) => s.day === day).sort((a, b) => a.time.localeCompare(b.time))
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <>
      <div id="schedule" className="scroll-mt-6">
        <Panel
          title="Posting schedule"
          description="Finish & schedule picks the next free time from these slots. YouTube makes the video public at that time."
        >
          <div className="flex flex-col gap-5 px-5 py-5">
            <Field label="Time zone">
              <div className="flex flex-wrap gap-2">
                <Select
                  value={settings.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                  className="min-w-64 flex-1 sm:flex-none"
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
                {localZone && localZone !== settings.timezone && (
                  <Button variant="ghost" onClick={() => update({ timezone: localZone })}>
                    Use {localZone.replace(/_/g, ' ')}
                  </Button>
                )}
              </div>
            </Field>
            <ul className="overflow-hidden rounded-[var(--radius-control)] border border-line">
              {WEEKDAYS.map((label, day) => {
                const slots = slotsFor(day)
                return (
                  <li
                    key={label}
                    className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0"
                  >
                    <span className={cn('w-12 text-[14px]', slots.length ? 'font-semibold' : 'text-ink-3')}>
                      {label}
                    </span>
                    {slots.map((slot) => (
                      <span
                        key={slot.time}
                        className="inline-flex items-center gap-1 rounded-full bg-ink py-1 pr-1 pl-3 text-[13px] text-paper"
                      >
                        <input
                          type="time"
                          value={slot.time}
                          aria-label={`${label} posting time`}
                          onChange={(e) =>
                            update({
                              slots: settings.slots.map((s) =>
                                s === slot ? { ...s, time: e.target.value || s.time } : s,
                              ),
                            })
                          }
                          className="tc bg-transparent text-paper [color-scheme:dark] focus:outline-none dark:[color-scheme:light]"
                        />
                        <button
                          type="button"
                          aria-label={`Remove ${label} ${slot.time}`}
                          onClick={() => update({ slots: settings.slots.filter((s) => s !== slot) })}
                          className="rounded-full p-0.5 text-paper/70 hover:bg-paper/15 hover:text-paper"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          slots: [...settings.slots, { day, time: slots.length ? '12:00' : '18:00' }],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink hover:text-ink"
                    >
                      <Plus className="size-3" aria-hidden />
                      Add time
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Panel>
      </div>

      <div id="niche" className="scroll-mt-6">
        <ChannelNichePanel
          niche={settings.niche}
          onChange={(patch) => update({ niche: { ...settings.niche, ...patch } })}
        />
      </div>

      <div id="shorts" className="scroll-mt-6">
        <Panel
          title="Shorts"
          description="Right after a long video posts, Cutroom cuts Short drafts from its best moments: Gemini picks them, the worker cuts your voice-over to match. You check each draft and publish it like any video."
        >
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            <Field
              label="Shorts from each video"
              hint="Only for videos posted to YouTube, at least 90 seconds long."
            >
              <Segmented
                ariaLabel="Shorts from each video"
                value={String(settings.shorts.count)}
                onChange={(count) => update({ shorts: { ...settings.shorts, count: Number(count) } })}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                ]}
                className="w-full"
              />
            </Field>
            <Field
              label="Longest Short"
              hint="Short ones hold attention best; YouTube allows up to 3 minutes."
            >
              <Segmented
                ariaLabel="Longest Short"
                value={String(settings.shorts.maxSeconds)}
                onChange={(maxSeconds) =>
                  update({ shorts: { ...settings.shorts, maxSeconds: Number(maxSeconds) } })
                }
                options={[
                  { value: '30', label: '30 s' },
                  { value: '60', label: '60 s' },
                  { value: '90', label: '90 s' },
                  { value: '180', label: '3 min' },
                ]}
                className="w-full"
              />
            </Field>
          </div>
        </Panel>
      </div>

      <div id="autopilot" className="scroll-mt-6">
        <Panel
          title="Weekly drafts"
          description="Each week the daily check turns your ideas into ready drafts, one a day: the newest idea on the Ideas page (requests from your comments included, or fresh ones from Gemini when the list is empty), its script written, split into scenes, with backgrounds and poses picked from your Library. You record the voice-over, check it and schedule it. Free, on Gemini's free tier."
        >
          <div className="px-5 py-5">
            <Field
              label="Drafts a week"
              hint={
                settings.autopilot.perWeek > 0
                  ? `Up to ${settings.autopilot.perWeek} a week, made from Monday on. You get a message for each when notifications are set up.`
                  : 'Off: drafts are only made when you ask on the Ideas page.'
              }
            >
              <Segmented
                ariaLabel="Drafts a week"
                value={String(settings.autopilot.perWeek)}
                onChange={(perWeek) => update({ autopilot: { perWeek: Number(perWeek) } })}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                  { value: '5', label: '5' },
                  { value: '7', label: '7' },
                ]}
                className="w-full max-w-md"
              />
            </Field>
          </div>
        </Panel>
      </div>

      <div id="defaults" className="scroll-mt-6">
        <Panel
          title="Defaults for new videos"
          description="Every project starts with these. You can change them per video."
        >
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            <Field label="Before uploading" className="sm:col-span-2">
              <Segmented
                ariaLabel="Default posting mode"
                value={settings.defaults.mode}
                onChange={(mode) => updateDefaults({ mode })}
                options={[
                  { value: 'review', label: 'Let me approve' },
                  { value: 'autopilot', label: 'Auto-pilot' },
                ]}
              />
            </Field>
            <Field label="Visibility">
              <Select
                value={settings.defaults.privacy}
                onChange={(e) =>
                  updateDefaults({ privacy: e.target.value as AppSettings['defaults']['privacy'] })
                }
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </Select>
            </Field>
            <Field label="Category">
              <Select
                value={settings.defaults.categoryId}
                onChange={(e) => updateDefaults({ categoryId: e.target.value })}
              >
                {YOUTUBE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Playlist"
              hint={status?.youtube.connected ? undefined : 'Connect YouTube to choose one.'}
            >
              <Select
                value={settings.defaults.playlistId}
                disabled={!status?.youtube.connected}
                onChange={(e) => updateDefaults({ playlistId: e.target.value })}
              >
                <option value="">None</option>
                {playlists.data?.playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Language code" hint="For example en, es, tl.">
              <Input
                value={settings.defaults.language}
                onChange={(e) => updateDefaults({ language: e.target.value.trim() })}
              />
            </Field>
            <Field label="Resolution">
              <Segmented
                ariaLabel="Default resolution"
                value={settings.defaults.resolution}
                onChange={(resolution) => updateDefaults({ resolution })}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                ]}
              />
            </Field>
            <Field label="Captions">
              <Segmented
                ariaLabel="Default captions"
                value={settings.defaults.captionStyle}
                onChange={(captionStyle) => updateDefaults({ captionStyle })}
                options={[
                  { value: 'highlight', label: 'Word by word' },
                  { value: 'line', label: 'Plain' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </Field>
            <Field label="Tags added to every video" className="sm:col-span-2" hint="Separate with commas.">
              <Input
                value={settings.defaults.tags.join(', ')}
                onChange={(e) =>
                  updateDefaults({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field
              label="Description footer"
              className="sm:col-span-2"
              hint="Links, socials, credits. Added below every description."
            >
              <Textarea
                value={settings.defaults.descriptionFooter}
                onChange={(e) => updateDefaults({ descriptionFooter: e.target.value })}
                className="min-h-24"
              />
            </Field>
            <div className="sm:col-span-2">
              <Switch
                checked={settings.defaults.madeForKids}
                onCheckedChange={(madeForKids) => updateDefaults({ madeForKids })}
                label="Made for kids"
                description="Required by YouTube for every upload."
              />
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="AI voice"
        description="The voice new AI voice-overs start with. You can pick another one per video on its Voice-over step."
      >
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <Field label="Voice service" className="sm:col-span-2">
            <Segmented
              ariaLabel="Default voice service"
              value={settings.voice.provider}
              onChange={(provider) =>
                update({
                  voice: {
                    ...settings.voice,
                    provider,
                    voice:
                      provider === 'gemini'
                        ? GEMINI_VOICES.some((v) => v.name === settings.voice.voice)
                          ? settings.voice.voice
                          : 'Kore'
                        : (voices.data?.elevenlabs[0]?.id ?? ''),
                  },
                })
              }
              options={[
                { value: 'gemini', label: 'Gemini' },
                { value: 'elevenlabs', label: 'ElevenLabs' },
              ]}
            />
          </Field>
          <Field
            label="Voice"
            error={
              settings.voice.provider === 'elevenlabs' && !status?.elevenlabs.configured
                ? 'Add ELEVENLABS_API_KEY to use ElevenLabs.'
                : null
            }
          >
            <Select
              value={settings.voice.voice}
              onChange={(e) => update({ voice: { ...settings.voice, voice: e.target.value } })}
            >
              {settings.voice.provider === 'gemini'
                ? GEMINI_VOICES.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.character.toLowerCase()}
                    </option>
                  ))
                : (voices.data?.elevenlabs ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              {settings.voice.provider === 'elevenlabs' && !voices.data?.elevenlabs.length && (
                <option value="">No voices loaded</option>
              )}
            </Select>
          </Field>
          {settings.voice.provider === 'gemini' && (
            <Field label="Delivery" aside="Optional">
              <Input
                value={settings.voice.style}
                maxLength={300}
                onChange={(e) => update({ voice: { ...settings.voice, style: e.target.value } })}
                placeholder="Warm, unhurried documentary narrator"
              />
            </Field>
          )}
        </div>
      </Panel>

      <div id="notifications" className="scroll-mt-6">
        <Panel
          title="Notifications"
          description={
            status &&
            (status.notifications.discord || status.notifications.telegram || status.notifications.email)
              ? 'Which events send you a message.'
              : 'Which events send you a message once Discord, Telegram or email is set up in the environment.'
          }
        >
          <div className="flex flex-col gap-4 px-5 py-5">
            <Switch
              checked={settings.notifications.approval}
              onCheckedChange={(approval) =>
                update({ notifications: { ...settings.notifications, approval } })
              }
              label="A video is waiting for your approval"
            />
            <Switch
              checked={settings.notifications.failed}
              onCheckedChange={(failed) => update({ notifications: { ...settings.notifications, failed } })}
              label="Something failed"
              description="Rendering, uploading or recording a voice-over stopped with an error."
            />
            <Switch
              checked={settings.notifications.posted}
              onCheckedChange={(posted) => update({ notifications: { ...settings.notifications, posted } })}
              label="A video is posted or scheduled"
            />
          </div>
        </Panel>
      </div>

      <Panel title="Storage">
        <div className="px-5 py-5">
          <Switch
            checked={settings.freeBlobAfterPosting}
            onCheckedChange={(freeBlobAfterPosting) => update({ freeBlobAfterPosting })}
            label="Free up Vercel Blob space after posting"
            description="Once a video is on YouTube and its files are copied to Google Drive, the working copies are deleted from Blob. Only applies in production."
          />
        </div>
      </Panel>

      <div
        className={cn(
          'sticky bottom-[calc(var(--tabbar)+env(safe-area-inset-bottom)+12px)] z-20 flex md:bottom-4 items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-ink bg-ink px-4 py-3 text-paper transition-[opacity,transform]',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
        aria-hidden={!dirty}
      >
        <span className="text-[14px]">You have unsaved changes.</span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="text-paper/80 hover:bg-paper/10 hover:text-paper"
            onClick={() => setDraft(null)}
          >
            Discard
          </Button>
          <Button variant="go" busy={busy} onClick={save}>
            Save changes
          </Button>
        </div>
      </div>
    </>
  )
}

const PACES = ['2', '3', '4', '6', '8']

interface LearnedStyle {
  reference: NicheReference
  suggestion: Pick<
    ChannelNiche,
    'description' | 'narration' | 'audience' | 'tone' | 'artStyle' | 'targetMinutes' | 'pace'
  > & {
    ideas: { title: string; angle: string }[]
  }
  videos: number
}

/**
 * "Learn from a channel": paste a channel you want your videos to be like; Gemini describes its
 * format for your own narrator, and "Use this style" fills the niche in.
 */
function LearnStyle({
  niche,
  onChange,
}: {
  niche: ChannelNiche
  onChange: (patch: Partial<ChannelNiche>) => void
}) {
  const client = useQueryClient()
  const [url, setUrl] = useState('')
  const [learning, setLearning] = useState(false)
  const [learned, setLearned] = useState<LearnedStyle | null>(null)
  const [adding, setAdding] = useState(false)

  const learn = async () => {
    setLearning(true)
    try {
      setLearned(await api.post<LearnedStyle>('/api/settings/learn-style', { url }))
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setLearning(false)
    }
  }
  const use = () => {
    if (!learned) return
    const { ideas: _ideas, ...fields } = learned.suggestion
    onChange({ ...fields, reference: learned.reference })
    toast.success(`Your niche now follows ${learned.reference.title}`)
  }
  const addIdeas = async () => {
    if (!learned) return
    setAdding(true)
    try {
      for (const idea of learned.suggestion.ideas) {
        await api.post('/api/ideas/own', { title: idea.title, angle: idea.angle })
      }
      void client.invalidateQueries({ queryKey: keys.ideas })
      toast.success(`Added ${learned.suggestion.ideas.length} ideas`, {
        description: 'Find them on the Ideas page.',
      })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setAdding(false)
    }
  }

  const s = learned?.suggestion
  return (
    <Field
      label="Learn from a channel"
      className="sm:col-span-2"
      hint={
        niche.reference
          ? `Following the style of ${niche.reference.title}: its best titles guide yours until your channel has hits of its own.`
          : 'Paste a channel you want your videos to be like. Its format is adapted to your own character, never copied.'
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="youtube.com/@channel"
            aria-label="Channel to learn from"
            className="min-w-0"
          />
          <Button variant="plain" busy={learning} disabled={url.trim().length < 3} onClick={learn}>
            Learn the style
          </Button>
          {niche.reference && !learned && (
            <Button variant="ghost" onClick={() => onChange({ reference: null })}>
              Stop following
            </Button>
          )}
        </div>
        {learned && s && (
          <div className="rounded-[var(--radius-control)] border border-line bg-sunk">
            <p className="border-b border-line px-3.5 py-2.5 text-[13px] text-ink-2">
              From {learned.videos} videos on{' '}
              <span className="font-medium text-ink">{learned.reference.title}</span>. Check it, then use it:
              it replaces the niche fields below.
            </p>
            <dl className="grid gap-x-5 gap-y-3 px-3.5 py-3 text-[13.5px] sm:grid-cols-[130px_1fr]">
              {(
                [
                  ['About', s.description],
                  ['Narration', s.narration],
                  ['Audience', s.audience],
                  ['Tone', s.tone],
                  ['Art style', s.artStyle],
                  ['Length', `About ${s.targetMinutes} min, a new picture every ${s.pace} s`],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="leading-relaxed whitespace-pre-line">{value}</dd>
                </div>
              ))}
              {s.ideas.length > 0 && (
                <div className="contents">
                  <dt className="text-ink-3">Ideas</dt>
                  <dd>
                    <ul className="flex flex-col gap-1.5">
                      {s.ideas.map((idea) => (
                        <li key={idea.title}>
                          <span className="font-medium">{idea.title}</span>
                          {idea.angle && <span className="text-ink-2"> {idea.angle}</span>}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5">
              <Button variant="go" size="sm" onClick={use}>
                Use this style
              </Button>
              {s.ideas.length > 0 && (
                <Button variant="plain" size="sm" busy={adding} onClick={addIdeas}>
                  Add the {s.ideas.length} ideas
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setLearned(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </Field>
  )
}

/** The channel's niche: subject, narrator, look, length and main characters for new videos. */
function ChannelNichePanel({
  niche,
  onChange,
}: {
  niche: ChannelNiche
  onChange: (patch: Partial<ChannelNiche>) => void
}) {
  const library = useLibrary()
  const characters = library.data ?? []
  const id = useId()
  const toggle = (characterId: string) =>
    onChange({
      characterIds: niche.characterIds.includes(characterId)
        ? niche.characterIds.filter((c) => c !== characterId)
        : [...niche.characterIds, characterId].slice(0, 6),
    })
  const chosen = niche.characterIds.filter((c) => characters.some((x) => x.id === c))

  return (
    <Panel
      title="Channel niche"
      description="What your channel is about. Every new video starts from this (series episodes use their series instead), and you can still change anything per video on its Brief step."
    >
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
        <LearnStyle niche={niche} onChange={onChange} />
        <Field
          label="Main characters"
          className="sm:col-span-2"
          hint={
            chosen.length
              ? 'Added to every new video with their reference images. The first one is the narrator.'
              : 'Pick the character who narrates your videos. They are added to every new video with their images.'
          }
        >
          {library.isLoading ? (
            <div className="h-11 animate-pulse-soft rounded bg-line/50" />
          ) : characters.length === 0 ? (
            <p className="text-[13.5px] text-ink-2">
              No characters yet.{' '}
              <Link href="/library" className="font-medium text-ink underline underline-offset-4">
                Create your character in the Library
              </Link>
              , then pick them here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {characters.map((character) => {
                const order = chosen.indexOf(character.id) + 1
                return (
                  <button
                    key={character.id}
                    type="button"
                    aria-pressed={order > 0}
                    onClick={() => toggle(character.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[var(--radius-control)] border py-1.5 pr-3 pl-1.5 text-[13.5px] transition-colors',
                      order > 0
                        ? 'border-ink bg-sunk font-medium text-ink'
                        : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {character.images[0] ? (
                      // biome-ignore lint/performance/noImgElement: user uploads
                      <img
                        src={character.images[0].url}
                        alt=""
                        className="size-8 rounded-[5px] object-cover"
                      />
                    ) : (
                      <span className="grid size-8 place-items-center rounded-[5px] bg-sunk">
                        <UserRound className="size-4 text-ink-3" aria-hidden />
                      </span>
                    )}
                    {character.name || 'Unnamed character'}
                    {order > 0 && (
                      <span className="tc grid size-5 place-items-center rounded-full bg-ink text-[11px] font-semibold text-paper">
                        {order}
                      </span>
                    )}
                  </button>
                )
              })}
              <ButtonLink href="/library" variant="ghost" size="sm" icon={<Plus className="size-3.5" />}>
                New character
              </ButtonLink>
            </div>
          )}
        </Field>
        <Field
          label="What the channel is about"
          htmlFor={`${id}-about`}
          className="sm:col-span-2"
          aside={`${niche.description.length} / 1000`}
        >
          <Textarea
            id={`${id}-about`}
            value={niche.description}
            maxLength={1000}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Funny 2D cartoon videos about Cappy the capybara's everyday life: food, naps, friends and small disasters."
            className="min-h-20"
          />
        </Field>
        <Field
          label="How the narration sounds"
          htmlFor={`${id}-narration`}
          className="sm:col-span-2"
          aside={`${niche.narration.length} / 1000`}
          hint="The script writer follows this for every video."
        >
          <Textarea
            id={`${id}-narration`}
            value={niche.narration}
            maxLength={1000}
            onChange={(e) => onChange({ narration: e.target.value })}
            placeholder="Cappy narrates about himself in the third person, in short, silly sentences: “Capybara wants to eat.” “Capybara is happy.” Jokes kids get, with dry humor for the adults."
            className="min-h-24"
          />
        </Field>
        <Field label="Audience" htmlFor={`${id}-audience`}>
          <Input
            id={`${id}-audience`}
            value={niche.audience}
            maxLength={500}
            onChange={(e) => onChange({ audience: e.target.value })}
            placeholder="Kids and adults: families watching together"
          />
        </Field>
        <Field label="Tone" htmlFor={`${id}-tone`}>
          <Input
            id={`${id}-tone`}
            value={niche.tone}
            maxLength={500}
            onChange={(e) => onChange({ tone: e.target.value })}
            placeholder="Funny, warm, silly"
          />
        </Field>
        <Field label="Art style" htmlFor={`${id}-style`} className="sm:col-span-2">
          <Input
            id={`${id}-style`}
            value={niche.artStyle}
            maxLength={1000}
            onChange={(e) => onChange({ artStyle: e.target.value })}
            placeholder="2D cartoon, flat colors, thick clean outlines, soft pastel backgrounds"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ART_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onChange({ artStyle: style })}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
                  niche.artStyle === style
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                )}
              >
                {style}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Video length"
          aside={`${niche.targetMinutes} min · about ${Math.round(niche.targetMinutes * 150).toLocaleString()} words`}
          hint="For regular videos; Shorts stay at about a minute. Your voice-over sets the real length."
        >
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={niche.targetMinutes}
            onChange={(e) => onChange({ targetMinutes: Number(e.target.value) })}
            className="w-full accent-[var(--color-ink)]"
            aria-label="Video length in minutes"
          />
        </Field>
        <Field
          label="New image every"
          hint={`On average: quicker cuts on jokes and fast moments, longer on calm ones. About ${Math.max(1, Math.round((niche.targetMinutes * 60) / niche.pace))} pictures for a ${niche.targetMinutes}-minute video.`}
        >
          <Segmented
            ariaLabel="Seconds per image"
            value={PACES.includes(String(niche.pace)) ? String(niche.pace) : '3'}
            onChange={(pace) => onChange({ pace: Number(pace) })}
            options={PACES.map((v) => ({ value: v, label: `${v} s` }))}
            className="w-full"
          />
        </Field>
      </div>
    </Panel>
  )
}
