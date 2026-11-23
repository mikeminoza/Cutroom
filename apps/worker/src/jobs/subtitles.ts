// Subtitles in the video's other languages (Settings → Defaults), added once the main captions are
// on YouTube. Gemini translates the main track's lines, and each language goes up as a caption
// track of its own on the very same times. They are extras: whatever goes wrong becomes a warning,
// and the video is posted all the same.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { translateCaptions } from '@cutroom/shared/ai'
import { cuesToSrt, parseSrt, subtitleLanguages, subtitleText } from '@cutroom/shared/captions'
import { type OAuthClient, uploadCaptions } from '@cutroom/shared/google'
import { languageName, type PostDetails } from '@cutroom/shared/types'
import { errorMessage } from '../util'
import type { JobContext } from './context'

/** "Spanish and Portuguese" */
export function languageList(codes: string[]): string {
  const names = codes.map(languageName)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Adds the subtitles the video doesn't have yet (see subtitleLanguages for which, and why at most
 * two). `srtFile` is the main caption track, already on YouTube. Returns the languages the video
 * has subtitles in now, including ones a previous run of the step added.
 */
export async function addSubtitles(
  input: {
    youtube: OAuthClient
    videoId: string
    srtFile: string
    post: PostDetails
    /** Settings → Defaults: off on a day with more uploads than the YouTube quota leaves room for. */
    enabled: boolean
  },
  ctx: JobContext,
): Promise<string[]> {
  const own = input.post.language || 'en'
  const languages = input.enabled ? subtitleLanguages(input.post.translations, own) : []
  const tracks = () => ctx.data.captionTracks ?? []
  const missing = languages.filter((code) => !tracks().includes(code))
  if (missing.length) {
    // Languages not added, by the reason: one warning for each reason.
    const failed = new Map<string, string[]>()
    const fail = (reason: string, codes: string[]) =>
      failed.set(reason, [...(failed.get(reason) ?? []), ...codes])
    try {
      const cues = parseSrt(await readFile(input.srtFile, 'utf8'))
      if (cues.length) {
        await ctx.step(
          'finish',
          'running',
          `Gemini is translating the subtitles into ${languageList(missing)}`,
        )
        const translations = await translateCaptions({
          cues: cues.map((cue) => cue.text),
          from: own,
          to: missing,
          signal: ctx.signal,
        })
        for (const translation of translations) {
          if ('error' in translation) {
            fail(translation.error, [translation.language])
            continue
          }
          const { language } = translation
          try {
            await ctx.step('finish', 'running', `Adding the ${languageName(language)} subtitles`)
            const file = path.join(ctx.workDir, `captions-${language}.srt`)
            // The main track's times, line for line: only the words change.
            const srt = cuesToSrt(cues.map((cue, i) => ({ ...cue, text: subtitleText(translation.cues[i]) })))
            await writeFile(file, srt)
            await uploadCaptions(input.youtube, input.videoId, file, language)
            await ctx.result({ captionTracks: [...tracks(), language] })
          } catch (error) {
            if (ctx.signal.aborted) throw error
            fail(errorMessage(error), [language])
          }
        }
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      fail(
        errorMessage(error),
        missing.filter((code) => !tracks().includes(code)),
      )
    }
    for (const [reason, codes] of failed)
      await ctx.warn(`Subtitles in ${languageList(codes)} not added: ${reason}`)
  }
  return languages.filter((code) => tracks().includes(code))
}
