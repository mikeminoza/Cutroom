// The "Finish & schedule" pipeline: render → Drive → post details → approval →
// YouTube → thumbnail/captions/playlist → archive. Every step is resumable:
// steps finished in an earlier run are skipped, and their results are reused.
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { composeDescription, hasGeminiKey, writePostDetails } from '@cutroom/shared/ai'
import { captionWords, overlayEvents } from '@cutroom/shared/captions'
import {
  addToPlaylist,
  clientFromRefresh,
  downloadFromDrive,
  driveFolderUrl,
  ensureFolder,
  type OAuthClient,
  setThumbnail,
  uploadCaptions,
  uploadToDrive,
  uploadVideo,
} from '@cutroom/shared/google'
import type { JobPayload } from '@cutroom/shared/protocol'
import {
  downloadTo,
  fileSize,
  guessContentType,
  putLocalFile,
  safeName,
  storageDriver,
} from '@cutroom/shared/storage'
import { formatTimecode, refreshChapters, totalDuration } from '@cutroom/shared/timing'
import { hasPicture, normalizeTransition } from '@cutroom/shared/types'
import { nextSlot } from '../api'
import { runFfmpeg } from '../render/ffmpeg'
import { type RenderLayer, renderVideo } from '../render/render'
import { errorMessage, extensionOf, imageMime, probeSeconds } from '../util'
import type { JobContext } from './context'
import { makeShorts } from './shorts'

const ROOT_FOLDER = 'Cutroom'

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index], index)
    }
  })
  await Promise.all(workers)
}

export async function runPublish(payload: JobPayload, ctx: JobContext): Promise<'done' | 'waiting'> {
  const { project, settings } = payload
  const scenes = [...payload.scenes].sort((a, b) => a.index - b.index)
  const youtube: OAuthClient | null = payload.google.youtubeRefreshToken
    ? clientFromRefresh(payload.google.youtubeRefreshToken)
    : null
  const drive: OAuthClient | null = payload.google.driveRefreshToken
    ? clientFromRefresh(payload.google.driveRefreshToken)
    : null
  const work = (name: string) => path.join(ctx.workDir, name)
  const videoFile = work('video.mp4')
  const srtFile = work('captions.srt')
  const stamp = `projects/${project.id}`

  // ---------------------------------------------------------------- render
  const render = async () => {
    await ctx.step('render', 'running', 'Downloading your files')
    const images: (string | null)[] = scenes.map(() => null)
    const layers: (RenderLayer | null)[] = scenes.map(() => null)
    // Library backgrounds and poses are shared between scenes: each file is downloaded once.
    const shared = new Map<string, Promise<string>>()
    const layerFile = async (url: string | null) => {
      if (!url) return null
      let file = shared.get(url)
      if (!file) {
        const target = work(`layer-${String(shared.size + 1).padStart(3, '0')}${extensionOf(url, '.png')}`)
        file = downloadTo(url, target, payload.appUrl).then(() => target)
        shared.set(url, file)
      }
      return file
    }
    await mapLimit(scenes, 4, async (scene, i) => {
      if (!scene.imageUrl) {
        const layer = scene.layer
        if (!layer || !hasPicture(scene)) return
        const [backgroundPath, posePath, blinkPath] = await Promise.all([
          layerFile(layer.backgroundUrl),
          layerFile(layer.poseUrl),
          layer.poseUrl ? layerFile(layer.blinkUrl) : null,
        ])
        layers[i] = { backgroundPath, posePath, blinkPath, side: layer.side }
        return
      }
      const file = work(`scene-${String(i + 1).padStart(3, '0')}${extensionOf(scene.imageUrl, '.png')}`)
      await downloadTo(scene.imageUrl, file, payload.appUrl)
      images[i] = file
    })
    let voiceoverPath: string | null = null
    let duration = project.voiceoverDuration ?? project.transcript?.duration ?? totalDuration(scenes)
    if (project.voiceoverUrl) {
      voiceoverPath = work(`voiceover${extensionOf(project.voiceoverUrl, '.mp3')}`)
      await downloadTo(project.voiceoverUrl, voiceoverPath, payload.appUrl)
      duration = await probeSeconds(voiceoverPath)
    }
    let musicPath: string | null = null
    if (project.musicUrl) {
      musicPath = work(`music${extensionOf(project.musicUrl, '.mp3')}`)
      await downloadTo(project.musicUrl, musicPath, payload.appUrl)
    }
    if (duration <= 0) throw new Error('The video has no length yet. Add scenes or a voice-over.')

    // Scenes must cover the whole video without gaps.
    const timeline = scenes.map((scene, i) => ({
      start: i === 0 ? 0 : scene.start,
      end: i === scenes.length - 1 ? duration : scenes[i + 1].start,
      imagePath: images[i],
      layer: layers[i],
      motion: scene.motion,
      fit: scene.fit,
      focusX: scene.focusX,
      focusY: scene.focusY,
      transition: normalizeTransition(scene.transition),
    }))
    const started = Date.now()
    const output = await renderVideo({
      workDir: ctx.workDir,
      format: project.format,
      resolution: project.resolution,
      captionStyle: project.captionStyle,
      scenes: timeline,
      voiceoverPath,
      duration,
      words: captionWords(project.transcript, scenes),
      overlays: project.textOverlays ? overlayEvents(scenes, duration) : [],
      musicPath,
      musicVolume: project.musicVolume,
      signal: ctx.signal,
      onProgress: (fraction, detail) => ctx.progress('render', fraction, detail),
    })
    if (path.resolve(output.videoPath) !== path.resolve(videoFile)) {
      const { rename } = await import('node:fs/promises')
      await rename(output.videoPath, videoFile)
    }
    if (path.resolve(output.srtPath) !== path.resolve(srtFile)) {
      const { copyFile } = await import('node:fs/promises')
      await copyFile(output.srtPath, srtFile)
    }
    const srt = await putLocalFile(`${stamp}/captions.srt`, srtFile, 'application/x-subrip')
    const patch: Parameters<JobContext['result']>[0] = { srtUrl: srt.url, srtKey: srt.key }
    // Keep a copy in app storage when Drive won't hold it (or storage is local and free).
    if (!drive || storageDriver() === 'local') {
      await ctx.step('render', 'running', 'Saving the video')
      const stored = await putLocalFile(`${stamp}/renders/video.mp4`, videoFile, 'video/mp4')
      patch.outputUrl = stored.url
      patch.outputKey = stored.key
    }
    await ctx.result(patch)
    const seconds = Math.round((Date.now() - started) / 1000)
    await ctx.step(
      'render',
      'done',
      `${formatTimecode(output.durationSeconds, false)} video at ${project.resolution}, rendered in ${seconds}s`,
    )
  }

  /** Gets the rendered video onto local disk, from this run, Drive, storage, or a fresh render. */
  const ensureVideo = async () => {
    if (existsSync(videoFile)) return
    if (ctx.data.driveFileId && drive) await downloadFromDrive(drive, ctx.data.driveFileId, videoFile)
    else if (ctx.data.outputUrl) await downloadTo(ctx.data.outputUrl, videoFile, payload.appUrl)
    else await render()
    if (!existsSync(srtFile) && ctx.data.srtUrl) await downloadTo(ctx.data.srtUrl, srtFile, payload.appUrl)
  }

  if (!ctx.finished('render')) await render()

  // ---------------------------------------------------------------- drive
  const projectFolder = async (): Promise<string> => {
    if (!drive) throw new Error('Google Drive is not connected.')
    if (ctx.data.driveFolderId) return ctx.data.driveFolderId
    const root = await ensureFolder(drive, ROOT_FOLDER)
    const name = safeName(project.title || 'Untitled video').replace(/-/g, ' ')
    const id =
      project.driveFolderId || (await ensureFolder(drive, `${name} (${project.id.slice(0, 6)})`, root))
    await ctx.result({ driveFolderId: id, driveFolderUrl: driveFolderUrl(id) })
    return id
  }

  if (!ctx.finished('drive')) {
    if (!drive) {
      await ctx.step('drive', 'skipped', 'Google Drive is not connected')
    } else {
      await ctx.step('drive', 'running', 'Uploading to Google Drive')
      await ensureVideo()
      try {
        const folderId = await projectFolder()
        const file = await uploadToDrive(drive, {
          filePath: videoFile,
          name: 'video.mp4',
          mimeType: 'video/mp4',
          folderId,
          onProgress: (f) => ctx.progress('drive', f, `Uploading to Google Drive (${Math.round(f * 100)}%)`),
        })
        if (existsSync(srtFile)) {
          await uploadToDrive(drive, {
            filePath: srtFile,
            name: 'captions.srt',
            mimeType: 'application/x-subrip',
            folderId,
          })
        }
        await ctx.result({ driveFileId: file.id, driveFileUrl: file.url })
        await ctx.step('drive', 'done', 'Saved in your Cutroom folder')
      } catch (error) {
        // Drive is a backup copy: a full or disconnected Drive must not stop the video going out.
        if (ctx.signal.aborted) throw error
        await ctx.warn(`Not saved to Google Drive: ${errorMessage(error)}`)
        await ctx.step('drive', 'skipped', 'Could not save to Google Drive')
      }
    }
  }

  // ---------------------------------------------------------------- details
  let post = ctx.data.post ?? project.post
  if (!ctx.finished('details')) {
    if (project.post.title.trim() && project.post.description.trim()) {
      // Written earlier, perhaps before the voice-over moved the scenes: bring the chapters along.
      const length = project.voiceoverDuration ?? project.transcript?.duration ?? totalDuration(scenes)
      post = refreshChapters(
        project.post,
        scenes.map((s) => s.start),
        length,
      )
      await ctx.result({ post })
      await ctx.step(
        'details',
        'skipped',
        post === project.post
          ? 'Using the details you wrote'
          : 'Using your details, with chapter times updated',
      )
    } else if (!hasGeminiKey() || project.post.aiFill === false) {
      // No AI (not set up, or turned off for this video): post with what the project already
      // knows rather than stopping.
      const firstSentences = project.script
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(' ')
      post = {
        ...project.post,
        title: project.post.title.trim() || project.title.trim() || project.topic.slice(0, 90) || 'New video',
        description:
          project.post.description.trim() ||
          composeDescription(
            project.topic.trim() || firstSentences,
            [],
            settings.defaults.descriptionFooter,
            [],
          ),
        tags: project.post.tags.length ? project.post.tags : settings.defaults.tags,
      }
      await ctx.result({ post })
      await ctx.warn(
        project.post.aiFill === false
          ? 'You left part of the post details empty with Gemini turned off, so a basic title or description was used. Edit them in YouTube Studio.'
          : 'Gemini is not set up, so a basic title and description were used. Edit them in YouTube Studio.',
      )
      await ctx.step('details', 'done', post.title)
    } else {
      await ctx.step('details', 'running', 'Gemini is writing the title, description and tags')
      const duration = project.voiceoverDuration ?? project.transcript?.duration ?? totalDuration(scenes)
      const draft = await writePostDetails({
        title: project.title,
        topic: project.topic,
        audience: project.audience,
        language: project.language,
        format: project.format,
        duration,
        script: project.script,
        scenes: scenes.map((s) => ({ start: s.start, narration: s.narration })),
        defaultTags: settings.defaults.tags,
        descriptionFooter: settings.defaults.descriptionFooter,
        topTitles: payload.insights?.topTitles ?? [],
      })
      post = {
        ...project.post,
        titleOptions: draft.titleOptions,
        title: project.post.title.trim() || draft.titleOptions[0] || project.title,
        description: draft.description,
        tags: draft.tags,
        hashtags: draft.hashtags,
        chapters: draft.chapters,
        thumbnailIdeas: draft.thumbnailIdeas,
        comment: project.post.comment?.trim() || draft.comment,
      }
      await ctx.result({ post })
      await ctx.step('details', 'done', post.title)
    }
    if (drive) {
      const detailsFile = work('post-details.json')
      await writeFile(detailsFile, JSON.stringify(post, null, 2))
      await uploadToDrive(drive, {
        filePath: detailsFile,
        name: 'post-details.json',
        mimeType: 'application/json',
        folderId: await projectFolder(),
      }).catch((error) => ctx.warn(`Post details were not saved to Drive: ${errorMessage(error)}`))
    }
  }

  // ---------------------------------------------------------------- approve
  if (!ctx.finished('approve')) {
    if (project.mode !== 'review') {
      await ctx.step('approve', 'skipped', 'Auto-pilot')
    } else if (payload.job.approved) {
      await ctx.step('approve', 'done', 'Approved')
    } else {
      await ctx.waiting('approve', 'Check the title, description and tags, then approve to upload.')
      return 'waiting'
    }
  }

  // ---------------------------------------------------------------- youtube
  if (!ctx.finished('youtube')) {
    if (!youtube && payload.google.youtubeChannelMissing) {
      throw new Error("This video's YouTube channel was disconnected. Reconnect it in Settings, then retry.")
    } else if (!youtube) {
      await ctx.step('youtube', 'skipped', 'YouTube is not connected')
    } else if (ctx.data.youtubeVideoId) {
      await ctx.step('youtube', 'done', 'Already uploaded')
    } else {
      await ctx.step('youtube', 'running', 'Uploading to YouTube')
      await ensureVideo()
      let publishAt = project.scheduledAt
      if (publishAt && new Date(publishAt).getTime() < Date.now() + 10 * 60_000) {
        // The render ran past the posting time: keep to the schedule rather than post at a random hour.
        publishAt = await nextSlot(ctx.jobId)
        await ctx.warn(
          publishAt
            ? `Missed its posting time while rendering, so it moved to the next free slot: ${new Date(publishAt).toUTCString()}.`
            : 'Missed its posting time while rendering and no posting slot was free, so it was posted right away.',
        )
      }
      const videoId = await uploadVideo(youtube, {
        filePath: videoFile,
        title: post.title || post.titleOptions[0] || project.title || 'Untitled video',
        description: post.description,
        tags: post.tags,
        categoryId: post.categoryId,
        privacy: post.privacy,
        publishAt,
        madeForKids: post.madeForKids,
        language: post.language,
        onProgress: (f) => ctx.progress('youtube', f, `Uploading to YouTube (${Math.round(f * 100)}%)`),
      })
      await ctx.result({ youtubeVideoId: videoId, publishAt })
      await ctx.step('youtube', 'done', publishAt ? 'Uploaded and scheduled' : `Uploaded as ${post.privacy}`)
    }
  }

  // ---------------------------------------------------------------- finish
  if (!ctx.finished('finish')) {
    const videoId = ctx.data.youtubeVideoId
    if (!youtube || !videoId) {
      await ctx.step('finish', 'skipped', 'Nothing was uploaded to YouTube')
    } else {
      await ctx.step('finish', 'running', 'Adding thumbnail, captions and playlist')
      const done: string[] = []
      if (project.thumbnailUrl) {
        try {
          const ext = extensionOf(project.thumbnailUrl, '.png')
          let thumb = work(`thumbnail${ext}`)
          let mime = imageMime(ext)
          await downloadTo(project.thumbnailUrl, thumb, payload.appUrl)
          // YouTube refuses thumbnails over 2 MB (large PNGs, generated images): send a JPEG.
          if ((await fileSize(thumb)) > 2 * 1024 * 1024) {
            const jpeg = work('thumbnail-small.jpg')
            await runFfmpeg([
              '-i',
              thumb,
              '-vf',
              "scale='min(1280,iw)':-2",
              '-q:v',
              '3',
              '-frames:v',
              '1',
              jpeg,
            ])
            thumb = jpeg
            mime = 'image/jpeg'
          }
          await setThumbnail(youtube, videoId, thumb, mime)
          done.push('thumbnail')
        } catch (error) {
          await ctx.warn(
            `Thumbnail not set: ${errorMessage(error)}. Custom thumbnails need a verified channel (youtube.com/verify).`,
          )
        }
      }
      if (ctx.data.srtUrl) {
        try {
          if (!existsSync(srtFile)) await downloadTo(ctx.data.srtUrl, srtFile, payload.appUrl)
          await uploadCaptions(youtube, videoId, srtFile, post.language)
          done.push('captions')
        } catch (error) {
          await ctx.warn(`Captions not added: ${errorMessage(error)}`)
        }
      }
      if (post.playlistId) {
        try {
          await addToPlaylist(youtube, post.playlistId, videoId)
          done.push('playlist')
        } catch (error) {
          await ctx.warn(`Not added to the playlist: ${errorMessage(error)}`)
        }
      }
      await ctx.step('finish', 'done', done.length ? `Added ${done.join(', ')}` : 'Nothing extra to add')
    }
  }

  // ---------------------------------------------------------------- shorts
  // Before archiving: a Short copies this video's pictures, which archiving may delete.
  if (!ctx.finished('shorts')) await makeShorts(payload, ctx, scenes, post.title || project.title)

  // ---------------------------------------------------------------- archive
  if (!ctx.finished('archive')) {
    if (!drive) {
      await ctx.step('archive', 'skipped', 'Google Drive is not connected')
    } else if (!ctx.data.driveFileId) {
      // The video itself didn't reach Drive: keep the working files where they are.
      await ctx.step('archive', 'skipped', 'The video was not saved to Drive, so the project files stay put')
    } else {
      await ctx.step('archive', 'running', 'Copying project files to Google Drive')
      let filesFolder: string
      try {
        filesFolder = await ensureFolder(drive, 'files', await projectFolder())
      } catch (error) {
        if (ctx.signal.aborted) throw error
        await ctx.warn(`Project files were not copied to Drive: ${errorMessage(error)}`)
        await ctx.step('archive', 'skipped', 'Could not reach Google Drive')
        return 'done'
      }
      const files: { url: string; name: string }[] = []
      scenes.forEach((s, i) => {
        if (s.imageUrl)
          files.push({
            url: s.imageUrl,
            name: `scene-${String(i + 1).padStart(3, '0')}${extensionOf(s.imageUrl, '.png')}`,
          })
      })
      if (project.voiceoverUrl)
        files.push({
          url: project.voiceoverUrl,
          name: `voiceover${extensionOf(project.voiceoverUrl, '.mp3')}`,
        })
      if (project.musicUrl)
        files.push({ url: project.musicUrl, name: `music${extensionOf(project.musicUrl, '.mp3')}` })
      if (project.thumbnailUrl)
        files.push({
          url: project.thumbnailUrl,
          name: `thumbnail${extensionOf(project.thumbnailUrl, '.png')}`,
        })
      payload.characters.forEach((c) => {
        c.images.forEach((img, i) => {
          files.push({
            url: img.url,
            name: `character-${safeName(c.name)}-${i + 1}${extensionOf(img.url, '.png')}`,
          })
        })
      })
      const archived: string[] = []
      for (const [i, file] of files.entries()) {
        const local = work(`archive-${i}-${file.name}`)
        try {
          await downloadTo(file.url, local, payload.appUrl)
          await uploadToDrive(drive, {
            filePath: local,
            name: file.name,
            mimeType: guessContentType(file.name),
            folderId: filesFolder,
          })
          archived.push(file.url)
        } catch (error) {
          await ctx.warn(`${file.name} was not archived: ${errorMessage(error)}`)
        }
        ctx.progress('archive', (i + 1) / files.length, `Copying project files (${i + 1} of ${files.length})`)
      }
      await ctx.result({ archivedKeys: archived })
      await ctx.step('archive', 'done', `${archived.length} files copied to Drive`)
    }
  }
  return 'done'
}
