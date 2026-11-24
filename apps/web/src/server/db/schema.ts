import type {
  CheckStatus,
  CheckStep,
  JobResult,
  JobStatus,
  JobStep,
  JobType,
  WorkerInfo,
} from '@cutroom/shared/protocol'
import type { ReplyStatus } from '@cutroom/shared/replies'
import type {
  Accent,
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
  VideoInsights,
  VideoStats,
  VoiceSettings,
} from '@cutroom/shared/types'
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { TaskInput, TaskKind, TaskResult, TaskStatus } from '../../lib/tasks'

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
  /** Whooshes and impacts under whips and accents. */
  soundEffects: boolean('sound_effects').notNull().default(true),
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
  /** Where viewers stop watching and what they searched to find it, refreshed with `stats`. */
  videoInsights: jsonb('video_insights').$type<VideoInsights>(),
  /** The comment posted for viewers (post.comment); '' when it could not be posted. */
  commentId: text('comment_id'),
  /** Drafted by the weekly autopilot (server/drafting.ts). */
  autopilot: boolean('autopilot').notNull().default(false),
  /** The long video a Short was cut from. */
  sourceProjectId: text('source_project_id'),
  /**
   * When the daily check first found it doing far better than usual (server/hits.ts) and told
   * you; null = not yet. So you hear about each hit once.
   */
  hitAt: timestamp('hit_at', { withTimezone: true }),
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
  /** A zoom-cut or a shake, on `accentWord` of the narration. */
  accent: text('accent').$type<Accent>().notNull().default('none'),
  accentWord: text('accent_word').notNull().default(''),
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
  /** When its recent videos' comments were last read for replies (server/replies.ts); null = never. */
  repliesCheckedAt: timestamp('replies_checked_at', { withTimezone: true }),
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

/**
 * Videos breaking out in the niche: recent YouTube videos with far more views than their channel
 * usually gets, found by the weekly search (server/breakouts.ts). The id is YouTube's video id.
 */
export const breakouts = pgTable('breakouts', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  channelTitle: text('channel_title').notNull().default(''),
  youtubeChannelId: text('youtube_channel_id').notNull().default(''),
  views: integer('views').notNull().default(0),
  /** The channel's usual views per video. */
  channelAverage: integer('channel_average').notNull().default(0),
  /** Views over the channel's usual views. */
  score: real('score').notNull().default(0),
  seconds: integer('seconds').notNull().default(0),
  thumbnailUrl: text('thumbnail_url'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** The search that found it. */
  query: text('query').notNull().default(''),
  status: text('status').$type<'new' | 'used' | 'dismissed'>().notNull().default('new'),
  /** The idea made from it. */
  ideaId: text('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
  foundAt: timestamp('found_at', { withTimezone: true }).notNull().defaultNow(),
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

/**
 * Viewers' comments on a channel's recent videos that wait for its reply, with the reply Gemini
 * drafted (or you wrote) and what became of it (server/replies.ts). Kept so a reload never pays
 * Gemini twice, and so a reply already posted is never listed or posted again. The id is
 * YouTube's id of the comment.
 */
export const commentReplies = pgTable('comment_replies', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  /** The video it is on. */
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  author: text('author').notNull().default(''),
  text: text('text').notNull().default(''),
  likes: integer('likes').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  status: text('status').$type<ReplyStatus>().notNull().default('waiting'),
  /** The reply to post, as drafted or edited (once posted, what was posted); null = not drafted. */
  draft: text('draft'),
  /** Why Gemini suggests no reply; '' when you skipped it yourself. */
  skipReason: text('skip_reason'),
  /** YouTube's id of the reply Cutroom posted. */
  replyId: text('reply_id'),
  createdAt: created(),
})

export const ideas = pgTable('ideas', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  angle: text('angle').notNull().default(''),
  seriesId: text('series_id').references(() => series.id, { onDelete: 'set null' }),
  status: text('status').$type<'new' | 'used' | 'dismissed'>().notNull().default('new'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** The hit of yours it follows up (Ideas → Your hits). */
  followUpOf: text('follow_up_of').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: created(),
})

/** Test runs of the worker from Settings (server/worker-check.ts). Only the latest is kept. */
export const workerChecks = pgTable('worker_checks', {
  id: text('id').primaryKey(),
  status: text('status').$type<CheckStatus>().notNull().default('queued'),
  steps: jsonb('steps').$type<CheckStep[]>().notNull(),
  info: jsonb('info').$type<WorkerInfo>(),
  /** The test clip the worker saved, deleted with the check. */
  clipUrl: text('clip_url'),
  /** Why the worker could not be started, set by the web app. */
  error: text('error'),
  /** When the worker last reported. */
  heardAt: timestamp('heard_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
})

/**
 * AI work run on the server, so it finishes, and shows, whether or not a page is open
 * (server/tasks.ts). Queued tasks wait for the runner, which runs them one at a time, each in a
 * request of its own. A button's AI request records itself here too while it runs (inline), so a
 * reopened page can tell it is still going.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<TaskKind>().notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Tasks queued together, such as Ideas → "Create 5 drafts". They run in `position` order. */
    batchId: text('batch_id'),
    position: integer('position').notNull().default(0),
    input: jsonb('input').$type<TaskInput>().notNull().default({}),
    result: jsonb('result').$type<TaskResult>(),
    /** Run by the request that made it (a button's), not by the queue: never run again. */
    inline: boolean('inline').notNull().default(false),
    status: text('status').$type<TaskStatus>().notNull().default('queued'),
    /** Why it failed, or why it was cancelled. */
    error: text('error'),
    /** Runs started. A run that died is tried once more. */
    attempts: integer('attempts').notNull().default(0),
    /**
     * While running: the run renews this as it works, so once it has passed the run is gone (its
     * request ended or was cut off) and the task can be picked up again.
     */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('tasks_status').on(t.status),
    index('tasks_project').on(t.projectId),
    index('tasks_batch').on(t.batchId),
  ],
)

/**
 * Each Gemini call the web app made (server/ai-calls.ts), for Settings → AI speed: how long it took
 * and why it failed, without needing Vercel's logs. Kept 30 days.
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    /** What it was for: "script (live)", "storyboard part 3", "effects". */
    task: text('task').notNull(),
    model: text('model').notNull(),
    ms: integer('ms').notNull(),
    tries: integer('tries').notNull(),
    waitedMs: integer('waited_ms').notNull().default(0),
    firstWordsMs: integer('first_words_ms'),
    thinkingTokens: integer('thinking_tokens'),
    writtenTokens: integer('written_tokens'),
    /** Why it failed (an AI error code), or null when it answered. */
    error: text('error'),
    createdAt: created(),
  },
  (t) => [index('ai_calls_created').on(t.createdAt)],
)

export type ProjectRow = typeof projects.$inferSelect
export type SceneRow = typeof scenes.$inferSelect
export type CharacterRow = typeof characters.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type ChannelRow = typeof channels.$inferSelect
export type SeriesRow = typeof series.$inferSelect
export type LibraryCharacterRow = typeof libraryCharacters.$inferSelect
export type LibraryBackgroundRow = typeof libraryBackgrounds.$inferSelect
export type IdeaRow = typeof ideas.$inferSelect
export type CommentReplyRow = typeof commentReplies.$inferSelect
export type WorkerCheckRow = typeof workerChecks.$inferSelect
export type TaskRow = typeof tasks.$inferSelect
