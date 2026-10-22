import type { JobResult, JobStatus, JobStep, JobType } from '@cutroom/shared/protocol'
import type {
  AppSettings,
  CaptionStyle,
  CharacterPose,
  CommentInsights,
  ImageFit,
  Motion,
  PostDetails,
  PostingMode,
  ProjectStatus,
  Resolution,
  SceneLayer,
  SeriesTemplate,
  Transcript,
  VideoFormat,
  VideoStats,
  VoiceSettings,
} from '@cutroom/shared/types'
import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
  /** Burn each scene's on-screen text into the video. */
  textOverlays: boolean('text_overlays').notNull().default(true),
  /** AI voice for this project; null = the default from Settings. */
  voice: jsonb('voice').$type<VoiceSettings>(),
  seriesId: text('series_id').references(() => series.id, { onDelete: 'set null' }),
  /** YouTube channel to post to; null = the default channel. */
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  /**
   * YouTube's id of that channel. Kept when the channel is disconnected (channelId becomes null),
   * so the video waits for it instead of going to the default channel, and finds it again when
   * it is reconnected.
   */
  channelYoutubeId: text('channel_youtube_id'),
  stats: jsonb('stats').$type<VideoStats>(),
  /** The comment posted for viewers (post.comment); '' when it could not be posted. */
  commentId: text('comment_id'),
  /** The long video a Short was cut from. */
  sourceProjectId: text('source_project_id'),
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
  layer: jsonb('layer').$type<SceneLayer>(),
})

export const jobs = pgTable(
  'jobs',
  {
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
    /** The worker process that holds the job, so two workers never run it at once. */
    runnerId: text('runner_id'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  // Jobs on one project overwrite each other's data, so at most one may be active at a time.
  // assertNoConflict gives the friendly error; this index stops two requests racing past it.
  (t) => [
    uniqueIndex('jobs_one_active_per_project')
      .on(t.projectId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting')`),
  ],
)

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<AppSettings>().notNull(),
})

/** Google Drive. YouTube channels live in `channels` (there can be several). */
export const connections = pgTable('connections', {
  provider: text('provider').$type<'drive'>().primaryKey(),
  refreshToken: text('refresh_token').notNull(),
  email: text('email'),
  label: text('label'),
  scope: text('scope'),
  createdAt: created(),
})

export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  /** YouTube's channel id; null only for a channel carried over from before multi-channel support. */
  youtubeId: text('youtube_id').unique(),
  title: text('title').notNull().default(''),
  email: text('email'),
  refreshToken: text('refresh_token').notNull(),
  scope: text('scope'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: created(),
})

export const series = pgTable('series', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  template: jsonb('template').$type<SeriesTemplate>().notNull(),
  createdAt: created(),
  updatedAt: updated(),
})

export const libraryCharacters = pgTable('library_characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  images: jsonb('images').$type<{ url: string; key: string }[]>().notNull().default([]),
  /** Cut-outs for layered scenes and thumbnails (see SceneLayer). */
  poses: jsonb('poses').$type<CharacterPose[]>().notNull().default([]),
  createdAt: created(),
})

/** Backgrounds for layered scenes and thumbnails, shared by every video. */
export const libraryBackgrounds = pgTable('library_backgrounds', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  url: text('url').notNull(),
  key: text('key').notNull(),
  createdAt: created(),
})

/** The latest read of each channel's comments (server/comments.ts). */
export const commentInsights = pgTable('comment_insights', {
  channelId: text('channel_id')
    .primaryKey()
    .references(() => channels.id, { onDelete: 'cascade' }),
  insights: jsonb('insights').$type<CommentInsights>().notNull(),
  videos: integer('videos').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  updatedAt: updated(),
})

export const ideas = pgTable('ideas', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  angle: text('angle').notNull().default(''),
  seriesId: text('series_id').references(() => series.id, { onDelete: 'set null' }),
  status: text('status').$type<'new' | 'used' | 'dismissed'>().notNull().default('new'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: created(),
})

export type ProjectRow = typeof projects.$inferSelect
export type SceneRow = typeof scenes.$inferSelect
export type CharacterRow = typeof characters.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type ChannelRow = typeof channels.$inferSelect
export type SeriesRow = typeof series.$inferSelect
export type LibraryCharacterRow = typeof libraryCharacters.$inferSelect
export type LibraryBackgroundRow = typeof libraryBackgrounds.$inferSelect
export type IdeaRow = typeof ideas.$inferSelect
