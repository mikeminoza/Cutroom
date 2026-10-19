// Listens to the voice-over and moves every scene to where its words are spoken.
import path from 'node:path'
import { transcribeVoiceover } from '@cutroom/shared/ai'
import { alignScenes, scenesFromSegments, wordsFromSegments } from '@cutroom/shared/align'
import type { JobPayload } from '@cutroom/shared/protocol'
import { downloadTo } from '@cutroom/shared/storage'
import { audioMime, extensionOf, probeSeconds } from '../util'
import type { JobContext } from './context'

export async function runRetime(payload: JobPayload, ctx: JobContext): Promise<void> {
  const { project, scenes } = payload
  if (!project.voiceoverUrl) throw new Error('Upload a voice-over first.')

  await ctx.step('transcribe', 'running', 'Downloading the voice-over')
  const ext = extensionOf(project.voiceoverUrl, '.mp3')
  const audioPath = path.join(ctx.workDir, `voiceover${ext}`)
  await downloadTo(project.voiceoverUrl, audioPath, payload.appUrl)
  const duration = await probeSeconds(audioPath)

  await ctx.step('transcribe', 'running', 'Gemini is listening to the voice-over')
  const segments = await transcribeVoiceover(audioPath, audioMime(ext), duration, project.language)
  if (segments.length === 0) throw new Error('No speech was found in the voice-over.')
  const words = wordsFromSegments(segments)
  await ctx.result({ transcript: { duration, segments, words } })
  await ctx.step('transcribe', 'done', `${words.length} words heard in ${Math.round(duration)} seconds`)

  await ctx.step('align', 'running', 'Matching scenes to the speech')
  const scripted = scenes.filter((s) => s.narration.trim())
  if (scripted.length === 0) {
    const created = scenesFromSegments(segments, project.pace || 6, duration)
    await ctx.result({ createdScenes: created })
    await ctx.step('align', 'done', `Made ${created.length} scenes from the voice-over`)
    return
  }
  const ordered = [...scenes].sort((a, b) => a.index - b.index)
  const { times, matchedRatio } = alignScenes(
    ordered.map((s) => s.narration),
    words,
    duration,
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
