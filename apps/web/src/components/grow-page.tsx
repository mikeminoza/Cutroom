'use client'

import {
  bestVideos,
  type GrowthProject,
  inProgress,
  type NextMove,
  nextMoves,
  pace,
  STAGES,
  stageIndex,
} from '@cutroom/shared/growth'
import type { ChannelDetails } from '@cutroom/shared/setup'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectSummary } from '@/lib/dto'
import { plural } from '@/lib/format'
import { keys, useLibrary, useProjects, useSeriesList, useSettings, useStatus } from '@/lib/hooks'
import { nextStep, type StepId } from '@/lib/stage'
import { type TipItem, TipRow, useTicks } from './checklist'
import { ButtonLink, Panel, ProgressBar } from './ui'

const external = { target: '_blank', rel: 'noreferrer' } as const
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const STUDIO = 'https://studio.youtube.com/'

/** Where a project picks up: the step to open and what to do there. */
function projectNext(project: ProjectSummary) {
  return nextStep({
    status: project.status,
    scheduledAt: project.scheduledAt,
    hasScript: project.hasScript,
    sceneCount: project.frames.length,
    imagesDone: project.frames.filter((f) => f.imageUrl).length,
    hasVoiceover: project.hasVoiceover,
    timed: project.timed,
  })
}

function watched(project: GrowthProject): string {
  const percent = project.stats?.averageViewPercent
  return percent === null || percent === undefined ? '' : `, ${Math.round(percent)}% watched on average`
}

interface Step {
  title: string
  body: React.ReactNode
  /** Where it is done. */
  where: string
  link?: { href: string; label: string; external?: boolean }
}

/**
 * Grow the channel: what to do to get more people watching, in order. "Do this next" works out
 * the few most useful moves from the projects and the channel; below are the one-time steps, the
 * routine for every video and every week, and what to do once there are videos to compare.
 */
export function GrowPage() {
  const { data: settings } = useSettings()
  const { data: status } = useStatus()
  const { data: projects } = useProjects()
  const { data: series } = useSeriesList()
  const { data: library } = useLibrary()
  const { ticked, button: tick } = useTicks(settings)

  const channels = status?.channels ?? []
  const channel = channels.find((c) => c.isDefault) ?? channels[0] ?? null
  // The same data, and cache, as the YouTube channel and Channel setup pages.
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

  if (!settings || !status || !projects) {
    return (
      <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
        <div className="h-96 animate-pulse-soft rounded-[var(--radius-panel)] bg-line/50" />
      </div>
    )
  }

  const now = new Date()
  const seriesList = series ?? []
  const withPlaylist = seriesList.filter((s) => s.template.post.playlistId)
  const characters = library ?? []
  const counts = pace(projects, now)
  const stage = stageIndex(counts.long)
  const best = bestVideos(projects, now)
  const making = inProgress(projects)[0] ?? null
  /** A page of the channel in YouTube Studio; Studio's home when the channel isn't known. */
  const studio = (path: string) =>
    channel?.youtubeId ? `${STUDIO}channel/${channel.youtubeId}/${path}` : STUDIO
  const firstLine = yt?.description.trim().split('\n')[0]?.trim() ?? ''

  const channelLink = channel ? (
    <ButtonLink href="/channel" size="sm">
      YouTube channel
    </ButtonLink>
  ) : (
    <ButtonLink href="/settings" size="sm">
      Connect YouTube
    </ButtonLink>
  )

  // One-time steps, in the order they pay off.
  const foundation: (TipItem & { short: string })[] = [
    {
      id: 'promise',
      title: 'Make the promise clear in 3 seconds',
      short:
        'A visitor should know who the channel is for and what they get from its name, banner and first line.',
      state: ticked.has('promise') ? 'done' : 'todo',
      body: (
        <>
          A visitor decides whether to subscribe from the channel name, the banner and the first line of the
          About text. Together they should say who it's for and what they get, for example: "Why your body
          does weird stuff, explained by a sarcastic stick figure." A vague promise can still get views, but
          not subscribers.
          {yt && (
            <span className="mt-1.5 block text-ink-3">
              {firstLine ? `Your first line now: "${firstLine}"` : 'Your channel has no About text yet.'}
            </span>
          )}
        </>
      ),
      action: (
        <>
          {channelLink}
          {tick('promise')}
        </>
      ),
    },
    {
      id: 'look',
      title: 'A look people recognise in their feed',
      short: 'The same character, colours and thumbnail layout every time, so returning viewers spot you.',
      state: ticked.has('look') ? 'done' : 'todo',
      body: (
        <>
          The same character, colours and thumbnail layout every time: a big face with a clear emotion and two
          or three words. People who liked one video spot the next one before they read the title.{' '}
          {characters.length > 0
            ? `Your Library has ${plural(characters.length, 'character')}: use the same one as the face of the channel.`
            : 'Add your main character to the Library so every video uses the same one.'}
        </>
      ),
      action: (
        <>
          <ButtonLink href="/library" size="sm" variant="ghost">
            Library
          </ButtonLink>
          {tick('look')}
        </>
      ),
    },
    {
      id: 'series',
      title: 'Series, not one-off videos',
      short: 'Save a video you like as a series, with a title pattern every episode follows.',
      state: seriesList.length > 0 ? 'done' : 'todo',
      body: (
        <>
          {seriesList.length > 0 && `Now: ${seriesList.map((s) => s.name).join(', ')}. `}
          Turn your content pillars into named series with a title pattern, like "Your Body Is Lying: The 3 AM
          Wake-Up". Someone who liked one episode clicks the next, and YouTube suggests them together. Open a
          video you like and choose "Save as a series…" from its ⋯ menu; new episodes start from it.
        </>
      ),
      action: (
        <ButtonLink href="/library" size="sm">
          Series
        </ButtonLink>
      ),
    },
    {
      id: 'playlists',
      title: 'A playlist for each series',
      short: 'Cutroom adds each episode to its series’ playlist, so viewers are offered the next one.',
      state: seriesList.length > 0 && withPlaylist.length === seriesList.length ? 'done' : 'todo',
      body: (
        <>
          {seriesList.length > 0 &&
            `${withPlaylist.length} of ${plural(seriesList.length, 'series', 'series')} ${withPlaylist.length === 1 ? 'has' : 'have'} one. `}
          Cutroom adds each episode to its series' playlist as it uploads, so someone who finishes one episode
          is offered the next. Pick the playlist on an episode's Publish step, then choose "Update series from
          this…" in its ⋯ menu.
        </>
      ),
      action: (
        <ButtonLink href="/library" size="sm" variant="ghost">
          Series
        </ButtonLink>
      ),
    },
    {
      id: 'channel-page',
      title: 'A trailer and home tab sections',
      short: 'A trailer for visitors and a section per series, so new viewers can binge.',
      state: yt?.trailer && ticked.has('home') ? 'done' : 'todo',
      body: (
        <>
          The trailer plays at the top of your channel for people who haven't subscribed yet. Sections for
          your popular videos and each series let a visitor watch one after another.
          {yt && (
            <span className="mt-1.5 block text-ink-3">
              {yt.trailer ? 'Trailer: set. ' : 'Trailer: not set. '}
              {ticked.has('home') ? 'Sections: done.' : 'Sections: not ticked off yet.'}
            </span>
          )}
        </>
      ),
      action: (
        <ButtonLink href="/setup" size="sm">
          Channel setup
        </ButtonLink>
      ),
    },
  ]

  const moves = nextMoves({
    now,
    projects,
    slots: settings.slots.length,
    youtube: channels.length > 0,
    foundation: foundation.map((f) => ({ id: f.id, done: f.state === 'done' })),
    breakoutsScannedAt: settings.breakouts.scannedAt,
    canScanBreakouts: channels.length > 0 && status.gemini.configured,
  })

  const describe = (
    move: NextMove,
  ): { key: string; title: string; detail: React.ReactNode; action?: React.ReactNode } => {
    switch (move.kind) {
      case 'connect':
        return {
          key: 'connect',
          title: 'Connect your YouTube channel',
          detail: 'So Cutroom can post your videos, check your channel and count what works.',
          action: (
            <ButtonLink href="/settings" size="sm" variant="go">
              Connect YouTube
            </ButtonLink>
          ),
        }
      case 'reply': {
        const summary = projects.find((p) => p.id === move.project.id)
        const videoId = summary?.youtubeVideoId
        return {
          key: `reply-${move.project.id}`,
          title: `Reply to the comments on "${move.project.title}"`,
          detail: `It went out ${move.hours < 1 ? 'less than an hour' : plural(move.hours, 'hour')} ago. Answer every comment today: replies bring more comments while the video is new, and YouTube reads an active comment section as viewers caring. Pin the question Cutroom posted, too.`,
          action: videoId && (
            <>
              <ButtonLink
                href={`${STUDIO}video/${videoId}/comments`}
                size="sm"
                variant="go"
                icon={<ExternalLink className="size-3.5" />}
                {...external}
              >
                Comments
              </ButtonLink>
              <ButtonLink
                href={`https://www.youtube.com/watch?v=${videoId}`}
                size="sm"
                variant="ghost"
                icon={<ExternalLink className="size-3.5" />}
                {...external}
              >
                Video
              </ButtonLink>
            </>
          ),
        }
      }
      case 'finish': {
        const summary = projects.find((p) => p.id === move.project.id)
        const next = summary ? projectNext(summary) : null
        return {
          key: `finish-${move.project.id}`,
          title: `Finish "${move.project.title || 'Untitled video'}"`,
          detail: (
            <>
              {next && `Next: ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}. `}
              Every video out teaches YouTube who to show the next one to: finishing beats starting another.
            </>
          ),
          action: (
            <ButtonLink
              href={`/projects/${move.project.id}${next ? `?step=${next.step}` : ''}`}
              size="sm"
              variant="go"
            >
              Open
            </ButtonLink>
          ),
        }
      }
      case 'start':
        return {
          key: 'start',
          title: counts.long === 0 ? 'Make your first video' : 'Start the next video',
          detail:
            move.slots > 0
              ? `${move.upcoming} of your ${move.slots} posting slots in the next 7 days ${move.upcoming === 1 ? 'has' : 'have'} a video. Pick an idea, or draft a few at once from Ideas.`
              : 'Pick an idea, or draft a few at once from Ideas. Then set posting slots in Settings so videos go out on the same days every week.',
          action: (
            <ButtonLink href="/ideas" size="sm" variant="go">
              Ideas
            </ButtonLink>
          ),
        }
      case 'todo': {
        const step = foundation.find((f) => f.id === move.id)
        return {
          key: `todo-${move.id}`,
          title: step?.title ?? move.id,
          detail: step?.short,
          action: (
            <a
              href={`#${move.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px] font-medium hover:bg-ink/[0.05]"
            >
              How <ArrowRight className="size-3.5" aria-hidden />
            </a>
          ),
        }
      }
      case 'double-down':
        return {
          key: `double-${move.project.id}`,
          title: `Make more like "${move.project.title}"`,
          detail: `Your best so far: ${compact.format(move.project.stats?.views ?? 0)} views${watched(move.project)}. Another video on a close question, or a series around it, is the surest next win.`,
          action: (
            <ButtonLink href="/ideas" size="sm" variant="go">
              Ideas
            </ButtonLink>
          ),
        }
      case 'breakouts':
        return {
          key: 'breakouts',
          title: "See what's breaking out in your niche",
          detail: `${move.days === null ? "Your niche hasn't been searched yet." : `Last searched ${plural(move.days, 'day')} ago.`} Videos getting many times their channel's usual views show what people want right now.`,
          action: (
            <ButtonLink href="/ideas#breakouts" size="sm" variant="go">
              Breakouts
            </ButtonLink>
          ),
        }
    }
  }

  /** A step of the video being made, when there is one. */
  const open = (step: StepId, hash = ''): Step['link'] =>
    making ? { href: `/projects/${making.id}?step=${step}${hash}`, label: 'Open' } : undefined
  const before: Step[] = [
    {
      title: 'Open strong',
      body: 'Most viewers decide in the first seconds whether to stay. Start on the problem or the payoff the title promised: no intro, no "in this video". The Script doctor rates your opening and writes stronger ones.',
      where: 'Script step → Script doctor → Check the hook',
      link: open('script'),
    },
    {
      title: 'Punchier lines and checked facts',
      body: 'Suggestions for funnier, tighter lines in your narrator’s voice, and claims that are wrong or overstated. A wrong fact costs trust in the comments, and health claims can get a video limited.',
      where: 'Script step → Script doctor → Punch up and check facts',
      link: open('script'),
    },
    {
      title: 'One idea in the title and thumbnail',
      body: 'Title and thumbnail sell the same single idea without repeating each other, and the opening delivers it straight away. The final check reads all three together.',
      where: 'Publish step → Final check → Review the packaging',
      link: open('publish', '#final-check'),
    },
    {
      title: 'A question for the comments',
      body: 'Cutroom writes a question viewers will want to answer and posts it from your channel as soon as the video is public.',
      where: 'Publish step → Comment for viewers',
      link: open('publish'),
    },
  ]
  const after: Step[] = [
    {
      title: 'Pin the question',
      body: 'Apps can’t pin comments, so pin it yourself: on the video, open the ⋮ menu next to the comment and choose Pin. It then stays at the top, where everyone sees it.',
      where: 'YouTube, on the video',
    },
    {
      title: 'Reply to comments in the first hour',
      body: 'Answer every comment while the video is new. Replies bring more comments, and an active comment section tells YouTube viewers care.',
      where: 'YouTube Studio → Comments',
      link: { href: studio('comments/inbox'), label: 'Comments', external: true },
    },
    {
      title: 'An end screen to your best related video',
      body: 'A video and a subscribe button in the last 5–20 seconds keep viewers on your channel. Set one up once, then use Import from video on each new one.',
      where: 'YouTube Studio → Content → Editor → End screen',
      link: { href: studio('videos/upload'), label: 'Studio', external: true },
    },
    {
      title: 'Link each Short to a long video',
      body: 'Set a Short’s related video to the long video it came from, so Shorts viewers get a link straight to it. Shorts bring new viewers; long videos earn the watch hours.',
      where: 'YouTube Studio → Content → Shorts → Related video',
      link: { href: studio('videos/short'), label: 'Studio', external: true },
    },
  ]
  const weekly: Step[] = [
    {
      title: 'Which videos worked',
      body: 'Views say whether people clicked; the average percentage watched says whether they stayed. Few views but well watched: the video is good, the title or thumbnail isn’t. Many views but left early: the opening didn’t deliver what the title promised.',
      where: 'Performance',
      link: { href: '/performance', label: 'Performance' },
    },
    {
      title: 'Where viewers leave',
      body: 'The drop-off graph on each video shows the moment people leave. Cutroom hands those lessons to Gemini for your next scripts.',
      where: 'Performance → a video → Where viewers leave',
      link: { href: '/performance', label: 'Performance' },
    },
    {
      title: 'What’s breaking out in your niche',
      body: `Videos getting many times their channel’s usual views, and why. ${
        settings.breakouts.scannedAt
          ? `Cutroom searches once a week; last time ${plural(Math.floor((now.getTime() - new Date(settings.breakouts.scannedAt).getTime()) / 86_400_000), 'day')} ago.`
          : channels.length > 0 && status.gemini.configured
            ? 'Cutroom searches once a week and hasn’t yet: open Breakouts to search now.'
            : 'Cutroom searches once a week once YouTube and Gemini are connected.'
      }`,
      where: 'Ideas → Breakouts',
      link: { href: '/ideas#breakouts', label: 'Breakouts' },
    },
    {
      title: 'What commenters ask for',
      body: 'Gemini reads your comments every week: the questions viewers ask become your next ideas with one click.',
      where: 'Performance → What viewers say',
      link: { href: '/performance', label: 'Performance' },
    },
  ]

  return (
    <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8 lg:py-12">
      <header className="mb-8">
        <h1 className="display text-[34px]">Grow the channel</h1>
        <p className="mt-2 max-w-[64ch] text-[14.5px] text-ink-2">
          What to do to get more people watching, most useful first. Cutroom checks what it can see for
          itself; tick off the rest as you go.
        </p>
        <ol className="mt-6 grid grid-cols-3 gap-2">
          {STAGES.map((s, i) => {
            const current = i === stage
            const goal = STAGES[i + 1]?.from
            return (
              <li
                key={s.id}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'min-w-0 rounded-[var(--radius-panel)] border px-3 py-2.5 sm:px-4 sm:py-3',
                  current ? 'border-ink bg-panel' : 'border-line',
                  i > stage && 'opacity-60',
                )}
              >
                <p className="text-[12px] font-medium text-ink-3">
                  Stage {i + 1}
                  {i < stage && ' · done'}
                </p>
                <p className="mt-0.5 text-[13.5px] leading-snug font-semibold sm:text-[14.5px]">{s.title}</p>
                {current ? (
                  <>
                    {goal !== undefined && (
                      <ProgressBar value={counts.long / goal} tone="you" className="mt-2.5" />
                    )}
                    <p className="mt-1.5 text-[12.5px] text-ink-2">
                      {counts.long}
                      {goal !== undefined && ` of ${goal}`}
                      <span className="hidden sm:inline"> long videos out</span>
                    </p>
                  </>
                ) : (
                  <p className="mt-1 hidden text-[12.5px] text-ink-3 sm:block">
                    {i === 0 ? 'Your first videos' : `From ${s.from} long videos`}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        <p className="mt-3 max-w-[68ch] text-[13.5px] text-ink-2">{STAGES[stage].detail}</p>
      </header>

      <div className="flex flex-col gap-6">
        <Panel title="Do this next" description="Worked out from your videos and channel as they are now.">
          <ol className="divide-y divide-line">
            {moves.map((move, i) => {
              const view = describe(move)
              return (
                <li
                  key={view.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <span
                    aria-hidden
                    className="tc grid size-7 place-items-center rounded-full bg-kodak text-[13px] font-semibold text-on-kodak"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">{view.title}</h3>
                    {view.detail && (
                      <p className="mt-1 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">
                        {view.detail}
                      </p>
                    )}
                  </div>
                  {view.action && (
                    <div className="col-start-2 flex flex-wrap items-start gap-2 sm:col-start-auto sm:justify-end">
                      {view.action}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </Panel>

        <Panel
          title="Your pace"
          description="Viewers and YouTube both learn when to expect you. Keep to the same days every week, and let Shorts fill the days between long videos."
          actions={
            <ButtonLink href="/schedule" size="sm" variant="ghost">
              Schedule
            </ButtonLink>
          }
        >
          <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            {[
              {
                label: 'Long videos out',
                value: String(counts.long),
                note: `${counts.recentLong} in the last 4 weeks`,
              },
              {
                label: 'Shorts out',
                value: String(counts.shorts),
                note: `${counts.recentShorts} in the last 4 weeks`,
              },
              {
                label: 'Next 7 days',
                value: String(counts.upcoming),
                note:
                  settings.slots.length > 0
                    ? `of ${plural(settings.slots.length, 'slot')} a week`
                    : 'no posting slots set',
              },
              {
                label: 'Last video out',
                value:
                  counts.daysSinceLast === null
                    ? '—'
                    : counts.daysSinceLast === 0
                      ? 'Today'
                      : plural(counts.daysSinceLast, 'day'),
                note: counts.daysSinceLast === null ? 'none yet' : counts.daysSinceLast === 0 ? '' : 'ago',
              },
            ].map((tile) => (
              <div key={tile.label} className="bg-panel px-5 py-4">
                <dt className="text-[12.5px] text-ink-3">{tile.label}</dt>
                <dd className="tc mt-1 text-[22px] font-semibold">{tile.value}</dd>
                <dd className="text-[12.5px] text-ink-2">{tile.note}</dd>
              </div>
            ))}
          </dl>
          {settings.shorts.count === 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-[13.5px] text-ink-2">
              Shorts from each long video are off: they are the cheapest way to reach new viewers.
              <Link href="/settings#shorts" className="font-medium text-ink underline underline-offset-4">
                Turn them on
              </Link>
            </p>
          )}
        </Panel>

        <Panel
          title="Make the channel easy to subscribe to"
          description="One-time steps. The rest of the channel's settings are on Channel setup."
        >
          <ul className="divide-y divide-line">
            {foundation.map((item) => (
              <TipRow key={item.id} item={item} anchored />
            ))}
          </ul>
        </Panel>

        <Panel
          title="For every video"
          description={`The same routine each time. The first four happen in Cutroom${
            making ? ` (Open goes to “${making.title || 'Untitled video'}”)` : ''
          }; the rest on YouTube once it's out.`}
        >
          <Routine heading="Before it posts" steps={before} start={1} />
          <Routine heading="After it posts" steps={after} start={before.length + 1} />
        </Panel>

        <Panel title="Every week" description="Ten minutes to see what worked and what to make next.">
          <Routine steps={weekly} start={1} />
        </Panel>

        <Panel
          title="Double down on what works"
          description={
            stage === 0
              ? `Opens at ${STAGES[1].from} long videos (${STAGES[1].from - counts.long} to go). Before that, one video's numbers say more about luck than about what works.`
              : 'Your best long videos so far. Make more on the same kind of question, and turn the best into a series.'
          }
        >
          {stage === 0 || best.length === 0 ? (
            <p className="px-5 py-4 text-[13.5px] text-ink-2">
              {stage === 0
                ? 'Until then, the routine above is what moves the channel: post on schedule and reply to every comment.'
                : 'No views counted yet: stats arrive a day or two after a video goes live.'}
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {best.map((video, i) => (
                <li key={video.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <span className="tc w-5 text-[13px] font-semibold text-ink-3">{i + 1}</span>
                  <Link
                    href={`/projects/${video.id}`}
                    className="min-w-0 flex-1 text-[14px] font-medium underline-offset-4 hover:underline"
                  >
                    {video.title}
                  </Link>
                  <span className="text-[13px] text-ink-2">
                    {compact.format(video.stats?.views ?? 0)} views
                    {video.stats?.averageViewPercent !== null &&
                      video.stats?.averageViewPercent !== undefined &&
                      ` · ${Math.round(video.stats.averageViewPercent)}% watched`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {stage > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
              <ButtonLink href="/ideas" size="sm">
                Ideas like these
              </ButtonLink>
              <ButtonLink href="/settings#shorts" size="sm" variant="ghost">
                Shorts from each video
              </ButtonLink>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Routine({ heading, steps, start }: { heading?: string; steps: Step[]; start: number }) {
  return (
    <section aria-label={heading} className="border-b border-line last:border-b-0">
      {heading && (
        <h3 className="px-5 pt-4 text-[12.5px] font-semibold tracking-wide text-ink-3 uppercase">
          {heading}
        </h3>
      )}
      <ol className="divide-y divide-line" start={start}>
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <span aria-hidden className="tc w-5 pt-px text-[14px] font-semibold text-ink-3">
              {start + i}
            </span>
            <div className="min-w-0">
              <h4 className="text-[14.5px] font-semibold">{step.title}</h4>
              <p className="mt-1 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">{step.body}</p>
              <p className="mt-1.5 text-[12.5px] text-ink-3">{step.where}</p>
            </div>
            {step.link && (
              <div className="col-start-2 sm:col-start-auto">
                <ButtonLink
                  href={step.link.href}
                  size="sm"
                  variant="ghost"
                  icon={step.link.external ? <ExternalLink className="size-3.5" /> : undefined}
                  {...(step.link.external ? external : {})}
                >
                  {step.link.label}
                </ButtonLink>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
