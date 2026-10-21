import { MOTIONS, TRANSITIONS } from '@cutroom/shared/types'
import { z } from 'zod'

const url = z.string().max(2000)
const nullableUrl = url.nullable()

export const voiceSchema = z.object({
  provider: z.enum(['gemini', 'elevenlabs']),
  voice: z.string().trim().min(1).max(100),
  style: z.string().max(300),
})

export const postSchema = z.object({
  titleOptions: z.array(z.string().max(200)).max(10),
  title: z.string().max(100),
  description: z.string().max(5000),
  tags: z.array(z.string().max(100)).max(60),
  hashtags: z.array(z.string().max(100)).max(15),
  chapters: z
    .array(
      z.object({
        start: z.number().min(0),
        title: z.string().max(100),
        scene: z.number().int().min(0).optional(),
      }),
    )
    .max(100),
  thumbnailIdeas: z.array(z.string().max(500)).max(10),
  thumbnailPrompt: z.string().max(4000),
  categoryId: z.string().max(4),
  privacy: z.enum(['private', 'unlisted', 'public']),
  madeForKids: z.boolean(),
  aiFill: z.boolean().optional(),
  playlistId: z.string().max(100),
  language: z.string().max(20),
})

export const projectPatchSchema = z
  .object({
    title: z.string().max(200),
    topic: z.string().max(4000),
    audience: z.string().max(500),
    tone: z.string().max(500),
    language: z.string().max(20),
    artStyle: z.string().max(1000),
    format: z.enum(['landscape', 'portrait']),
    resolution: z.enum(['720p', '1080p']),
    captionStyle: z.enum(['highlight', 'line', 'off']),
    mode: z.enum(['autopilot', 'review']),
    targetMinutes: z.number().min(0.25).max(60),
    pace: z.number().min(2).max(30),
    script: z.string().max(100_000),
    notes: z.string().max(4000),
    voiceoverUrl: nullableUrl,
    voiceoverName: z.string().max(300).nullable(),
    voiceoverDuration: z
      .number()
      .min(0)
      .max(4 * 3600)
      .nullable(),
    musicUrl: nullableUrl,
    musicName: z.string().max(300).nullable(),
    musicVolume: z.number().min(0).max(1),
    thumbnailUrl: nullableUrl,
    post: postSchema,
    textOverlays: z.boolean(),
    voice: voiceSchema.nullable(),
    channelId: z.string().max(100).nullable(),
    seriesId: z.string().max(100).nullable(),
  })
  .partial()

export const scenePatchSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    narration: z.string().max(5000),
    visual: z.string().max(4000),
    imagePrompt: z.string().max(4000),
    characters: z.array(z.string().max(100)).max(20),
    shot: z.string().max(200),
    motion: z.enum(MOTIONS as [string, ...string[]]),
    onScreenText: z.string().max(200),
    transition: z.enum(TRANSITIONS as [string, ...string[]]),
    notes: z.string().max(1000),
    imageUrl: nullableUrl,
    imageWidth: z.number().int().positive().nullable(),
    imageHeight: z.number().int().positive().nullable(),
    fit: z.enum(['cover', 'contain']),
    focusX: z.number().min(0).max(1),
    focusY: z.number().min(0).max(1),
  })
  .partial()

export const characterPatchSchema = z
  .object({
    name: z.string().max(100),
    description: z.string().max(2000),
    images: z.array(z.object({ url, key: z.string().max(500) })).max(6),
    position: z.number().int(),
  })
  .partial()

export const settingsSchema = z.object({
  timezone: z.string().max(100),
  slots: z
    .array(z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/) }))
    .max(50),
  defaults: z.object({
    privacy: z.enum(['private', 'unlisted', 'public']),
    categoryId: z.string().max(4),
    madeForKids: z.boolean(),
    playlistId: z.string().max(100),
    language: z.string().max(20),
    tags: z.array(z.string().max(100)).max(30),
    descriptionFooter: z.string().max(2000),
    mode: z.enum(['autopilot', 'review']),
    resolution: z.enum(['720p', '1080p']),
    captionStyle: z.enum(['highlight', 'line', 'off']),
  }),
  freeBlobAfterPosting: z.boolean(),
  voice: voiceSchema,
  notifications: z.object({ approval: z.boolean(), failed: z.boolean(), posted: z.boolean() }),
  niche: z.object({
    description: z.string().max(1000),
    narration: z.string().max(1000),
    audience: z.string().max(500),
    tone: z.string().max(500),
    artStyle: z.string().max(1000),
    targetMinutes: z.number().min(0.25).max(60),
    pace: z.number().min(2).max(30),
    characterIds: z.array(z.string().max(100)).max(6),
  }),
})
