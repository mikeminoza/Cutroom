import { translatePost } from '@cutroom/shared/ai'
import { EMPTY_POST } from '@cutroom/shared/types'
import { z } from 'zod'
import { badRequest, readJson, route } from '@/server/http'
import { getProjectRow, updateProject } from '@/server/projects'
import { getSettings } from '@/server/settings'

// A few Gemini calls for many languages (AI_BUDGET_MS ends them in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Translates the post's title and description into `languages` (default: the ones in Settings),
 * replacing earlier translations into those languages and keeping the rest.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({ languages: z.array(z.string().max(20)).max(20).optional() }),
  )
  const project = await getProjectRow(id)
  const post = { ...EMPTY_POST, ...project.post }
  if (!post.title.trim()) badRequest('Write the title first.')
  const languages = body.languages ?? (await getSettings()).defaults.translateTo
  if (languages.length === 0) badRequest('Pick languages to translate into in Settings first.')
  const added = await translatePost({
    title: post.title,
    description: post.description,
    from: post.language,
    to: languages,
  })
  const kept = (post.translations ?? []).filter((t) => !added.some((a) => a.language === t.language))
  const next = { ...post, translations: [...kept, ...added] }
  await updateProject(id, { post: next })
  return next
})
