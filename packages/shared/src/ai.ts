// Gemini calls (free tier text model). Used by the web app for quick calls
// and by the worker for the voice-over transcription.
import { createPartFromUri, GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { type Chapter, chaptersToText, countWords, normalizeChapters } from './timing'
import { MOTIONS, type Motion, type TranscriptSegment, type VideoFormat } from './types'

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: 'missing_key' | 'rate_limited' | 'bad_output' | 'failed',
  ) {
    super(message)
  }
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash'
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiError('Add GEMINI_API_KEY to your environment to use AI features.', 'missing_key')
  return new GoogleGenAI({ apiKey })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const retryable = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|500|INTERNAL|overloaded|fetch failed/i.test(
        message,
      )
      if (!retryable || attempt === 3) break
      await sleep(1500 * 2 ** attempt + Math.random() * 500)
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  if (/429|RESOURCE_EXHAUSTED/i.test(message)) {
    throw new AiError('Gemini free-tier limit reached. Wait a minute and try again.', 'rate_limited')
  }
  if (lastError instanceof AiError) throw lastError
  throw new AiError(`Gemini request failed: ${message.slice(0, 300)}`, 'failed')
}

async function generateJson<T>(
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'],
  jsonSchema: Record<string, unknown>,
  parser: z.ZodType<T>,
  system: string,
): Promise<T> {
  const ai = client()
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: geminiModel(),
      contents,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: 0.7,
      },
    })
    const text = response.text ?? ''
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new AiError('Gemini returned something that is not valid JSON. Try again.', 'bad_output')
    }
    const parsed = parser.safeParse(data)
    if (!parsed.success) {
      throw new AiError('Gemini returned an unexpected shape. Try again.', 'bad_output')
    }
    return parsed.data
  })
}

const str = { type: 'string' }

// ---------------------------------------------------------------------------
// Script writing

export interface ScriptBrief {
  topic: string
  audience: string
  tone: string
  language: string
  minutes: number
  format: VideoFormat
  notes?: string
}

export async function writeScript(brief: ScriptBrief): Promise<{ title: string; script: string }> {
  const words = Math.round(brief.minutes * 60 * 2.5)
  const prompt = [
    `Write a narration script for a ${brief.format === 'portrait' ? 'YouTube Short (vertical video)' : 'YouTube video'}.`,
    `Topic: ${brief.topic}`,
    brief.audience && `Audience: ${brief.audience}`,
    brief.tone && `Tone: ${brief.tone}`,
    `Language: ${brief.language || 'English'}`,
    `Length: about ${words} spoken words (${brief.minutes} minutes at a natural pace).`,
    brief.notes && `Extra notes from the creator: ${brief.notes}`,
    'Open with a hook in the first sentence. Use short, spoken sentences. Plain text only: no headings, no stage directions, no emoji, no scene labels, no markdown. Separate paragraphs with a blank line.',
  ]
    .filter(Boolean)
    .join('\n')
  return generateJson(
    prompt,
    { type: 'object', properties: { title: str, script: str }, required: ['title', 'script'] },
    z.object({ title: z.string(), script: z.string().min(20) }),
    'You are a scriptwriter for faceless YouTube channels. You write narration that sounds natural when read aloud.',
  )
}

// ---------------------------------------------------------------------------
// Scene breakdown

export interface SceneDraft {
  narration: string
  visual: string
  imagePrompt: string
  characters: string[]
  shot: string
  motion: Motion
  onScreenText: string
  transition: string
  notes: string
}

const sceneSchema = z.object({
  narration: z.string(),
  visual: z.string().default(''),
  imagePrompt: z.string().default(''),
  characters: z.array(z.string()).default([]),
  shot: z.string().default(''),
  motion: z.string().default('zoom-in'),
  onScreenText: z.string().default(''),
  transition: z.string().default('cut'),
  notes: z.string().default(''),
})

export async function splitScript(input: {
  script: string
  pace: number
  artStyle: string
  format: VideoFormat
  characters: { name: string; description: string }[]
}): Promise<SceneDraft[]> {
  const cast = input.characters.length
    ? input.characters.map((c) => `- ${c.name}: ${c.description}`).join('\n')
    : '(no recurring characters)'
  const prompt = `Split this narration script into scenes for an image-based video. Each scene shows ONE still image while its narration plays.

Rules:
- Target about ${input.pace} seconds of narration per scene (≈${Math.round(input.pace * 2.5)} words). Never split mid-sentence unless a sentence is very long.
- Copy the narration text EXACTLY, word for word, in order. Every word of the script must appear in exactly one scene. Do not add, drop or rephrase words.
- visual: what the viewer sees, concretely (subject, setting, action, mood, lighting).
- imagePrompt: a self-contained prompt for an image generator describing that picture. Do not mention the art style or aspect ratio (added later). Refer to recurring characters by name.
- characters: names of recurring characters visible in the image (from the list below), or [].
- shot: camera framing, e.g. "wide establishing shot", "medium shot", "close-up", "over-the-shoulder", "top-down".
- motion: one of ${MOTIONS.join(', ')} — pick what suits the shot; vary it between scenes.
- onScreenText: a short optional overlay (max 5 words) or "".
- transition: "cut" unless a different one clearly helps.
- notes: optional sound-effect or music cue, or "".

Format: ${input.format === 'portrait' ? 'vertical 9:16' : 'horizontal 16:9'}
Art style (for context only): ${input.artStyle || 'not set'}
Recurring characters:
${cast}

Script:
"""
${input.script.trim()}
"""`
  const result = await generateJson(
    prompt,
    {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              narration: str,
              visual: str,
              imagePrompt: str,
              characters: { type: 'array', items: str },
              shot: str,
              motion: { type: 'string', enum: MOTIONS },
              onScreenText: str,
              transition: str,
              notes: str,
            },
            required: ['narration', 'visual', 'imagePrompt', 'characters', 'shot', 'motion'],
          },
        },
      },
      required: ['scenes'],
    },
    z.object({ scenes: z.array(sceneSchema).min(1) }),
    'You are a storyboard artist and video editor for faceless YouTube channels.',
  )
  const scenes = result.scenes.map((s) => ({
    ...s,
    motion: (MOTIONS as string[]).includes(s.motion) ? (s.motion as Motion) : 'zoom-in',
  }))
  const original = countWords(input.script)
  const kept = scenes.reduce((n, s) => n + countWords(s.narration), 0)
  if (original > 0 && Math.abs(kept - original) / original > 0.08) {
    throw new AiError(
      'Gemini changed the script while splitting it. Try again, or split a shorter script.',
      'bad_output',
    )
  }
  return scenes
}

// ---------------------------------------------------------------------------
// Voice-over transcription (worker only — needs a local file path)

export async function transcribeVoiceover(
  filePath: string,
  mimeType: string,
  duration: number,
  language: string,
): Promise<TranscriptSegment[]> {
  const ai = client()
  const uploaded = await withRetry(() => ai.files.upload({ file: filePath, config: { mimeType } }))
  let file = uploaded
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
    await sleep(2000)
    file = await ai.files.get({ name: file.name! })
  }
  if (file.state === 'FAILED' || !file.uri) {
    throw new AiError('Gemini could not read this audio file. Try exporting it as MP3 or WAV.', 'failed')
  }
  const prompt = `Transcribe this voice-over verbatim${language ? ` (language: ${language})` : ''}.
Return consecutive segments covering all speech. Each segment is one sentence or at most about 12 words.
start and end are seconds from the beginning of the audio as decimals (e.g. 12.4). The audio is ${duration.toFixed(1)} seconds long.
Timestamps must be accurate to the spoken words, increasing, and never overlap.`
  const result = await generateJson(
    [{ role: 'user', parts: [createPartFromUri(file.uri, file.mimeType ?? mimeType), { text: prompt }] }],
    {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { start: { type: 'number' }, end: { type: 'number' }, text: str },
            required: ['start', 'end', 'text'],
          },
        },
      },
      required: ['segments'],
    },
    z.object({ segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })) }),
    'You are a precise transcription engine that returns timestamps in seconds.',
  )
  try {
    await ai.files.delete({ name: file.name! })
  } catch {
    // The file expires on its own after 48 hours.
  }
  return cleanSegments(result.segments, duration)
}

export function cleanSegments(segments: TranscriptSegment[], duration: number): TranscriptSegment[] {
  const sorted = segments
    .filter((s) => s.text.trim())
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.trim() }))
    .sort((a, b) => a.start - b.start)
  const limit = duration > 0 ? duration : Number.POSITIVE_INFINITY
  const result: TranscriptSegment[] = []
  for (const segment of sorted) {
    const previous = result[result.length - 1]
    const start = Math.min(limit, previous ? Math.max(segment.start, previous.end) : segment.start)
    const end = Math.min(limit, Math.max(segment.end, start + 0.2))
    if (end <= start) continue
    result.push({ start, end, text: segment.text })
  }
  return result
}

// ---------------------------------------------------------------------------
// Post details

export interface PostDraftInput {
  title: string
  topic: string
  audience: string
  language: string
  format: VideoFormat
  duration: number
  script: string
  scenes: { start: number; narration: string }[]
  defaultTags: string[]
  descriptionFooter: string
}

export interface PostDraft {
  titleOptions: string[]
  description: string
  tags: string[]
  hashtags: string[]
  chapters: Chapter[]
  thumbnailIdeas: string[]
  thumbnailText: string
}

export async function writePostDetails(input: PostDraftInput): Promise<PostDraft> {
  const sceneList = input.scenes
    .map((s, i) => `[${i}] ${s.start.toFixed(0)}s: ${s.narration.slice(0, 160)}`)
    .join('\n')
  const isShort = input.format === 'portrait'
  const prompt = `Write YouTube upload details for this ${isShort ? 'Short' : 'video'}.
Working title: ${input.title || '(none)'}
Topic: ${input.topic}
Audience: ${input.audience || 'general'}
Language: ${input.language || 'English'}
Length: ${Math.round(input.duration)} seconds

Scenes (index, start time, narration):
${sceneList}

Return:
- titleOptions: 5 distinct titles, max 70 characters, curiosity-driven but honest, no clickbait lies, no ALL CAPS words, no emoji.
- description: 2 short paragraphs (hook + what the viewer learns). Do NOT include chapters, hashtags or links.
- tags: 10–15 search tags, most specific first, no "#".
- hashtags: 3 hashtags including "#"${isShort ? ', one of them #Shorts' : ''}.
- chapterPicks: ${isShort ? 'an empty list (Shorts have no chapters)' : '4–8 chapters as {sceneIndex, title}; the first must be sceneIndex 0; titles max 40 characters'}.
- thumbnailIdeas: 3 thumbnail concepts, one sentence each, describing a single striking image.
- thumbnailText: 2–4 punchy words to print on the thumbnail.`
  const draft = await generateJson(
    prompt,
    {
      type: 'object',
      properties: {
        titleOptions: { type: 'array', items: str },
        description: str,
        tags: { type: 'array', items: str },
        hashtags: { type: 'array', items: str },
        chapterPicks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sceneIndex: { type: 'integer' }, title: str },
            required: ['sceneIndex', 'title'],
          },
        },
        thumbnailIdeas: { type: 'array', items: str },
        thumbnailText: str,
      },
      required: [
        'titleOptions',
        'description',
        'tags',
        'hashtags',
        'chapterPicks',
        'thumbnailIdeas',
        'thumbnailText',
      ],
    },
    z.object({
      titleOptions: z.array(z.string()).min(1),
      description: z.string(),
      tags: z.array(z.string()),
      hashtags: z.array(z.string()),
      chapterPicks: z.array(z.object({ sceneIndex: z.number(), title: z.string() })),
      thumbnailIdeas: z.array(z.string()),
      thumbnailText: z.string(),
    }),
    'You are a YouTube growth strategist who writes clear, honest, search-friendly metadata.',
  )
  const chapters = normalizeChapters(
    draft.chapterPicks
      .filter((c) => input.scenes[c.sceneIndex])
      .map((c) => ({ start: input.scenes[c.sceneIndex].start, title: c.title })),
    input.duration,
  )
  const hashtags = draft.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, ''))
  const tags = dedupe(
    [...draft.tags, ...input.defaultTags].map((t) => t.replace(/^#/, '').trim()).filter(Boolean),
  )
  return {
    titleOptions: draft.titleOptions.map((t) => t.trim().slice(0, 100)),
    description: composeDescription(draft.description.trim(), chapters, input.descriptionFooter, hashtags),
    tags: fitTags(tags),
    hashtags,
    chapters,
    thumbnailIdeas: draft.thumbnailIdeas,
    thumbnailText: draft.thumbnailText,
  }
}

export function composeDescription(
  body: string,
  chapters: Chapter[],
  footer: string,
  hashtags: string[],
): string {
  const parts = [body]
  if (chapters.length) parts.push(`Chapters\n${chaptersToText(chapters)}`)
  if (footer.trim()) parts.push(footer.trim())
  if (hashtags.length) parts.push(hashtags.join(' '))
  return parts.join('\n\n').slice(0, 5000)
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((v) => {
    const key = v.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** YouTube caps tags at 500 characters in total. */
export function fitTags(tags: string[]): string[] {
  const result: string[] = []
  let total = 0
  for (const tag of tags) {
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (result.length ? 1 : 0)
    if (total + cost > 480) break
    result.push(tag)
    total += cost
  }
  return result
}
