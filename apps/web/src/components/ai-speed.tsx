'use client'

import { useQueryClient } from '@tanstack/react-query'
import type { AiSpeedDTO } from '@/lib/dto'
import { timeAgo } from '@/lib/format'
import { keys, useAiSpeed } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { Button, Dot, Panel, Spinner } from './ui'

/** Each kind of AI work as its button calls it (server/ai-calls.ts names them as the timing log does). */
const KIND_LABEL: Record<string, string> = {
  'script (live)': 'Write with AI: the script',
  script: 'Write the script in one piece',
  storyboard: 'Split into scenes, each part',
  effects: 'Add effects, each part',
  'scene layers': 'Pictures from the Library',
  picture: 'Scene pictures and thumbnails',
  'post details': 'Post details',
  translation: 'Translate the title and description',
  'title translation': 'Second-chance titles, translated',
  'script doctor': 'Punch up and check facts',
  'hook check': 'Check the hook',
  'packaging review': 'Final check',
  ideas: 'Suggest ideas',
  'follow-up ideas': 'Ideas from your hits',
  'breakout searches': 'Breakout searches',
  'breakout idea': 'Idea from a breakout',
  'channel setup': 'Channel setup',
  'channel style': 'Learn from a channel',
  'comment replies': 'Replies to comments',
  'comment summary': 'Comment insights',
  poses: 'Pose suggestions',
  'Short moment': 'Pick a Short',
  'Short moments': 'Shorts after posting',
}

/** The kind of a single call's task ("storyboard part 3" is a storyboard part). */
function labelOf(task: string): string {
  const part = / part (\d+)$/.exec(task) ?? / \(part (\d+) of \d+\)$/.exec(task)
  const kind = task
    .replace(/ part \d+$/, '')
    .replace(/ \(part \d+ of \d+\)$/, '')
    .replace(/^(translation|title translation|subtitles) \(.*\)$/, '$1')
  const name = KIND_LABEL[kind]?.replace(/, each part$/, '') ?? kind
  return part ? `${name}, part ${part[1]}` : name
}

/** What a failed call's error code says, in a few words. */
const OUTCOME: Record<string, { text: string; tone: Tone }> = {
  timeout: { text: 'Ran out of time', tone: 'bad' },
  busy: { text: 'Gemini busy', tone: 'bad' },
  rate_limited: { text: 'Free-tier limit', tone: 'you' },
  daily_limit: { text: 'Daily limit', tone: 'you' },
  too_long: { text: 'Answer too long', tone: 'bad' },
  bad_output: { text: 'Unusable answer', tone: 'bad' },
  billing: { text: 'Needs billing', tone: 'you' },
  missing_key: { text: 'No API key', tone: 'you' },
  failed: { text: 'Failed', tone: 'bad' },
}

const secondsText = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s} s`)

/**
 * Settings → AI speed: how long Gemini took for each kind of work this past week, and the slowest
 * calls with why they failed, from Cutroom's own records (no Vercel logs needed).
 */
export function AiSpeed() {
  const { data, isLoading, isFetching } = useAiSpeed()
  const client = useQueryClient()
  return (
    <Panel
      title="AI speed"
      description="How long Gemini took for each kind of work over the last 7 days, from Cutroom's own records. A request stops after 4½ minutes; a long Split into scenes goes on in the background."
      actions={
        <Button
          variant="plain"
          size="sm"
          busy={isFetching && !isLoading}
          onClick={() => void client.invalidateQueries({ queryKey: keys.aiSpeed })}
        >
          Refresh
        </Button>
      }
    >
      {isLoading ? (
        <p className="flex items-center gap-2 px-5 py-5 text-[13.5px] text-ink-2">
          <Spinner /> Reading the records…
        </p>
      ) : !data || data.kinds.length === 0 ? (
        <p className="px-5 py-5 text-[13.5px] text-ink-2">No AI work in the last 7 days yet.</p>
      ) : (
        <AiSpeedTables data={data} />
      )}
    </Panel>
  )
}

function AiSpeedTables({ data }: { data: AiSpeedDTO }) {
  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead className="border-b border-line text-[12.5px] text-ink-3">
            <tr>
              <th className="px-5 py-2.5 font-medium">Work</th>
              <th className="px-3 py-2.5 text-right font-medium">Calls</th>
              <th
                className="px-3 py-2.5 text-right font-medium"
                title="Half the calls took at most this long"
              >
                Typical
              </th>
              <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Slowest</th>
              <th className="px-5 py-2.5 text-right font-medium">Failed</th>
            </tr>
          </thead>
          <tbody>
            {data.kinds.map((kind) => (
              <tr key={kind.task} className="border-b border-line last:border-b-0">
                <td className="px-5 py-2.5">{KIND_LABEL[kind.task] ?? kind.task}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{kind.calls}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{secondsText(kind.typicalSeconds)}</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">
                  {secondsText(kind.slowestSeconds)}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {kind.failed === 0 ? (
                    <span className="text-ink-3">0</span>
                  ) : (
                    <span>
                      {kind.failed}
                      {kind.outOfTime > 0 && (
                        <span className="text-ink-3"> ({kind.outOfTime} out of time)</span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-5 pb-2 pt-4">
        <h3 className="text-[13.5px] font-semibold">Slowest calls</h3>
      </div>
      <ul className="divide-y divide-line">
        {data.slowest.map((call, i) => {
          const outcome = call.error ? (OUTCOME[call.error] ?? OUTCOME.failed) : null
          return (
            <li
              key={`${call.at}-${i}`}
              className="grid gap-x-4 gap-y-1 px-5 py-2.5 text-[13.5px] sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <p className="truncate">{labelOf(call.task)}</p>
                <p className="text-[12.5px] text-ink-3">
                  {timeAgo(call.at)} · {call.model} · {call.tries} {call.tries === 1 ? 'try' : 'tries'}
                  {call.waitedSeconds >= 1 && `, ${secondsText(call.waitedSeconds)} waiting to ask again`}
                  {call.writtenTokens !== null &&
                    ` · ${call.writtenTokens.toLocaleString('en-US')} tokens written`}
                </p>
              </div>
              <p className="flex items-center gap-2 tabular-nums sm:justify-end">
                {outcome ? (
                  <>
                    <Dot tone={outcome.tone} />
                    {outcome.text} after {secondsText(call.seconds)}
                  </>
                ) : (
                  <>
                    <Dot tone="ok" />
                    {secondsText(call.seconds)}
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
