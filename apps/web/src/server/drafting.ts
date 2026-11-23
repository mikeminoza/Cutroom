// Drafting with AI as server functions: the buttons' routes call them, and so does the weekly
// autopilot, which turns ideas into ready drafts on its own (script, scenes, and pictures from
// the Library), so all that is left is recording the voice-over and checking.
import { spaceEffects } from '@cutroom/shared/accents'
import {
  type DraftEvents,
  draftScript,
  generateIdeas,
  hasGeminiKey,
  pickSceneLayers,
  type SceneDraft,
  type ScriptBrief,
  splitScript,
  suggestEffects,
  writePostDetails,
  writeScript,
} from '@cutroom/shared/ai'
import { alignScenes } from '@cutroom/shared/align'
import { buildThumbnailPrompt } from '@cutroom/shared/prompts'
import { layoutByEstimate, totalDuration } from '@cutroom/shared/timing'
import {
  EMPTY_POST,
  normalizeTransition,
  type PostDetails,
  type SceneLayer,
  type SeriesTemplate,
} from '@cutroom/shared/types'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { DraftBatchDTO } from '@/lib/dto'
import { STOPPED_BY_YOU } from '@/lib/tasks'
import { retentionLessons, searchTermsFor, topTitles } from './analytics'
import { db, schema } from './db'
import type { TaskRow } from './db/schema'
import { badRequest } from './http'
import { notify } from './notify'
import {
  createProject,
  getCharacters,
  getProjectRow,
  getScenes,
  replaceScenes,
  toCharacterDTO,
  touchProject,
  updateProject,
} from './projects'
import { getSeries } from './series'
import { appUrl, getSettings } from './settings'
import { batchTasks, cancelBatch, latestBatchId, queueBatch } from './tasks'

type ProjectRow = Awaited<ReturnType<typeof getProjectRow>>

/** What Gemini writes the project's script from: its brief, the channel's rules and lessons. */
async function scriptBrief(project: ProjectRow, notes: string): Promise<ScriptBrief> {
  if (!project.topic.trim()) badRequest('Add a topic on the Brief step first.')
  const settings = await getSettings()
  return {
    topic: project.topic,
    audience: project.audience,
    tone: project.tone,
    language: project.language,
    minutes: project.targetMinutes,
    format: project.format,
    notes: notes || project.notes,
    characters: (await getCharacters(project.id))
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), description: c.description })),
    market: settings.niche.market,
    lessons: await retentionLessons(project.channelId, project.channelYoutubeId, project.format),
    rules: settings.niche.rules ?? [],
  }
}

/** Gemini writes the project's script from its brief; an empty title takes the script's. */
export async function writeProjectScript(id: string, notes = ''): Promise<void> {
  const project = await getProjectRow(id)
  const result = await writeScript(await scriptBrief(project, notes))
  await updateProject(id, { script: result.script, title: project.title.trim() || result.title })
}

/** Checks a project can be drafted before anything is written: it has a topic. */
export async function assertDraftable(id: string): Promise<void> {
  await scriptBrief(await getProjectRow(id), '')
}

/**
 * Gemini writes the script live and storyboards it as it goes (draftScript): `events` hear the
 * script as it's written and each part of the storyboard as it's done. The script is saved, an
 * empty title takes the script's, and the scenes replace the old ones. When only the storyboard
 * fails, the script is still saved, the old scenes stay, and the reason comes back.
 */
export async function draftProject(
  id: string,
  notes: string,
  events: DraftEvents = {},
): Promise<{ storyboardError: string | null }> {
  const project = await getProjectRow(id)
  const brief = await scriptBrief(project, notes)
  const characters = await getCharacters(id)
  const draft = await draftScript(
    brief,
    {
      pace: project.pace,
      artStyle: project.artStyle,
      format: project.format,
      characters: characters.map((c) => ({ name: c.name, description: c.description })),
    },
    events,
  )
  await updateProject(id, { script: draft.script, title: project.title.trim() || draft.title })
  if (draft.scenes) await placeScenes(id, draft.scenes)
  return { storyboardError: draft.storyboardError }
}

/**
 * Gemini writes the post details from the script and scenes: title ideas (and the title, unless you
 * wrote one), description, tags, chapters, thumbnail ideas and the comment for viewers (unless you
 * wrote one). Saved, and returned.
 */
export async function writePost(id: string): Promise<PostDetails> {
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
}

/** Gemini storyboards the script into timed scenes, lined up with the voice-over if there is one. */
export async function storyboardProject(id: string): Promise<void> {
  const project = await getProjectRow(id)
  if (!project.script.trim()) badRequest('Write or paste the script first.')
  const characters = await getCharacters(id)
  const drafts = await splitScript({
    script: project.script,
    pace: project.pace,
    artStyle: project.artStyle,
    format: project.format,
    characters: characters.map((c) => ({ name: c.name, description: c.description })),
  })
  await placeScenes(id, drafts)
}

/** A storyboard's scenes, timed by estimate (or to the voice-over if there is one), as the scenes. */
async function placeScenes(id: string, drafts: SceneDraft[]): Promise<void> {
  const project = await getProjectRow(id)
  let placed = layoutByEstimate(drafts)
  // A timed voice-over already exists: line the new scenes up with it straight away.
  if (project.transcript?.words.length) {
    const { times } = alignScenes(
      placed.map((s) => s.narration),
      project.transcript.words,
      project.transcript.duration,
    )
    placed = placed.map((s, i) => ({ ...s, start: times[i].start, end: times[i].end }))
  }
  // The AI's whips and accents, kept rare.
  await replaceScenes(id, spaceEffects(placed))
}

/**
 * Gemini picks the edit for scenes that are already split: whips at new sections, zoom-cuts on
 * key words and shakes on punchlines, spaced out like a split's. Every scene's accent is set;
 * transitions only switch between cut and whip, so crossfades and dips stay. Returns how many
 * effects there are now.
 */
export async function addProjectEffects(id: string): Promise<number> {
  const scenes = await getScenes(id)
  if (scenes.length === 0) badRequest('Split the script into scenes first.')
  const picks = await suggestEffects(
    scenes.map((s) => ({ narration: s.narration, seconds: Math.max(0, s.end - s.start) })),
  )
  const edited = spaceEffects(
    scenes.map((scene, i) => {
      const current = normalizeTransition(scene.transition)
      const kept = current === 'crossfade' || current === 'fade-black'
      return { ...picks[i], start: scene.start, transition: kept ? current : picks[i].transition }
    }),
  )
  const database = await db()
  for (const [i, scene] of scenes.entries()) {
    const { transition, accent, accentWord } = edited[i]
    const word = accent === 'none' ? '' : accentWord
    if (scene.transition === transition && scene.accent === accent && scene.accentWord === word) continue
    await database
      .update(schema.scenes)
      .set({ transition, accent, accentWord: word })
      .where(eq(schema.scenes.id, scene.id))
  }
  await touchProject(id)
  return edited.reduce((n, e) => n + Number(e.transition === 'whip') + Number(e.accent !== 'none'), 0)
}

/**
 * Builds scene pictures from the Library: for every scene without an uploaded picture (and, unless
 * `redo`, without layers yet), Gemini picks a background and a character pose that fit. Characters
 * in the project come first; the Library's other characters can appear too. Returns how many
 * scenes got layers.
 */
export async function composeProject(id: string, redo = false): Promise<number> {
  const database = await db()
  const [scenes, characters, backgrounds, library] = await Promise.all([
    getScenes(id),
    getCharacters(id),
    database.select().from(schema.libraryBackgrounds),
    database.select().from(schema.libraryCharacters),
  ])
  if (scenes.length === 0) badRequest('Split the script into scenes first.')
  const named = (name: string) => name.trim().toLowerCase()
  const inProject = new Set(characters.map((c) => named(c.name)))
  const cast = library
    .filter((c) => c.name.trim() && c.poses.length > 0)
    .sort((a, b) => Number(inProject.has(named(b.name))) - Number(inProject.has(named(a.name))))
  const usable = backgrounds.filter((b) => b.name.trim())
  if (usable.length === 0 && cast.length === 0) {
    badRequest('Add named backgrounds or character poses in the Library first.')
  }
  const targets = scenes.filter((s) => !s.imageUrl && (redo || !s.layer))
  if (targets.length === 0) return 0

  const picks = await pickSceneLayers({
    scenes: targets.map((s) => ({ narration: s.narration, visual: s.visual })),
    backgrounds: usable.map((b) => b.name.trim()),
    characters: cast.map((c) => ({
      name: c.name.trim(),
      poses: c.poses.map((p) => p.name.trim()).filter(Boolean),
    })),
  })
  let placed = 0
  for (const [i, pick] of picks.entries()) {
    const background = usable.find((b) => named(b.name) === named(pick.background))
    const character = cast.find((c) => named(c.name) === named(pick.character))
    const pose = character?.poses.find((p) => named(p.name) === named(pick.pose))
    if (!background && !pose) continue
    const layer: SceneLayer = {
      backgroundUrl: background?.url ?? null,
      background: background?.name ?? '',
      poseUrl: pose?.url ?? null,
      blinkUrl: pose?.blinkUrl ?? null,
      character: pose ? (character?.name ?? '') : '',
      pose: pose?.name ?? '',
      side: pick.side,
    }
    await database.update(schema.scenes).set({ layer }).where(eq(schema.scenes.id, targets[i].id))
    placed++
  }
  await touchProject(id)
  return placed
}

/** Asks Gemini for new ideas (for the channel's niche, or a series) and adds them to the backlog. */
export async function addIdeas(input: {
  niche?: string
  series?: { id: string; name: string; description: string; template: SeriesTemplate } | null
  format?: 'landscape' | 'portrait'
  count?: number
  direction?: string
}): Promise<number> {
  const database = await db()
  const series = input.series ?? null
  const [projects, ideas, settings] = await Promise.all([
    database.select({ title: schema.projects.title, topic: schema.projects.topic }).from(schema.projects),
    database.select({ title: schema.ideas.title }).from(schema.ideas),
    getSettings(),
  ])
  const template = series?.template
  // Without a series, ideas fit the channel's niche from Settings.
  const channel = series ? null : settings.niche
  const generated = await generateIdeas({
    niche: [
      input.niche || channel?.description || '',
      channel?.narration ? `Narration: ${channel.narration}` : '',
      series ? `${series.name}${series.description ? `: ${series.description}` : ''}` : '',
    ]
      .filter(Boolean)
      .join('. '),
    audience: template?.audience ?? channel?.audience ?? '',
    tone: template?.tone ?? channel?.tone ?? '',
    language: template?.language ?? settings.defaults.language,
    format: template?.format ?? input.format ?? 'landscape',
    count: input.count ?? 8,
    direction: input.direction ?? '',
    avoid: [...projects.map((p) => p.title || p.topic), ...ideas.map((i) => i.title)],
    topTitles: await topTitles(template?.channelId ?? null, template?.channelYoutubeId ?? null),
    searchTerms: (await searchTermsFor(template?.channelId ?? null, template?.channelYoutubeId ?? null)).map(
      (t) => t.term,
    ),
    // A series has its own focus; the channel's pillars guide everything else.
    pillars: series ? [] : (settings.niche.pillars ?? []),
    market: settings.niche.market,
  })
  if (generated.length) {
    await database.insert(schema.ideas).values(
      generated.map((idea) => ({
        id: crypto.randomUUID(),
        title: idea.title,
        angle: idea.angle,
        seriesId: series?.id ?? null,
      })),
    )
  }
  return generated.length
}

/** A draft project from an idea (in its series when it has one); the idea is marked used. */
export async function draftFromIdea(
  idea: typeof schema.ideas.$inferSelect,
  format: 'landscape' | 'portrait',
): Promise<string> {
  const database = await db()
  const series = idea.seriesId ? await getSeries(idea.seriesId) : null
  const projectId = await createProject({
    title: idea.title,
    topic: idea.angle ? `${idea.title}. ${idea.angle}` : idea.title,
    format,
    series,
  })
  await database.update(schema.ideas).set({ status: 'used', projectId }).where(eq(schema.ideas.id, idea.id))
  return projectId
}

/**
 * Queues writing new drafts on the server (Ideas → Create drafts → write them), one part at a time
 * as the page used to: each draft's script and scenes, then its post details. Returns the batch.
 */
export async function queueDraftWriting(projectIds: string[]): Promise<string> {
  return queueBatch(
    projectIds.flatMap((projectId) => [
      { kind: 'draft' as const, projectId },
      { kind: 'post' as const, projectId },
    ]),
  )
}

/** How far a batch of drafts got, as the Ideas page shows it; null when it is gone. */
export async function draftBatch(batchId: string): Promise<DraftBatchDTO | null> {
  const tasks = await batchTasks(batchId)
  if (tasks.length === 0) return null
  const ids = [...new Set(tasks.flatMap((t) => (t.projectId ? [t.projectId] : [])))]
  const database = await db()
  const titles = ids.length
    ? await database
        .select({ id: schema.projects.id, title: schema.projects.title })
        .from(schema.projects)
        .where(inArray(schema.projects.id, ids))
    : []
  const open = (t: TaskRow) => t.status === 'queued' || t.status === 'running'
  const drafts = ids.map((projectId) => {
    const parts = tasks.filter((t) => t.projectId === projectId)
    const script = parts.find((t) => t.kind === 'draft')
    const storyboardError = script?.result?.storyboardError ?? null
    const problem = parts.find((t) => t.status === 'failed' || t.status === 'cancelled')
    // As before: a script without its scenes, or without its post details, is partly written.
    const state: DraftBatchDTO['drafts'][number]['state'] = parts.some(open)
      ? parts.some((t) => !open(t) || t.status === 'running')
        ? 'writing'
        : 'waiting'
      : script?.status !== 'done'
        ? 'unwritten'
        : storyboardError || problem
          ? 'partial'
          : 'full'
    const note =
      script && script.status !== 'done' && !open(script)
        ? script.error
        : storyboardError
          ? `The script is written, but not its scenes: ${storyboardError}`
          : (problem?.error ?? null)
    return { projectId, title: titles.find((t) => t.id === projectId)?.title ?? '', state, note }
  })
  const next = tasks.find(open)
  const running = Boolean(next)
  return {
    id: batchId,
    drafts,
    current: next?.projectId ? { draft: ids.indexOf(next.projectId) + 1, kind: next.kind } : null,
    done: tasks.filter((t) => !open(t)).length,
    total: tasks.length,
    running,
    full: drafts.filter((d) => d.state === 'full').length,
    partial: drafts.filter((d) => d.state === 'partial').length,
    // A draft that never started: the batch was stopped, by you or by an error every draft would hit.
    stopped: tasks.find((t) => t.kind === 'draft' && t.status === 'cancelled')?.error ?? null,
    createdAt: tasks[0].createdAt.toISOString(),
    finishedAt: running
      ? null
      : new Date(Math.max(...tasks.map((t) => (t.finishedAt ?? t.createdAt).getTime()))).toISOString(),
  }
}

/** The newest batch of drafts written on the server, or null. */
export async function latestDraftBatch(): Promise<DraftBatchDTO | null> {
  const id = await latestBatchId('draft')
  return id ? draftBatch(id) : null
}

/**
 * Stops writing the newest batch of drafts: the parts not started are cancelled, and the one being
 * written finishes.
 */
export async function stopDraftBatch(): Promise<DraftBatchDTO | null> {
  const id = await latestBatchId('draft')
  if (!id) return null
  await cancelBatch(id, STOPPED_BY_YOU)
  return draftBatch(id)
}

/** Monday 00:00 UTC of this week. */
function weekStart(now = new Date()): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  return start
}

/**
 * The weekly autopilot, run by the daily cron: while this week has fewer autopilot drafts than
 * Settings asks for, makes one more. It takes the newest idea in the backlog (requests added from
 * the comments included), or asks Gemini for new ones when the backlog is empty, then writes the
 * script, storyboards it and picks backgrounds and poses from the Library. One a day keeps each
 * run well inside the cron's time. Returns a note, or null when nothing was due.
 */
export async function runAutopilot(): Promise<string | null> {
  const settings = await getSettings()
  if (settings.autopilot.perWeek <= 0 || !hasGeminiKey()) return null
  const database = await db()
  const made = await database
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.autopilot, true), gte(schema.projects.createdAt, weekStart())))
  if (made.length >= settings.autopilot.perWeek) return null

  const newest = () =>
    database
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.status, 'new'))
      .orderBy(desc(schema.ideas.createdAt))
      .limit(1)
  let [idea] = await newest()
  if (!idea) {
    await addIdeas({ count: 5 })
    ;[idea] = await newest()
  }
  if (!idea) return 'Autopilot: Gemini had no new ideas this time.'

  // Counted from here on, even if a step fails below: a failing step must not use up the AI quota
  // every day.
  const id = await draftFromIdea(idea, 'landscape')
  await updateProject(id, { autopilot: true })
  const done: string[] = []
  try {
    await writeProjectScript(id)
    done.push('script')
    await storyboardProject(id)
    done.push('scenes')
    const placed = await composeProject(id).catch(() => 0)
    if (placed) done.push('pictures from the Library')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Autopilot: "${idea.title}" stopped after ${done.join(', ') || 'the brief'} (${message}).`
  }
  const project = await getProjectRow(id)
  notify({
    kind: 'approval',
    title: `New draft ready: ${project.title || idea.title}`,
    body: `The ${done.join(', ')} are done. Record the voice-over (or have the AI read it), check it, and schedule it.`,
    url: `${appUrl()}/projects/${id}`,
  })
  return `Autopilot: drafted "${project.title || idea.title}".`
}

/** The script as the reviews read it: the script itself, or the scenes' narration without one. */
export async function scriptText(id: string): Promise<string> {
  const project = await getProjectRow(id)
  if (project.script.trim()) return project.script
  return (await getScenes(id))
    .map((s) => s.narration.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** How the project's scripts should sound: its own audience and tone, the channel's narrator and rules. */
export async function scriptVoice(id: string) {
  const [project, settings] = await Promise.all([getProjectRow(id), getSettings()])
  return {
    narration: settings.niche.narration,
    audience: project.audience || settings.niche.audience,
    tone: project.tone || settings.niche.tone,
    rules: settings.niche.rules ?? [],
  }
}
