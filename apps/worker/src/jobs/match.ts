// The "Match scenes to the speech" step, shared by the uploaded voice-over (retime) and the
// AI voice-over (voice) jobs.
import { alignScenes, scenesFromSegments } from '@cutroom/shared/align'
import type { JobPayload } from '@cutroom/shared/protocol'
import type { Transcript } from '@cutroom/shared/types'
import type { JobContext } from './context'

export async function matchScenes(
  payload: JobPayload,
  ctx: JobContext,
  transcript: Transcript,
): Promise<void> {
  const { project, scenes } = payload
  await ctx.step('align', 'running', 'Matching scenes to the speech')
  const scripted = scenes.filter((s) => s.narration.trim())
  if (scripted.length === 0) {
    const created = scenesFromSegments(transcript.segments, project.pace || 6, transcript.duration)
    await ctx.result({ createdScenes: created })
    await ctx.step('align', 'done', `Made ${created.length} scenes from the voice-over`)
    return
  }
  const ordered = [...scenes].sort((a, b) => a.index - b.index)
  const { times, matchedRatio } = alignScenes(
    ordered.map((s) => s.narration),
    transcript.words,
    transcript.duration,
  )
  await ctx.result({
    sceneTimes: ordered.map((s, i) => ({ id: s.id, start: times[i].start, end: times[i].end })),
    matchedRatio,
  })
  const percent = Math.round(matchedRatio * 100)
  await ctx.step(
    'align',
    'done',
    percent >= 70
      ? `${percent}% of the script matched the voice-over`
      : `Only ${percent}% of the script matched — check the timeline, the voice-over may differ from the script`,
  )
}
