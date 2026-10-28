// Drafting with AI as server functions: the buttons' routes call them, and so does the weekly
// autopilot, which turns ideas into ready drafts on its own (script, scenes, and pictures from
// the Library), so all that is left is recording the voice-over and checking.
import { spaceEffects } from '@cutroom/shared/accents'
import {
  generateIdeas,
  hasGeminiKey,
  pickSceneLayers,
  splitScript,
  suggestEffects,
  writeScript,
} from '@cutroom/shared/ai'
import { alignScenes } from '@cutroom/shared/align'
import { layoutByEstimate } from '@cutroom/shared/timing'
import { normalizeTransition, type SceneLayer, type SeriesTemplate } from '@cutroom/shared/types'
import { and, desc, eq, gte } from 'drizzle-orm'
import { retentionLessons, searchTermsFor, topTitles } from './analytics'
import { db, schema } from './db'
import { badRequest } from './http'
import { notify } from './notify'
import {
  createProject,
  getCharacters,
  getProjectRow,
  getScenes,
  replaceScenes,
  touchProject,
  updateProject,
} from './projects'
import { getSeries } from './series'
import { appUrl, getSettings } from './settings'

/** Gemini writes the project's script from its brief; an empty title takes the script's. */
export async function writeProjectScript(id: string, notes = ''): Promise<void> {
  const project = await getProjectRow(id)
  if (!project.topic.trim()) badRequest('Add a topic on the Brief step first.')
  const settings = await getSettings()
  const result = await writeScript({
    topic: project.topic,
    audience: project.audience,
    tone: project.tone,
    language: project.language,
    minutes: project.targetMinutes,
    format: project.format,
    notes: notes || project.notes,
    characters: (await getCharacters(id))
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), description: c.description })),
    market: settings.niche.market,
    lessons: await retentionLessons(project.channelId, project.channelYoutubeId, project.format),
    rules: settings.niche.rules ?? [],
  })
  await updateProject(id, { script: result.script, title: project.title.trim() || result.title })
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
