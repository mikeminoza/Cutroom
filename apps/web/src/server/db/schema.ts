import type { JobResult, JobStatus, JobStep, JobType } from '@cutroom/shared/protocol'
import type {
  AppSettings,
  CaptionStyle,
  ImageFit,
  Motion,
  PostDetails,
  PostingMode,
  ProjectStatus,
  Resolution,
  Transcript,
  VideoFormat,
} from '@cutroom/shared/types'
import { boolean, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core'

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  topic: text('topic').notNull().default(''),
  audience: text('audience').notNull().default(''),
  tone: text('tone').notNull().default(''),
  language: text('language').notNull().default('en'),
  artStyle: text('art_style').notNull().default(''),
  format: text('format').$type<VideoFormat>().notNull().default('landscape'),
  resolution: text('resolution').$type<Resolution>().notNull().default('720p'),
  captionStyle: text('caption_style').$type<CaptionStyle>().notNull().default('highlight'),
  mode: text('mode').$type<PostingMode>().notNull().default('review'),
  targetMinutes: real('target_minutes').notNull().default(3),
  pace: real('pace').notNull().default(6),
  script: text('script').notNull().default(''),
  notes: text('notes').notNull().default(''),
  voiceoverUrl: text('voiceover_url'),
  voiceoverName: text('voiceover_name'),
  voiceoverDuration: real('voiceover_duration'),
  transcript: jsonb('transcript').$type<Transcript>(),
  musicUrl: text('music_url'),
  musicName: text('music_name'),
  musicVolume: real('music_volume').notNull().default(0.15),
  thumbnailUrl: text('thumbnail_url'),
  post: jsonb('post').$type<PostDetails>().notNull(),
  status: text('status').$type<ProjectStatus>().notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  youtubeVideoId: text('youtube_video_id'),
  driveFolderId: text('drive_folder_id'),
  driveFolderUrl: text('drive_folder_url'),
  driveFileId: text('drive_file_id'),
  outputUrl: text('output_url'),
  srtUrl: text('srt_url'),
  archived: boolean('archived').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
})

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  images: jsonb('images').$type<{ url: string; key: string }[]>().notNull().default([]),
  position: integer('position').notNull().default(0),
  createdAt: created(),
})

export const scenes = pgTable('scenes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  start: real('start_time').notNull().default(0),
  end: real('end_time').notNull().default(0),
  narration: text('narration').notNull().default(''),
  visual: text('visual').notNull().default(''),
  imagePrompt: text('image_prompt').notNull().default(''),
  characters: jsonb('characters').$type<string[]>().notNull().default([]),
  shot: text('shot').notNull().default(''),
  motion: text('motion').$type<Motion>().notNull().default('zoom-in'),
  onScreenText: text('on_screen_text').notNull().default(''),
  transition: text('transition').notNull().default('cut'),
  notes: text('notes').notNull().default(''),
  imageUrl: text('image_url'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  fit: text('fit').$type<ImageFit>().notNull().default('cover'),
  focusX: real('focus_x').notNull().default(0.5),
  focusY: real('focus_y').notNull().default(0.5),
})

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').$type<JobType>().notNull(),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  steps: jsonb('steps').$type<JobStep[]>().notNull(),
  result: jsonb('result').$type<JobResult>().notNull().default({}),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  approved: boolean('approved').notNull().default(false),
  progress: real('progress'),
  progressStep: text('progress_step'),
  progressDetail: text('progress_detail'),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  kickedAt: timestamp('kicked_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
})

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<AppSettings>().notNull(),
})

export const connections = pgTable('connections', {
  provider: text('provider').$type<'youtube' | 'drive'>().primaryKey(),
  refreshToken: text('refresh_token').notNull(),
  email: text('email'),
  label: text('label'),
  scope: text('scope'),
  createdAt: created(),
})

export type ProjectRow = typeof projects.$inferSelect
export type SceneRow = typeof scenes.$inferSelect
export type CharacterRow = typeof characters.$inferSelect
export type JobRow = typeof jobs.$inferSelect
