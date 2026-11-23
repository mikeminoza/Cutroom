import { mapPartials, reviewPackaging } from '@cutroom/shared/ai'
import { thumbnailWords } from '@cutroom/shared/prompts'
import { sentencesOf } from '@cutroom/shared/timing'
import { scriptText, scriptVoice } from '@/server/drafting'
import { route } from '@/server/http'
import { getProjectRow } from '@/server/projects'
import { answer } from '@/server/stream'

export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * The final check's AI part: do the title, thumbnail, description and opening sell one video,
 * honestly, and is anything in them likely to limit ads or reach. Each note is sent as Gemini
 * writes it when the page asks (server/stream.ts).
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  const post = project.post
  const input = {
    title: post?.title || project.title,
    thumbnailText: thumbnailWords(post?.thumbnailPrompt ?? ''),
    thumbnailIdea: post?.thumbnailIdeas?.[0] ?? '',
    description: post?.description ?? '',
    opening: sentencesOf(await scriptText(id))
      .slice(0, 3)
      .join(' '),
    audience: (await scriptVoice(id)).audience,
  }
  return answer(request, async (events) => ({
    notes: await reviewPackaging(
      input,
      mapPartials(events, (notes) => ({ notes })),
    ),
  }))
})
