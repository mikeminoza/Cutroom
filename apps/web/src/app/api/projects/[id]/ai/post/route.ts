import { writePostDetails } from '@cutroom/shared/ai'
import { buildThumbnailPrompt } from '@cutroom/shared/prompts'
import { totalDuration } from '@cutroom/shared/timing'
import { EMPTY_POST } from '@cutroom/shared/types'
import { searchTermsFor, topTitles } from '@/server/analytics'
import { badRequest, route } from '@/server/http'
import { getCharacters, getProjectRow, getScenes, toCharacterDTO, updateProject } from '@/server/projects'
import { getSettings } from '@/server/settings'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const project = await getProjectRow(id)
  const scenes = await getScenes(id)
  if (scenes.length === 0 && !project.script.trim()) badRequest('Add a script or scenes first.')
  const settings = await getSettings()
  const characters = (await getCharacters(id)).map(toCharacterDTO)
  const draft = await writePostDetails({
    title: project.title,
    topic: project.topic,
    audience: project.audience,
    language: project.language,
    format: project.format,
    duration: project.voiceoverDuration ?? totalDuration(scenes),
    script: project.script,
    scenes: scenes.map((s) => ({ start: s.start, narration: s.narration })),
    defaultTags: settings.defaults.tags,
    descriptionFooter: settings.defaults.descriptionFooter,
    topTitles: await topTitles(project.channelId, project.channelYoutubeId),
    searchTerms: (await searchTermsFor(project.channelId, project.channelYoutubeId)).map((t) => t.term),
    market: settings.niche.market,
  })
  const current = { ...EMPTY_POST, ...project.post }
  const post = {
    ...current,
    titleOptions: draft.titleOptions,
    title: current.title.trim() || draft.titleOptions[0] || '',
    description: draft.description,
    tags: draft.tags,
    hashtags: draft.hashtags,
    chapters: draft.chapters,
    thumbnailIdeas: draft.thumbnailIdeas,
    // A comment you wrote yourself stays.
    comment: current.comment?.trim() || draft.comment,
    thumbnailPrompt: buildThumbnailPrompt(draft.thumbnailIdeas[0] ?? project.topic, {
      artStyle: project.artStyle,
      characters,
      text: draft.thumbnailText,
    }),
  }
  await updateProject(id, { post })
  return post
})
