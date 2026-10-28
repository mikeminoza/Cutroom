'use client'

import { type Goal, type MonetizationPath, monetizationTiers } from '@cutroom/shared/setup'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink } from 'lucide-react'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ChannelDTO, MonetizationDTO } from '@/lib/dto'
import { ButtonLink, Panel, ProgressBar } from './ui'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US')

/** "about 3 weeks", "about 5 months", "more than 2 years". */
function eta(days: number): string {
  if (days <= 0) return 'reached'
  if (days < 14) return `about ${days} ${days === 1 ? 'day' : 'days'}`
  if (days < 60) return `about ${Math.round(days / 7)} weeks`
  if (days < 730) return `about ${Math.round(days / 30)} months`
  return 'more than 2 years'
}

/** When a path gets there at this pace, or what holds it back. */
function outlook(path: MonetizationPath): string | null {
  if (path.ready) return null
  if (path.days !== null) return `${eta(path.days)} at this pace`
  const capped = path.goals.find((g) => g.ceiling !== null && g.have !== null && g.ceiling < g.need)
  if (capped?.ceiling != null) {
    return `not at this pace: ${capped.label.split(',')[0].toLowerCase()} level off near ${number(capped.ceiling)}`
  }
  return null
}

const number = (n: number) => (n >= 100_000 ? compact.format(n) : whole.format(n))

/**
 * The road to monetization: the Partner Program's two levels, the two ways into each (long videos
 * or Shorts), how far the channel is on each goal, and when it gets there at its pace of the last
 * 28 days.
 */
export function RoadToMonetization({ channel }: { channel: ChannelDTO | null }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['monetization', channel?.id ?? 'none'],
    queryFn: () =>
      api.get<MonetizationDTO>(`/api/channel/monetization?channel=${encodeURIComponent(channel?.id ?? '')}`),
    enabled: Boolean(channel),
    retry: false,
    staleTime: 10 * 60_000,
  })
  const tiers = data ? monetizationTiers(data.numbers) : []
  const studio = data?.youtubeId
    ? `https://studio.youtube.com/channel/${data.youtubeId}/monetization`
    : 'https://studio.youtube.com/'

  return (
    <Panel
      title="Road to monetization"
      description="What YouTube asks before it pays you, and how far your channel is. Paces are from the last 28 days; watch hours and Shorts views count over a rolling window, so at a steady pace they level off rather than keep growing."
      actions={
        <ButtonLink
          href={studio}
          size="sm"
          variant="ghost"
          icon={<ExternalLink className="size-3.5" />}
          target="_blank"
          rel="noreferrer"
        >
          Studio → Earn
        </ButtonLink>
      }
    >
      {!channel ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">Connect YouTube in Settings to track this.</p>
      ) : isLoading ? (
        <div className="m-5 h-32 animate-pulse-soft rounded-[var(--radius-control)] bg-line/50" />
      ) : error ? (
        <p className="px-5 py-4 text-[13.5px] text-bad">{errorText(error)}</p>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          {data?.note && (
            <p className="rounded-[var(--radius-control)] bg-kodak-wash px-3 py-2 text-[13px] text-kodak-ink">
              {data.note}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {tiers.map((tier) => (
              <section
                key={tier.id}
                aria-label={tier.name}
                className={cn(
                  'rounded-[var(--radius-control)] border px-4 py-3.5',
                  tier.ready ? 'border-ok bg-ok-wash' : 'border-line',
                )}
              >
                <h3 className="flex items-center gap-2 text-[14.5px] font-semibold">
                  {tier.ready && <Check className="size-4 text-ok" aria-hidden />}
                  {tier.name}
                  {tier.ready && <span className="text-[12.5px] font-medium text-ok">You can apply</span>}
                </h3>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{tier.unlocks}</p>
                <div className="mt-3 flex flex-col gap-3.5">
                  {tier.paths.map((path) => (
                    <div key={path.label}>
                      <p className="text-[12.5px] font-medium text-ink-2">
                        {path.label}
                        {outlook(path) && <span className="font-normal text-ink-3"> · {outlook(path)}</span>}
                      </p>
                      <ul className="mt-1.5 flex flex-col gap-2">
                        {path.goals.map((goal) => (
                          <GoalRow key={goal.label} goal={goal} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            YouTube also needs 2-Step Verification on your Google account, no active Community Guidelines
            strikes, an AdSense account to be paid, and that you live where the Partner Program is offered. It
            counts only public watch hours, not Shorts-feed views, so Studio’s numbers can be a little lower
            than these.
          </p>
        </div>
      )}
    </Panel>
  )
}

function GoalRow({ goal }: { goal: Goal }) {
  const done = goal.have !== null && goal.have >= goal.need
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-ink-2">{goal.label}</span>
        <span className="tc shrink-0">
          {goal.have === null ? (
            <span className="text-ink-3">unknown</span>
          ) : (
            <>
              <span className={cn('font-semibold', done && 'text-ok')}>{number(goal.have)}</span>
              <span className="text-ink-3"> / {number(goal.need)}</span>
            </>
          )}
        </span>
      </div>
      <ProgressBar
        value={goal.have === null ? 0 : Math.min(1, goal.have / goal.need)}
        tone={done ? 'ok' : 'you'}
        className="mt-1"
      />
    </li>
  )
}
