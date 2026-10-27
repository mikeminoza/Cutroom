// Google OAuth, YouTube and Drive helpers. Server-side only.
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { drive as driveApi } from '@googleapis/drive'
import { auth, youtube as youtubeApi } from '@googleapis/youtube'
import { type ChannelSetup, formatChannelKeywords, parseChannelKeywords } from './setup'
import type { Privacy } from './types'

export type GoogleProvider = 'youtube' | 'drive'

const IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email']

/** Read-only YouTube Analytics: watch time and retention for the Performance page. */
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly'

export const SCOPES: Record<GoogleProvider, string[]> = {
  youtube: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    ANALYTICS_SCOPE,
    ...IDENTITY,
  ],
  drive: ['https://www.googleapis.com/auth/drive.file', ...IDENTITY],
}

/** Channels connected before analytics existed (or with the box unticked) lack the permission. */
/**
 * A plain explanation of the Google errors that need you to do something, or null for others.
 * These are the ones a free setup runs into: a login Google ended (in Testing mode that happens
 * every 7 days), and the daily quotas of YouTube and Drive.
 */
export function explainGoogleError(error: unknown): string | null {
  const e = error as {
    message?: string
    errors?: { reason?: string }[]
    response?: { data?: { error?: unknown; error_description?: string } }
  } | null
  const reasons = (e?.errors ?? []).map((x) => x.reason ?? '')
  const text = `${e?.message ?? ''} ${String(e?.response?.data?.error ?? '')}`
  if (/invalid_grant/.test(text)) {
    return 'Google signed Cutroom out of this account. Reconnect it in Settings. If this happens about once a week, publish your app in Google Cloud (Google Auth platform → Audience → Publish app).'
  }
  if (reasons.includes('uploadLimitExceeded')) {
    return 'YouTube says this channel has reached its upload limit for today. Click Retry tomorrow.'
  }
  if (reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) {
    return "The YouTube API's free daily quota is used up. It resets at midnight Pacific time; click Retry after that."
  }
  if (reasons.includes('storageQuotaExceeded')) {
    return 'Your Google Drive is full. Delete old Cutroom folders in Drive to free up space.'
  }
  return null
}

export function hasAnalyticsScope(scope: string | null | undefined): boolean {
  return Boolean(scope?.split(/\s+/).includes(ANALYTICS_SCOPE))
}

export function hasGoogleClient(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export type OAuthClient = InstanceType<typeof auth.OAuth2>

export function oauthClient(redirectUri?: string): OAuthClient {
  if (!hasGoogleClient()) throw new Error('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Google.')
  return new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri)
}

export function authUrl(provider: GoogleProvider, redirectUri: string, state: string): string {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: SCOPES[provider],
    state,
  })
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; email: string | null; scope: string }> {
  const client = oauthClient(redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.',
    )
  }
  let email: string | null = null
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    email = ticket.getPayload()?.email ?? null
  }
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? '',
    email,
    scope: tokens.scope ?? '',
  }
}

export function clientFromRefresh(refreshToken: string): OAuthClient {
  const client = oauthClient()
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

// ---------------------------------------------------------------------------
// YouTube

export async function channelInfo(client: OAuthClient): Promise<{ id: string; title: string } | null> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.channels.list({ part: ['snippet'], mine: true })
  const channel = res.data.items?.[0]
  return channel?.id ? { id: channel.id, title: channel.snippet?.title ?? 'Your channel' } : null
}

/** The channel's country, language, About text, keywords and verification, for Channel setup. */
export async function channelSetup(client: OAuthClient): Promise<ChannelSetup | null> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.channels.list({ part: ['snippet', 'brandingSettings', 'status'], mine: true })
  const channel = res.data.items?.[0]
  if (!channel?.id) return null
  const branding = channel.brandingSettings?.channel
  return {
    id: channel.id,
    title: channel.snippet?.title ?? 'Your channel',
    country: branding?.country ?? channel.snippet?.country ?? '',
    defaultLanguage: branding?.defaultLanguage ?? channel.snippet?.defaultLanguage ?? '',
    description: branding?.description ?? channel.snippet?.description ?? '',
    keywords: parseChannelKeywords(branding?.keywords ?? ''),
    longUploads: channel.status?.longUploadsStatus ?? null,
  }
}

export interface ChannelBrandingPatch {
  country?: string
  defaultLanguage?: string
  description?: string
  keywords?: string[]
}

/**
 * The channel settings to send with `patch` applied. YouTube deletes every settable value an
 * update leaves out, so all of them are carried over from what the channel has now.
 */
export function mergeBranding(
  current: object | null | undefined,
  patch: ChannelBrandingPatch,
): Record<string, string> {
  const settable = [
    'country',
    'defaultLanguage',
    'description',
    'keywords',
    'trackingAnalyticsAccountId',
    'unsubscribedTrailer',
  ]
  const merged: Record<string, string> = {}
  for (const key of settable) {
    const value = (current as Record<string, unknown> | null | undefined)?.[key]
    if (typeof value === 'string' && value) merged[key] = value
  }
  if (patch.country !== undefined) merged.country = patch.country
  if (patch.defaultLanguage !== undefined) merged.defaultLanguage = patch.defaultLanguage
  if (patch.description !== undefined) merged.description = patch.description
  if (patch.keywords !== undefined) merged.keywords = formatChannelKeywords(patch.keywords)
  return merged
}

/** Changes only the given channel settings on YouTube and returns them as they are now. */
export async function updateChannelBranding(
  client: OAuthClient,
  patch: ChannelBrandingPatch,
): Promise<ChannelSetup | null> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.channels.list({ part: ['brandingSettings'], mine: true })
  const channel = res.data.items?.[0]
  if (!channel?.id) return null
  await yt.channels.update({
    part: ['brandingSettings'],
    requestBody: {
      id: channel.id,
      brandingSettings: { channel: mergeBranding(channel.brandingSettings?.channel, patch) },
    },
  })
  return channelSetup(client)
}

export async function listPlaylists(client: OAuthClient): Promise<{ id: string; title: string }[]> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.playlists.list({ part: ['snippet'], mine: true, maxResults: 50 })
  return (res.data.items ?? []).map((p) => ({ id: p.id ?? '', title: p.snippet?.title ?? 'Untitled' }))
}

export interface UploadVideoInput {
  filePath: string
  title: string
  description: string
  tags: string[]
  categoryId: string
  privacy: Privacy
  publishAt: string | null
  madeForKids: boolean
  language: string
  onProgress?: (fraction: number) => void
}

export async function uploadVideo(client: OAuthClient, input: UploadVideoInput): Promise<string> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const size = (await stat(input.filePath)).size
  const scheduled = Boolean(input.publishAt)
  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      notifySubscribers: true,
      requestBody: {
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: input.tags,
          categoryId: input.categoryId,
          defaultLanguage: input.language || undefined,
          defaultAudioLanguage: input.language || undefined,
        },
        status: {
          // YouTube only honours publishAt on private videos.
          privacyStatus: scheduled ? 'private' : input.privacy,
          publishAt: input.publishAt ?? undefined,
          selfDeclaredMadeForKids: input.madeForKids,
          embeddable: true,
        },
      },
      media: { body: createReadStream(input.filePath) },
    },
    {
      onUploadProgress: (event: { bytesRead: number }) =>
        input.onProgress?.(Math.min(1, event.bytesRead / size)),
    },
  )
  if (!res.data.id) throw new Error('YouTube accepted the upload but returned no video id.')
  return res.data.id
}

export async function setThumbnail(client: OAuthClient, videoId: string, filePath: string, mimeType: string) {
  const yt = youtubeApi({ version: 'v3', auth: client })
  await yt.thumbnails.set({ videoId, media: { mimeType, body: createReadStream(filePath) } })
}

export async function uploadCaptions(
  client: OAuthClient,
  videoId: string,
  srtPath: string,
  language: string,
) {
  const yt = youtubeApi({ version: 'v3', auth: client })
  await yt.captions.insert({
    part: ['snippet'],
    requestBody: { snippet: { videoId, language: language || 'en', name: '', isDraft: false } },
    media: { mimeType: 'application/octet-stream', body: createReadStream(srtPath) },
  })
}

export async function addToPlaylist(client: OAuthClient, playlistId: string, videoId: string) {
  const yt = youtubeApi({ version: 'v3', auth: client })
  await yt.playlistItems.insert({
    part: ['snippet'],
    requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
  })
}

export async function videoStatus(
  client: OAuthClient,
  videoId: string,
): Promise<{ privacy: string; publishAt: string | null; processed: boolean } | null> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.videos.list({ part: ['status', 'processingDetails'], id: [videoId] })
  const video = res.data.items?.[0]
  if (!video) return null
  return {
    privacy: video.status?.privacyStatus ?? 'private',
    publishAt: video.status?.publishAt ?? null,
    processed: video.processingDetails?.processingStatus === 'succeeded',
  }
}

export async function reschedule(
  client: OAuthClient,
  videoId: string,
  publishAt: string,
  madeForKids: boolean,
) {
  const yt = youtubeApi({ version: 'v3', auth: client })
  await yt.videos.update({
    part: ['status'],
    requestBody: {
      id: videoId,
      status: { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: madeForKids },
    },
  })
}

export interface VideoStatistics {
  views: number
  likes: number
  comments: number
  publishedAt: string | null
  privacy: string
}

/** Public counters for up to any number of videos (50 per request, 1 quota unit each). */
export async function videoStatistics(
  client: OAuthClient,
  ids: string[],
): Promise<Map<string, VideoStatistics>> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const result = new Map<string, VideoStatistics>()
  for (let i = 0; i < ids.length; i += 50) {
    const res = await yt.videos.list({
      part: ['statistics', 'snippet', 'status'],
      id: ids.slice(i, i + 50),
      maxResults: 50,
    })
    for (const video of res.data.items ?? []) {
      if (!video.id) continue
      result.set(video.id, {
        views: Number(video.statistics?.viewCount ?? 0),
        likes: Number(video.statistics?.likeCount ?? 0),
        comments: Number(video.statistics?.commentCount ?? 0),
        publishedAt: video.snippet?.publishedAt ?? null,
        privacy: video.status?.privacyStatus ?? 'private',
      })
    }
  }
  return result
}

/** Posts a top-level comment on a video from the channel (50 quota units). Returns its id. */
export async function postComment(client: OAuthClient, videoId: string, text: string): Promise<string> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  const res = await yt.commentThreads.insert({
    part: ['snippet'],
    requestBody: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } },
  })
  return res.data.snippet?.topLevelComment?.id ?? res.data.id ?? ''
}

export interface ChannelVideo {
  title: string
  description: string
  seconds: number
  views: number
  thumbnail: string | null
}

/** A channel from a link or handle: youtube.com/@name, youtube.com/channel/UC…, or "@name". */
export function channelRef(input: string): { handle: string } | { id: string } | null {
  const text = input.trim()
  const id = text.match(/\b(UC[\w-]{22})\b/)
  if (id) return { id: id[1] }
  const handle = text.match(/@([\w.-]{3,100})/)
  return handle ? { handle: `@${handle[1]}` } : null
}

/** "PT7M33S" → 453. */
function isoSeconds(duration: string | null | undefined): number {
  const m = duration?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)
}

/** A public channel's title, description and newest uploads (3 quota units). */
export async function channelUploads(
  client: OAuthClient,
  input: string,
  max = 40,
): Promise<{ title: string; description: string; videos: ChannelVideo[] }> {
  const ref = channelRef(input)
  if (!ref) throw new Error('Paste a channel link like youtube.com/@name.')
  const yt = youtubeApi({ version: 'v3', auth: client })
  const found = await yt.channels.list({
    part: ['snippet', 'contentDetails'],
    ...('id' in ref ? { id: [ref.id] } : { forHandle: ref.handle }),
  })
  const channel = found.data.items?.[0]
  if (!channel) throw new Error('That channel was not found on YouTube.')
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads
  const items = uploads
    ? ((
        await yt.playlistItems.list({
          part: ['contentDetails'],
          playlistId: uploads,
          maxResults: Math.min(50, max),
        })
      ).data.items ?? [])
    : []
  const ids = items.map((i) => i.contentDetails?.videoId).filter((v): v is string => Boolean(v))
  const videos = ids.length
    ? ((await yt.videos.list({ part: ['snippet', 'contentDetails', 'statistics'], id: ids, maxResults: 50 }))
        .data.items ?? [])
    : []
  return {
    title: channel.snippet?.title ?? '',
    description: channel.snippet?.description ?? '',
    videos: videos.map((v) => ({
      title: v.snippet?.title ?? '',
      description: (v.snippet?.description ?? '').slice(0, 400),
      seconds: isoSeconds(v.contentDetails?.duration),
      views: Number(v.statistics?.viewCount ?? 0),
      thumbnail: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
    })),
  }
}

export interface VideoComment {
  text: string
  likes: number
}

/**
 * A video's top-level comments, most relevant first (1 quota unit per call, up to 100). A video
 * with comments turned off, or gone, has none.
 */
export async function videoComments(client: OAuthClient, videoId: string, max = 50): Promise<VideoComment[]> {
  const yt = youtubeApi({ version: 'v3', auth: client })
  try {
    const res = await yt.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults: Math.min(100, Math.max(1, max)),
      order: 'relevance',
      textFormat: 'plainText',
    })
    return (res.data.items ?? []).flatMap((thread) => {
      const top = thread.snippet?.topLevelComment?.snippet
      const text = top?.textDisplay?.trim()
      return text ? [{ text, likes: Number(top?.likeCount ?? 0) }] : []
    })
  } catch (error) {
    const e = error as {
      errors?: { reason?: string }[]
      response?: { data?: { error?: { errors?: { reason?: string }[] } } }
    }
    const reason = e.errors?.[0]?.reason ?? e.response?.data?.error?.errors?.[0]?.reason
    if (reason === 'commentsDisabled' || reason === 'videoNotFound') return []
    throw error
  }
}

export interface VideoAnalytics {
  watchMinutes: number
  averageViewSeconds: number
  averageViewPercent: number
  subscribersGained: number
}

/** Thrown when YouTube Analytics can't be used at all, so the caller stops asking for the rest. */
export class AnalyticsUnavailable extends Error {}

/**
 * Watch time and retention for one video from the YouTube Analytics API (needs ANALYTICS_SCOPE and
 * the API enabled in Google Cloud). Returns null while YouTube has no data for it yet.
 */
export async function videoAnalytics(
  client: OAuthClient,
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<VideoAnalytics | null> {
  const { token } = await client.getAccessToken()
  if (!token) throw new AnalyticsUnavailable('Google did not return an access token.')
  const params = new URLSearchParams({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained',
    filters: `video==${videoId}`,
  })
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    const message = body?.error?.message ?? `HTTP ${res.status}`
    // 401/403: missing permission or the API is not enabled for the Google Cloud project.
    if (res.status === 401 || res.status === 403) throw new AnalyticsUnavailable(message)
    throw new Error(`YouTube Analytics: ${message}`)
  }
  const data = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] }
  const row = data.rows?.[0]
  if (!row || !data.columnHeaders) return null
  const value = (name: string) => {
    const index = data.columnHeaders!.findIndex((h) => h.name === name)
    return index >= 0 ? Number(row[index] ?? 0) : 0
  }
  return {
    watchMinutes: value('estimatedMinutesWatched'),
    averageViewSeconds: value('averageViewDuration'),
    averageViewPercent: value('averageViewPercentage'),
    subscribersGained: value('subscribersGained'),
  }
}

export function youtubeUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`
}

export function youtubeStudioUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`
}

// ---------------------------------------------------------------------------
// Google Drive (drive.file scope: the app only sees files it created)

const FOLDER = 'application/vnd.google-apps.folder'

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function ensureFolder(client: OAuthClient, name: string, parentId?: string): Promise<string> {
  const drive = driveApi({ version: 'v3', auth: client })
  const parent = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents"
  const found = await drive.files.list({
    q: `mimeType='${FOLDER}' and name='${escapeQuery(name)}' and trashed=false${parent}`,
    fields: 'files(id)',
    pageSize: 1,
  })
  const existing = found.data.files?.[0]?.id
  if (existing) return existing
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined },
    fields: 'id',
  })
  if (!created.data.id) throw new Error('Google Drive did not create the folder.')
  return created.data.id
}

export async function uploadToDrive(
  client: OAuthClient,
  input: {
    filePath: string
    name: string
    mimeType: string
    folderId: string
    onProgress?: (f: number) => void
  },
): Promise<{ id: string; url: string }> {
  const drive = driveApi({ version: 'v3', auth: client })
  const size = (await stat(input.filePath)).size
  const existing = await drive.files.list({
    q: `name='${escapeQuery(input.name)}' and '${input.folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  })
  const media = { mimeType: input.mimeType, body: createReadStream(input.filePath) }
  const options = {
    onUploadProgress: (event: { bytesRead: number }) =>
      input.onProgress?.(Math.min(1, event.bytesRead / size)),
  }
  const existingId = existing.data.files?.[0]?.id
  const res = existingId
    ? await drive.files.update({ fileId: existingId, media, fields: 'id' }, options)
    : await drive.files.create(
        { requestBody: { name: input.name, parents: [input.folderId] }, media, fields: 'id' },
        options,
      )
  if (!res.data.id) throw new Error('Google Drive did not return a file id.')
  return { id: res.data.id, url: driveFileUrl(res.data.id) }
}

export async function downloadFromDrive(client: OAuthClient, fileId: string, destination: string) {
  const drive = driveApi({ version: 'v3', auth: client })
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
  await pipeline(res.data as unknown as NodeJS.ReadableStream, createWriteStream(destination))
}

export async function driveUsage(
  client: OAuthClient,
): Promise<{ used: number; limit: number | null; email: string | null }> {
  const drive = driveApi({ version: 'v3', auth: client })
  const res = await drive.about.get({ fields: 'storageQuota,user(emailAddress)' })
  const quota = res.data.storageQuota
  return {
    used: Number(quota?.usage ?? 0),
    limit: quota?.limit ? Number(quota.limit) : null,
    email: res.data.user?.emailAddress ?? null,
  }
}

export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`
}

export function drivePreviewUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/preview`
}
