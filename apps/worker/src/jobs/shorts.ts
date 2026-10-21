// Shorts from a long video, made right after it posts: Gemini picks moments that work on their
// own, the voice-over is cut to each with ffmpeg, and the web app turns each into a 9:16 Short
// draft with its own copies of the pictures. Extra work: a problem here never fails the publish job.
import path from 'node:path'
import { hasGeminiKey, pickShortMoments } from '@cutroom/shared/ai'
import type { JobPayload } from '@cutroom/shared/protocol'
import { downloadTo, putLocalFile } from '@cutroom/shared/storage'
import { sceneRange, totalDuration } from '@cutroom/shared/timing'
import { createShort } from '../api'
import { runFfmpeg } from '../render/ffmpeg'
import { errorMessage, extensionOf } from '../util'
import type { JobContext } from './context'

/** Videos shorter than this have nothing to cut a Short from. */
const MIN_SOURCE_SECONDS = 90

export async function makeShorts(
  payload: JobPayload,
  ctx: JobContext,
  scenes: JobPayload['scenes'],
  title: string,
): Promise<void> {
  const { project, settings } = payload
  const wanted = settings.shorts?.count ?? 0
  const maxSeconds = settings.shorts?.maxSeconds ?? 60
  const length = project.voiceoverDuration ?? project.transcript?.duration ?? totalDuration(scenes)
  if (project.format === 'portrait') return ctx.step('shorts', 'skipped', 'This video is already a Short')
  if (wanted <= 0) return ctx.step('shorts', 'skipped', 'Turned off in Settings')
  if (!ctx.data.youtubeVideoId) return ctx.step('shorts', 'skipped', 'The video was not posted')
  if (!hasGeminiKey()) return ctx.step('shorts', 'skipped', 'Picking the moments needs Gemini')
  if (length < MIN_SOURCE_SECONDS || scenes.length < 3) {
    return ctx.step('shorts', 'skipped', 'The video is too short to cut Shorts from')
  }

  await ctx.step('shorts', 'running', 'Picking the best moments')
  try {
    // Kept in the job, so a retry makes the same Shorts instead of new ones.
    let picks = ctx.data.shortPicks
    if (!picks) {
      picks = await pickShortMoments({
        title,
        topic: project.topic,
        scenes: scenes.map((s) => ({ start: s.start, end: s.end, narration: s.narration })),
        maxSeconds,
        count: wanted,
      })
      await ctx.result({ shortPicks: picks })
    }
    const made = [...(ctx.data.shortIds ?? [])]
    let voice: string | null = null
    if (project.voiceoverUrl && made.length < picks.length) {
      voice = path.join(ctx.workDir, `short-source${extensionOf(project.voiceoverUrl, '.mp3')}`)
      await downloadTo(project.voiceoverUrl, voice, payload.appUrl)
    }
    for (const [i, pick] of picks.entries()) {
      if (i < made.length) continue
      ctx.progress('shorts', i / picks.length, `Making Short ${i + 1} of ${picks.length}`)
      const range = sceneRange(scenes, pick.startIndex, pick.endIndex, length)
      const newId = crypto.randomUUID()
      let voiceover: { url: string; name: string; duration: number } | null = null
      if (voice) {
        const clip = path.join(ctx.workDir, `short-${i + 1}.mp3`)
        await runFfmpeg(
          [
            '-i',
            voice,
            '-ss',
            range.start.toFixed(3),
            '-to',
            range.end.toFixed(3),
            '-vn',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '160k',
            clip,
          ],
          { signal: ctx.signal },
        )
        const stored = await putLocalFile(
          `projects/${newId}/voiceover/short-voiceover.mp3`,
          clip,
          'audio/mpeg',
        )
        voiceover = { url: stored.url, name: 'short-voiceover.mp3', duration: range.end - range.start }
      }
      made.push(
        await createShort(ctx.jobId, {
          newId,
          from: pick.startIndex,
          to: pick.endIndex,
          title: pick.title,
          voiceover,
        }),
      )
      await ctx.result({ shortIds: made })
    }
    await ctx.step(
      'shorts',
      'done',
      made.length
        ? `Made ${made.length} Short ${made.length === 1 ? 'draft' : 'drafts'}`
        : 'No good moment for a Short',
    )
  } catch (error) {
    // The video is already up: Shorts are extra, so a problem here never fails the job.
    if (ctx.signal.aborted) throw error
    await ctx.warn(`Shorts were not made: ${errorMessage(error)}`)
    await ctx.step('shorts', 'skipped', 'Could not make Shorts')
  }
}
