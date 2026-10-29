import { checkHook } from '@cutroom/shared/ai'
import { thumbnailWords } from '@cutroom/shared/prompts'
import { retentionLessons } from '@/server/analytics'
import { scriptText, scriptVoice } from '@/server/drafting'
import { badRequest, route } from '@/server/http'
import { getProjectRow } from '@/server/projects'

export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * "Check the hook": how well the first 15 seconds hold a new viewer, whether they pay off the
 * title and thumbnail, and three stronger openings, knowing where the channel's last videos lost
 * viewers.
 */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const script = await scriptText(id)
  if (!script.trim()) badRequest('Write or paste the script first.')
  const project = await getProjectRow(id)
  return checkHook({
    script,
    title: project.post?.title || project.title,
    thumbnailText: thumbnailWords(project.post?.thumbnailPrompt ?? ''),
    voice: await scriptVoice(id),
    lessons: await retentionLessons(project.channelId, project.channelYoutubeId, project.format),
  })
})
