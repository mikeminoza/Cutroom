// Gemini calls (free tier text model). Used by the web app for quick calls
// and by the worker for the voice-over transcription.
import { createPartFromUri, GoogleGenAI, type ThinkingConfig, type ThinkingLevel } from '@google/genai'
import { z } from 'zod'
import { type Chapter, chaptersToText, countWords, normalizeChapters } from './timing'
import {
  MOTIONS,
  type Motion,
  normalizeTransition,
  TRANSITIONS,
  type TranscriptSegment,
  type Transition,
  type VideoFormat,
} from './types'

export class AiError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'missing_key'
      | 'rate_limited'
      | 'daily_limit'
      | 'bad_output'
      | 'failed'
      | 'billing'
      | 'busy'
      | 'timeout',
  ) {
    super(message)
  }
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash'
}

/** Image model. Image generation is not on Gemini's free tier: the key's project needs billing. */
export function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image'
}

/** Text-to-speech model (on the free tier). */
export function geminiTtsModel(): string {
  return process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts'
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiError('Add GEMINI_API_KEY to your environment to use AI features.', 'missing_key')
  return new GoogleGenAI({ apiKey })
}

/** Waits, or rejects as soon as `signal` aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/** Rate limited, or a temporary server problem: worth asking again. */
const RETRY_STATUSES = [429, 500, 502, 503, 504]

const TOO_SLOW = 'Gemini is taking too long to answer right now. Try again in a minute.'

/**
 * When an AI request must be finished, retries included. Vercel cuts a request off at 60 seconds
 * (the routes' maxDuration), so stop at 50 and answer with a clear message instead of a bare 504.
 * The worker has no such limit.
 */
function requestDeadline(): number | undefined {
  return process.env.VERCEL ? Date.now() + 50_000 : undefined
}

/** Aborts at the deadline, or when the caller aborts. */
function attemptSignal(deadline?: number, signal?: AbortSignal): AbortSignal | undefined {
  const signals = [signal, deadline ? AbortSignal.timeout(Math.max(1000, deadline - Date.now())) : undefined]
  const live = signals.filter((s): s is AbortSignal => s !== undefined)
  return live.length > 1 ? AbortSignal.any(live) : live[0]
}

/**
 * As little thinking as the model allows. These are structured tasks, and thinking is most of the
 * wait: a Flash model at its default can take longer than a web request may run.
 */
function quickThinking(model: string): ThinkingConfig | undefined {
  const major = Number(/^gemini-(\d+)/.exec(model)?.[1] ?? 0)
  if (major >= 3) return { thinkingLevel: 'LOW' as ThinkingLevel }
  if (/^gemini-2\.5-(flash|flash-lite)\b/.test(model)) return { thinkingBudget: 0 }
  if (/^gemini-2\.5-pro\b/.test(model)) return { thinkingBudget: 128 }
  return undefined
}

/** The HTTP status of an API error from the SDK, or null for other errors (network, parsing). */
function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * Runs a Gemini request, asking again after temporary failures. `run` gets the signal to pass
 * to the SDK: it aborts when the caller does, or at the deadline.
 */
async function withRetry<T>(
  run: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  deadline?: number,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    signal?.throwIfAborted()
    if (deadline && Date.now() >= deadline) throw new AiError(TOO_SLOW, 'timeout')
    const attemptAbort = attemptSignal(deadline, signal)
    try {
      return await run(attemptAbort)
    } catch (error) {
      // Stopped by the caller: not a failure to retry or explain.
      if (signal?.aborted) throw error
      // The deadline ran out in the middle of the request.
      if (deadline && (attemptAbort?.aborted || Date.now() >= deadline))
        throw new AiError(TOO_SLOW, 'timeout')
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      // A quota of 0 is not a rate limit: the model is not on the free tier. Waiting won't help.
      if (/limit:\s*0\b/.test(message)) {
        throw new AiError(
          'This Gemini model is not on the free tier. Turn on billing for the Google Cloud project of your Gemini API key, or choose another model in the environment settings.',
          'billing',
        )
      }
      // Decide by the HTTP status the SDK reports: the message is the whole error body, which can
      // mention "500" or "internal" in a request that will never succeed.
      const status = httpStatus(error)
      const retryable =
        status !== null
          ? RETRY_STATUSES.includes(status)
          : /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(message)
      if (!retryable || attempt === 3) break
      const wait = 1500 * 2 ** attempt + Math.random() * 500
      // No time left for another try (it needs a few seconds itself).
      if (deadline && Date.now() + wait + 5000 > deadline) break
      await sleep(wait, signal)
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  const status = httpStatus(lastError)
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(message)) {
    // Google names the quota that ran out: a per-day one won't come back by waiting a minute.
    if (/PerDay|per[ _-]?day|daily/i.test(message)) {
      throw new AiError(
        "Gemini's free daily limit is used up. It resets at midnight Pacific time.",
        'daily_limit',
      )
    }
    throw new AiError('Gemini free-tier limit reached. Wait a minute and try again.', 'rate_limited')
  }
  if (status !== null && status >= 500) {
    throw new AiError('Gemini is busy right now. Try again in a minute.', 'busy')
  }
  if (lastError instanceof AiError) throw lastError
  throw new AiError(`Gemini request failed: ${message.slice(0, 300)}`, 'failed')
}

async function generateJson<T>(
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'],
  jsonSchema: Record<string, unknown>,
  parser: z.ZodType<T>,
  system: string,
  /** 'default' leaves thinking to the model, for tasks where accuracy beats speed. */
  options: { thinking?: 'quick' | 'default' } = {},
): Promise<T> {
  const ai = client()
  const model = geminiModel()
  return withRetry(
    async (signal) => {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          temperature: 0.7,
          thinkingConfig: options.thinking === 'default' ? undefined : quickThinking(model),
          abortSignal: signal,
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
    },
    undefined,
    requestDeadline(),
  )
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
  /** Recurring characters; the notes may make one of them the narrator. */
  characters?: { name: string; description: string }[]
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
    brief.characters?.length &&
      `Recurring characters (use these exact names):\n${brief.characters
        .map((c) => `- ${c.name}${c.description.trim() ? `: ${c.description.trim()}` : ''}`)
        .join('\n')}`,
    'Open with a hook in the first sentence. Use short, spoken sentences. Plain text only: no headings, no stage directions, no emoji, no scene labels, no markdown. Separate paragraphs with a blank line.',
  ]
    .filter(Boolean)
    .join('\n')
  return generateJson(
    prompt,
    { type: 'object', properties: { title: str, script: str }, required: ['title', 'script'] },
    z.object({ title: z.string(), script: z.string().min(20) }),
    'You are a scriptwriter for YouTube channels, faceless or narrated by a recurring character. You write narration that sounds natural when read aloud, in the narrator voice the creator asks for.',
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
  transition: Transition
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
- onScreenText: a short optional title shown at the top of the frame (max 5 words), or "". Use it sparingly: key numbers, names, chapter-like moments.
- transition: how this scene's picture replaces the previous one: "cut" (the default, most scenes), "crossfade" for a soft change of place or time, "fade-black" for a big jump or the closing scene.
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
              transition: { type: 'string', enum: TRANSITIONS },
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
    transition: normalizeTransition(s.transition),
    onScreenText: s.onScreenText.trim().slice(0, 200),
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
    // Timestamps need care, and this runs on the worker, where there is time for it.
    { thinking: 'default' },
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
  /** The channel's most-watched titles so far, so new titles learn from what works. */
  topTitles?: { title: string; views: number }[]
}

function topTitlesNote(top: { title: string; views: number }[] | undefined): string {
  if (!top?.length) return ''
  const list = top.map((t) => `- "${t.title}" (${t.views.toLocaleString('en-US')} views)`).join('\n')
  return `\nTitles that got the most views on this channel so far. Learn from their style, length and wording, but do not copy them:\n${list}\n`
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
${topTitlesNote(input.topTitles)}
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

// ---------------------------------------------------------------------------
// Voice-over (text-to-speech)

/**
 * Reads `text` aloud with a prebuilt Gemini voice. Returns the audio as Gemini sends it: a WAV
 * file, or raw 16-bit PCM described by the MIME type (e.g. "audio/L16;codec=pcm;rate=24000").
 * `style` sets the delivery for the whole read (newer TTS models only; older ones ignore it).
 */
export async function synthesizeSpeech(
  text: string,
  options: { voice: string; style?: string; signal?: AbortSignal },
): Promise<{ data: Buffer; mimeType: string }> {
  const ai = client()
  const model = geminiTtsModel()
  const style = options.style?.trim()
  const part: { text: string; speechMetadata?: { style: string } } = { text }
  if (style && !/^gemini-2\./.test(model)) part.speechMetadata = { style }
  // An empty answer happens now and then; asking again usually works.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await withRetry(
      (signal) =>
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [part] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } },
            abortSignal: signal,
          },
        }),
      options.signal,
    )
    const audio = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('audio/'),
    )
    if (audio?.inlineData?.data) {
      return {
        data: Buffer.from(audio.inlineData.data, 'base64'),
        mimeType: audio.inlineData.mimeType ?? 'audio/L16;rate=24000',
      }
    }
  }
  throw new AiError('Gemini returned no audio for part of the script. Try again.', 'bad_output')
}

// ---------------------------------------------------------------------------
// Images

export interface ReferenceImage {
  data: Buffer
  mimeType: string
}

/** Gemini image models take at most this many reference images in one request (Pro: 6). */
export const MAX_REFERENCE_IMAGES = 6

/** Generates one picture from a prompt, matching the attached reference images (characters). */
export async function generateImage(input: {
  prompt: string
  references: ReferenceImage[]
  aspectRatio: '16:9' | '9:16'
}): Promise<{ data: Buffer; mimeType: string }> {
  const ai = client()
  const imageSize = process.env.GEMINI_IMAGE_SIZE?.trim() || undefined
  const parts = [
    { text: input.prompt },
    ...input.references.slice(0, MAX_REFERENCE_IMAGES).map((r) => ({
      inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') },
    })),
  ]
  const response = await withRetry(
    (signal) =>
      ai.models.generateContent({
        model: geminiImageModel(),
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: input.aspectRatio, ...(imageSize ? { imageSize } : {}) },
          abortSignal: signal,
        },
      }),
    undefined,
    requestDeadline(),
  )
  const candidate = response.candidates?.[0]
  const image = candidate?.content?.parts?.find(
    (p) => p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('image/'),
  )
  if (image?.inlineData?.data) {
    return {
      data: Buffer.from(image.inlineData.data, 'base64'),
      mimeType: image.inlineData.mimeType ?? 'image/png',
    }
  }
  const blocked = response.promptFeedback?.blockReason
  const finish = candidate?.finishReason
  if (blocked || (finish && finish !== 'STOP')) {
    throw new AiError(
      `Gemini would not make this image (${blocked ?? finish}). Reword the prompt and try again.`,
      'bad_output',
    )
  }
  const said = candidate?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join(' ')
    .slice(0, 200)
  throw new AiError(`Gemini did not return an image${said ? `: ${said}` : ''}. Try again.`, 'bad_output')
}

// ---------------------------------------------------------------------------
// Video ideas

export interface IdeaRequest {
  niche: string
  audience: string
  tone: string
  language: string
  format: VideoFormat
  count: number
  direction: string
  /** Titles and topics already made or planned, so ideas don't repeat them. */
  avoid: string[]
  topTitles: { title: string; views: number }[]
}

export async function generateIdeas(input: IdeaRequest): Promise<{ title: string; angle: string }[]> {
  const avoid = input.avoid
    .filter(Boolean)
    .slice(0, 80)
    .map((t) => `- ${t.slice(0, 120)}`)
    .join('\n')
  const prompt = [
    `Suggest ${input.count} ideas for ${input.format === 'portrait' ? 'YouTube Shorts (under a minute)' : 'YouTube videos'} for this channel.`,
    `Channel niche: ${input.niche || 'general interest'}`,
    input.audience && `Audience: ${input.audience}`,
    input.tone && `Tone: ${input.tone}`,
    `Language: ${input.language || 'English'}`,
    input.direction && `Direction from the creator: ${input.direction}`,
    topTitlesNote(input.topTitles).trim(),
    avoid && `Already made or planned (do not repeat these or make near-duplicates):\n${avoid}`,
    'Each idea: a working title (max 70 characters, curiosity-driven but honest, no emoji) and an angle: one or two sentences on the hook and what the viewer learns, specific enough to write a script from. Make the ideas varied.',
  ]
    .filter(Boolean)
    .join('\n')
  const result = await generateJson(
    prompt,
    {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          items: { type: 'object', properties: { title: str, angle: str }, required: ['title', 'angle'] },
        },
      },
      required: ['ideas'],
    },
    z.object({ ideas: z.array(z.object({ title: z.string(), angle: z.string() })).min(1) }),
    'You are a YouTube strategist who finds video ideas that people search for and click on.',
  )
  return result.ideas
    .map((i) => ({ title: i.title.trim().slice(0, 200), angle: i.angle.trim().slice(0, 1000) }))
    .filter((i) => i.title)
    .slice(0, input.count)
}

// ---------------------------------------------------------------------------
// Shorts from long videos

/**
 * Picks the run of consecutive scenes that works best on its own as a Short: a strong hook, one
 * complete idea, at most `maxSeconds` long. Indexes are positions in `scenes`.
 */
export async function pickShortMoment(input: {
  title: string
  topic: string
  scenes: { start: number; end: number; narration: string }[]
  maxSeconds: number
}): Promise<{ startIndex: number; endIndex: number; title: string; reason: string }> {
  const list = input.scenes
    .map((s, i) => `[${i}] ${s.start.toFixed(1)}–${s.end.toFixed(1)}s: ${s.narration.slice(0, 220)}`)
    .join('\n')
  const prompt = `This long YouTube video is being cut into a YouTube Short.
Title: ${input.title || '(none)'}
Topic: ${input.topic || '(none)'}

Scenes (index, time, narration):
${list}

Pick ONE run of consecutive scenes that works on its own as a Short: it opens with a hook, covers one complete idea, and makes sense without the rest of the video. Its total length must be at most ${input.maxSeconds} seconds (end of the last scene minus start of the first). Also write a Short title (max 70 characters, no emoji) and one sentence on why this part works.`
  const result = await generateJson(
    prompt,
    {
      type: 'object',
      properties: {
        startIndex: { type: 'integer' },
        endIndex: { type: 'integer' },
        title: str,
        reason: str,
      },
      required: ['startIndex', 'endIndex', 'title', 'reason'],
    },
    z.object({ startIndex: z.number(), endIndex: z.number(), title: z.string(), reason: z.string() }),
    'You are a video editor who turns long videos into Shorts that hold attention.',
  )
  return {
    ...clampShortPick(input.scenes, result.startIndex, result.endIndex, input.maxSeconds),
    title: result.title.trim().slice(0, 100),
    reason: result.reason.trim(),
  }
}

/** Keeps a pick valid whatever came back: in range, in order, and within the length limit. */
export function clampShortPick(
  scenes: { start: number; end: number }[],
  startIndex: number,
  endIndex: number,
  maxSeconds: number,
): { startIndex: number; endIndex: number } {
  const last = scenes.length - 1
  const start = Math.min(Math.max(0, Math.round(startIndex)), last)
  let end = Math.min(Math.max(start, Math.round(endIndex)), last)
  while (end > start && scenes[end].end - scenes[start].start > maxSeconds) end--
  return { startIndex: start, endIndex: end }
}
