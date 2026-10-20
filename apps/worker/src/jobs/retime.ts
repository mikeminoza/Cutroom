// Listens to the voice-over and moves every scene to where its words are spoken.
import path from 'node:path'
import { transcribeVoiceover } from '@cutroom/shared/ai'
import { refineTranscript, type Span } from '@cutroom/shared/align'
import type { JobPayload } from '@cutroom/shared/protocol'
import { downloadTo } from '@cutroom/shared/storage'
import { detectSilences } from '../audio'
import { audioMime, errorMessage, extensionOf, probeSeconds } from '../util'
import type { JobContext } from './context'
import { matchScenes } from './match'

export async function runRetime(payload: JobPayload, ctx: JobContext): Promise<void> {
  const { project } = payload
  if (!project.voiceoverUrl) throw new Error('Upload a voice-over first.')

  await ctx.step('transcribe', 'running', 'Downloading the voice-over')
  const ext = extensionOf(project.voiceoverUrl, '.mp3')
  const audioPath = path.join(ctx.workDir, `voiceover${ext}`)
  await downloadTo(project.voiceoverUrl, audioPath, payload.appUrl)
  const duration = await probeSeconds(audioPath)

  await ctx.step('transcribe', 'running', 'Gemini is listening to the voice-over')
  const segments = await transcribeVoiceover(audioPath, audioMime(ext), duration, project.language)
  if (segments.length === 0) throw new Error('No speech was found in the voice-over.')

  // The pauses in the recording put sentence edges and words where they are really spoken.
  await ctx.step('transcribe', 'running', 'Finding the pauses between words')
  let silences: Span[] = []
  try {
    silences = await detectSilences(audioPath, duration, ctx.signal)
  } catch (error) {
    if (ctx.signal.aborted) throw error
    console.warn(`[${ctx.jobId}] pause detection failed, using estimated word timing:`, errorMessage(error))
  }
  const refined = refineTranscript(segments, silences, duration)
  const transcript = { duration, segments: refined.segments, words: refined.words }
  await ctx.result({ transcript })
  await ctx.step(
    'transcribe',
    'done',
    `${refined.words.length} words heard in ${Math.round(duration)} seconds`,
  )

  await matchScenes(payload, ctx, transcript)
}
