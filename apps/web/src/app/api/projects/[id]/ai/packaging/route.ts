import { reviewPackaging } from '@cutroom/shared/ai'
import { thumbnailWords } from '@cutroom/shared/prompts'
import { sentencesOf } from '@cutroom/shared/timing'
import { scriptText, scriptVoice } from '@/server/drafting'
import { route } from '@/server/http'
import { getProjectRow } from '@/server/projects'

export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * The final check's AI part: do the title, thumbnail, description and opening sell one video,
 * honestly, and is anything in them likely to limit ads or reach.
 */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  const post = project.post
  const notes = await reviewPackaging({
    title: post?.title || project.title,
    thumbnailText: thumbnailWords(post?.thumbnailPrompt ?? ''),
    thumbnailIdea: post?.thumbnailIdeas?.[0] ?? '',
    description: post?.description ?? '',
    opening: sentencesOf(await scriptText(id))
      .slice(0, 3)
      .join(' '),
    audience: (await scriptVoice(id)).audience,
  })
  return { notes }
})
