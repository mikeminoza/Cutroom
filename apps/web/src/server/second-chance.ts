// Second-chance titles (the Publish step's Second chance panel, and a move on the Grow page): a
// public video doing much worse than the channel's usual a couple of days in can go out under
// another title, one of the options Cutroom already wrote or your own. Spotting one uses the stats
// the daily refresh stores (shared/second-chance.ts), with no AI and no YouTube call. YouTube
// changes only when you click: 51 quota units, plus one Flash-Lite call when the video has its
// title in other languages. Each change is kept in the post (titleChanges), so the video isn't
// offered again for a week and the title can be changed back.
import { AiError, translateTitle } from '@cutroom/shared/ai'
import { clientFromRefresh, retitleVideo } from '@cutroom/shared/google'
import { withUsual } from '@cutroom/shared/hits'
import { findSlowStarters, titleChangesOf, titleProblem } from '@cutroom/shared/second-chance'
import { EMPTY_POST, type PostDetails, translationBasis } from '@cutroom/shared/types'
import { resolveChannel } from '@/lib/channels'
import type { ProjectFull, SecondChanceDTO, SlowStarterDTO } from '@/lib/dto'
import { listChannels } from './connections'
import type { ProjectRow } from './db/schema'
import { postedVideos, titleOf } from './hits'
import { badRequest, HttpError } from './http'
import { getProjectFull, getProjectRow, updateProject } from './projects'
import { googleFailure } from './youtube'

/** Changes kept per project: enough to say what it was and change it back. */
const KEEP_CHANGES = 10

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Posted public videos as the slow-start rule sees them, with when each was last retitled. */
async function slowCandidates() {
  return (await postedVideos()).map((video) => ({
    ...video,
    titleChangedAt: titleChangesOf(video.project.post ?? {}, video.project.youtubeVideoId).at(-1)?.at ?? null,
  }))
}

/** The videos worth a new title now, newest first (the Grow page offers the first). No YouTube call. */
export async function listSlowStarters(): Promise<SlowStarterDTO[]> {
  return findSlowStarters(await slowCandidates()).map((video) => ({
    id: video.id,
    title: titleOf(video.project),
    format: video.format,
    youtubeVideoId: video.project.youtubeVideoId as string,
    views: video.views,
    usual: video.usual,
    peers: video.peers,
    publishedAt: video.publishedAt,
  }))
}

/**
 * What the Publish step's Second chance panel shows for a project: how the video is doing next to
 * the usual, its title ideas not tried yet, and the changes made so far. No YouTube call.
 */
export async function secondChance(projectId: string): Promise<SecondChanceDTO> {
  const project = await getProjectRow(projectId)
  const post = { ...EMPTY_POST, ...project.post }
  const changes = titleChangesOf(post, project.youtubeVideoId)
  // Titles it already had come back through "Change back", not as ideas.
  const tried = [post.title, ...changes.map((c) => c.from)]
  const options = [...new Set(post.titleOptions.map((t) => t.trim()))].filter(
    (option) => option && !tried.some((t) => same(t, option)),
  )
  const candidates = project.youtubeVideoId ? await slowCandidates() : []
  const compared = withUsual(candidates).find((c) => c.video.id === project.id)
  return {
    slow: findSlowStarters(candidates).some((video) => video.id === project.id),
    views: project.stats?.views ?? null,
    usual: compared ? Math.round(compared.usual) : null,
    peers: compared?.peers ?? 0,
    days: compared ? Math.floor(compared.age) : null,
    title: post.title,
    options: project.youtubeVideoId ? options : [],
    changes,
    languages: (post.translations ?? []).map((t) => t.language).filter((code) => code !== post.language),
  }
}

/**
 * Changes a posted video's title on YouTube: only from your click, after you confirmed it. The
 * rest of its details stay as they are; its titles in other languages get the new one, translated
 * with one Flash-Lite call. Saves the new title and the change. Returns the project.
 */
export async function changeTitle(projectId: string, requested: string): Promise<ProjectFull> {
  const project = await getProjectRow(projectId)
  const videoId = project.youtubeVideoId
  if (!videoId) badRequest("This video isn't on YouTube yet.")
  const title = requested.trim()
  const problem = titleProblem(title)
  if (problem) badRequest(problem)
  const post: PostDetails = { ...EMPTY_POST, ...project.post }
  if (title === post.title.trim()) badRequest('The video has this title already.')
  const channel = resolveChannel(await listChannels(), project.channelId, project.channelYoutubeId)
  if (!channel) badRequest("This video's channel isn't connected. Reconnect it in Settings first.")

  let result: Awaited<ReturnType<typeof retitleVideo>>
  try {
    // Inside the try: a missing Google client setup is a message, not a crash.
    const client = clientFromRefresh(channel.refreshToken)
    result = await retitleVideo(client, videoId, title, (languages, from) =>
      translateTitle({ title, from, to: languages }),
    )
  } catch (error) {
    if (error instanceof AiError || error instanceof HttpError) throw error
    googleFailure(error)
  }

  // Read again: anything saved while YouTube and Gemini answered is kept.
  const latest = await getProjectRow(projectId)
  await updateProject(projectId, { post: retitled(latest, videoId, title, result) })
  return getProjectFull(projectId)
}

/** The post with its new title, the change remembered, and its translated titles brought along. */
function retitled(
  project: ProjectRow,
  videoId: string,
  title: string,
  result: { previous: string; localized: Record<string, string> },
): PostDetails {
  const post: PostDetails = { ...EMPTY_POST, ...project.post }
  // What YouTube had: the title field can be edited in Cutroom after posting without reaching it.
  const from = result.previous || post.title
  const basis = translationBasis(post.title, post.description)
  return {
    ...post,
    title,
    titleChanges: [
      // Changes on an earlier upload of the project say nothing about this one.
      ...titleChangesOf(post, videoId),
      { videoId, from, at: new Date().toISOString(), views: project.stats?.views ?? 0 },
    ].slice(-KEEP_CHANGES),
    translations: post.translations?.map((t) =>
      result.localized[t.language]
        ? {
            ...t,
            title: result.localized[t.language],
            // Still up to date only if it was before: a description changed since stays flagged.
            basis: t.basis === basis ? translationBasis(title, post.description) : t.basis,
          }
        : t,
    ),
  }
}
