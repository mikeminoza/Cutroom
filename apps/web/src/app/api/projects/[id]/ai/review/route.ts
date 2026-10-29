import { reviewScript } from '@cutroom/shared/ai'
import { scriptText, scriptVoice } from '@/server/drafting'
import { badRequest, route } from '@/server/http'
import { getProjectRow } from '@/server/projects'

// A careful read of a long script (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** "Punch up and check facts": lines to improve in the narrator's voice, and the claims to check. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const script = await scriptText(id)
  if (!script.trim()) badRequest('Write or paste the script first.')
  const project = await getProjectRow(id)
  return reviewScript({ script, title: project.post?.title || project.title, voice: await scriptVoice(id) })
})
