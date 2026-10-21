// Server logic against a real embedded Postgres (PGlite) and local file storage in a temp folder.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localPath, putFile } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-test-'))
process.env.PGLITE_DIR = path.join(temp, 'pglite')
process.env.STORAGE_DIR = path.join(temp, 'storage')
for (const name of [
  'DATABASE_URL',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'WORKER_URL',
  'GITHUB_DISPATCH_TOKEN',
  'GITHUB_REPO',
  // Set by GitHub Actions itself when these tests run in CI.
  'GITHUB_WORKFLOW_FILE',
  'GITHUB_BRANCH',
  'GITHUB_API_URL',
  'NOTIFY_DISCORD_WEBHOOK_URL',
  'NOTIFY_TELEGRAM_BOT_TOKEN',
  'NOTIFY_TELEGRAM_CHAT_ID',
  'RESEND_API_KEY',
  'NOTIFY_EMAIL_TO',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APP_PASSWORD',
  'CRON_SECRET',
]) {
  delete process.env[name]
}

const { db, schema } = await import('../src/server/db')
const projects = await import('../src/server/projects')
const jobs = await import('../src/server/jobs')
const connections = await import('../src/server/connections')
const series = await import('../src/server/series')
const shorts = await import('../src/server/shorts')
const analytics = await import('../src/server/analytics')
const notify = await import('../src/server/notify')
const { HttpError } = await import('../src/server/http')
const cron = await import('../src/app/api/cron/route')
const settingsModule = await import('../src/server/settings')
const libraryRoute = await import('../src/app/api/library/characters/route')
const libraryItemRoute = await import('../src/app/api/library/characters/[id]/route')
const projectRoute = await import('../src/app/api/projects/[id]/route')
const sceneRoute = await import('../src/app/api/scenes/[id]/route')
const characterRoute = await import('../src/app/api/characters/[id]/route')
const rescheduleRoute = await import('../src/app/api/worker/jobs/[id]/reschedule/route')
const { DEFAULT_SETTINGS } = await import('@cutroom/shared/types')

const stored = (key: string) => existsSync(localPath(key))
const keyOfUrl = (url: string) => url.replace('/api/files/', '')

async function newProject(format: 'landscape' | 'portrait' = 'landscape') {
  return projects.createProject({ title: 'Test video', topic: 'Octopuses', format })
}

async function jobRow(id: string) {
  const database = await db()
  const [row] = await database.select().from(schema.jobs).where(eq(schema.jobs.id, id))
  return row
}

beforeAll(async () => {
  await db()
})

afterAll(() => {
  rmSync(temp, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('job lease', () => {
  it('lets one worker hold a job, refuses the other, and frees it when the holder goes quiet', async () => {
    const projectId = await newProject()
    const job = await jobs.startJob(projectId, 'publish')
    expect(await jobs.claimJob(job.id, 'worker-a')).toBe('granted')
    expect(await jobs.claimJob(job.id, 'worker-b')).toBe('held')
    expect(await jobs.claimJob(job.id, 'worker-a')).toBe('granted')

    // Reports from a worker that does not hold the job are refused.
    await expect(
      jobs.applyEvent(job.id, { type: 'step', key: 'render', status: 'running' }, 'worker-b'),
    ).rejects.toMatchObject({ status: 409 })
    await jobs.applyEvent(job.id, { type: 'step', key: 'render', status: 'running' }, 'worker-a')
    expect((await jobRow(job.id)).status).toBe('running')

    // worker-a goes quiet for longer than the stall limit: worker-b may take over.
    const database = await db()
    await database
      .update(schema.jobs)
      .set({ heartbeatAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.jobs.id, job.id))
    expect(await jobs.claimJob(job.id, 'worker-b')).toBe('granted')
    await expect(
      jobs.applyEvent(job.id, { type: 'step', key: 'render', status: 'done' }, 'worker-a'),
    ).rejects.toBeInstanceOf(HttpError)
  })

  it('releases the job when it waits for approval, and an approved job can be claimed again', async () => {
    const projectId = await newProject()
    const database = await db()
    const job = await jobs.startJob(projectId, 'publish')
    await jobs.claimJob(job.id, 'worker-a')
    await jobs.applyEvent(job.id, { type: 'waiting', key: 'approve', detail: 'Check it' }, 'worker-a')
    const waiting = await jobRow(job.id)
    expect(waiting.status).toBe('waiting')
    expect(waiting.runnerId).toBeNull()
    expect(await jobs.claimJob(job.id, 'worker-b')).toBe('not-runnable')

    await database
      .update(schema.projects)
      .set({ post: { ...(await projects.getProjectRow(projectId)).post, title: 'A title' } })
      .where(eq(schema.projects.id, projectId))
    await jobs.approveJob(job.id)
    expect(await jobs.claimJob(job.id, 'worker-b')).toBe('granted')
  })

  it('stops a cancelled job’s worker at its next report', async () => {
    const projectId = await newProject()
    const job = await jobs.startJob(projectId, 'publish')
    await jobs.claimJob(job.id, 'worker-a')
    await jobs.cancelJob(job.id)
    await expect(
      jobs.applyEvent(job.id, { type: 'result', patch: { warnings: [] } }, 'worker-a'),
    ).rejects.toMatchObject({ status: 409 })
    expect(await jobs.claimJob(job.id, 'worker-a')).toBe('not-runnable')
  })

  it('accepts reports from older workers that send no runner id', async () => {
    const projectId = await newProject()
    const job = await jobs.startJob(projectId, 'retime')
    await jobs.applyEvent(job.id, { type: 'step', key: 'transcribe', status: 'running' })
    expect((await jobRow(job.id)).status).toBe('running')
  })
})

describe('GitHub Actions worker', () => {
  it('says why a run could not start, and clears it once one starts', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'token'
    process.env.GITHUB_REPO = 'me/cutroom'
    process.env.WORKER_SECRET = 'secret'
    try {
      expect(jobs.workerMode()).toBe('github')
      expect(jobs.workerConfigured()).toBe(true)
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        Response.json({ message: 'Bad credentials' }, { status: 401 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const projectId = await newProject()
      const job = await jobs.startJob(projectId, 'publish')
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.github.com/repos/me/cutroom/actions/workflows/worker.yml/dispatches')
      expect(JSON.parse(init?.body as string)).toEqual({ ref: 'main', inputs: { job_id: job.id } })
      expect((await jobRow(job.id)).progressDetail).toMatch(/Could not start.*HTTP 401: Bad credentials/)

      // The next check-in after the patience window dispatches again, and this time it works.
      fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
      const database = await db()
      await database
        .update(schema.jobs)
        .set({ kickedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(schema.jobs.id, job.id))
      await jobs.watchJob(await jobRow(job.id))
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect((await jobRow(job.id)).progressDetail).toBeNull()
      // Within the patience window it does not start a second run.
      await jobs.watchJob(await jobRow(job.id))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      delete process.env.GITHUB_DISPATCH_TOKEN
      delete process.env.GITHUB_REPO
      delete process.env.WORKER_SECRET
    }
  })

  it('clears the waiting message when the job is approved', async () => {
    const projectId = await newProject()
    const job = await jobs.startJob(projectId, 'publish')
    await jobs.claimJob(job.id, 'w')
    await jobs.applyEvent(job.id, { type: 'waiting', key: 'approve', detail: 'Check it, then approve.' }, 'w')
    expect((await jobRow(job.id)).progressDetail).toBe('Check it, then approve.')
    await projects.updateProject(projectId, {
      post: { ...(await projects.getProjectRow(projectId)).post, title: 'T' },
    })
    await jobs.approveJob(job.id)
    expect((await jobRow(job.id)).progressDetail).toBeNull()
  })
})

describe('jobs that would fight over a project', () => {
  it('refuses a voice-over while publishing, and the other way round', async () => {
    const projectId = await newProject()
    const publish = await jobs.startJob(projectId, 'publish')
    await expect(jobs.startJob(projectId, 'voice')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Finish & schedule'),
    })
    await jobs.cancelJob(publish.id)
    const voice = await jobs.startJob(projectId, 'voice')
    await expect(jobs.startJob(projectId, 'retime')).rejects.toMatchObject({ status: 400 })
    // Starting the same job twice returns the running one.
    expect((await jobs.startJob(projectId, 'voice')).id).toBe(voice.id)
  })
})

describe('AI voice-over results', () => {
  it('replaces the voice-over file and clears the old timing until the new one arrives', async () => {
    const projectId = await newProject()
    const old = await putFile(`projects/${projectId}/voiceover/old.mp3`, Buffer.from('old'), 'audio/mpeg')
    const fresh = await putFile(`projects/${projectId}/voiceover/new.mp3`, Buffer.from('new'), 'audio/mpeg')
    await projects.updateProject(projectId, {
      voiceoverUrl: old.url,
      voiceoverDuration: 10,
      transcript: { duration: 10, segments: [], words: [] },
    })
    const job = await jobs.startJob(projectId, 'voice')
    await jobs.claimJob(job.id, 'w')
    await jobs.applyEvent(
      job.id,
      {
        type: 'result',
        patch: { voiceover: { url: fresh.url, key: fresh.key, name: 'AI.mp3', duration: 12.5 } },
      },
      'w',
    )
    let project = await projects.getProjectRow(projectId)
    expect(project.voiceoverUrl).toBe(fresh.url)
    expect(project.voiceoverDuration).toBe(12.5)
    expect(project.transcript).toBeNull()
    expect(stored(old.key)).toBe(false)
    expect(stored(fresh.key)).toBe(true)

    const transcript = {
      duration: 12.5,
      segments: [{ start: 0, end: 1, text: 'Hi.' }],
      words: [{ text: 'Hi.', start: 0, end: 1 }],
    }
    await jobs.applyEvent(job.id, { type: 'result', patch: { transcript } }, 'w')
    await jobs.applyEvent(job.id, { type: 'done' }, 'w')
    project = await projects.getProjectRow(projectId)
    expect(project.transcript).toEqual(transcript)
    expect((await jobRow(job.id)).status).toBe('done')
  })
})

describe('YouTube channels', () => {
  it('carries over the old connection, adds more channels and keeps one default', async () => {
    const database = await db()
    await database.insert(schema.channels).values({
      id: 'migrated-youtube',
      youtubeId: null,
      title: 'Ocean Facts',
      refreshToken: 'old-token',
      isDefault: true,
    })
    // Reconnecting the carried-over channel fills in its YouTube id instead of adding a second row.
    const ocean = await connections.saveChannel({
      youtubeId: 'UC-ocean',
      title: 'Ocean Facts',
      email: 'a@b.c',
      refreshToken: 'new-token',
      scope: 'x',
    })
    expect(ocean.id).toBe('migrated-youtube')
    expect(ocean.refreshToken).toBe('new-token')

    const space = await connections.saveChannel({
      youtubeId: 'UC-space',
      title: 'Space Facts',
      email: null,
      refreshToken: 't2',
      scope: 'x',
    })
    expect(space.isDefault).toBe(false)
    expect((await connections.channelFor(null, null))?.id).toBe('migrated-youtube')
    expect((await connections.channelFor('gone', null))?.id).toBe('migrated-youtube')
    expect((await connections.channelFor(space.id, 'UC-space'))?.id).toBe(space.id)

    await connections.setDefaultChannel(space.id)
    expect((await connections.defaultChannel())?.id).toBe(space.id)
    const summary = await connections.connectionSummaries()
    expect(summary.channels.filter((c) => c.isDefault).map((c) => c.id)).toEqual([space.id])

    // Removing the default makes the remaining channel the default.
    await connections.deleteChannel(space.id)
    expect((await connections.defaultChannel())?.id).toBe('migrated-youtube')
    expect((await connections.listChannels()).filter((c) => c.isDefault)).toHaveLength(1)
  })

  it('learns the best titles per channel', async () => {
    const database = await db()
    const a = await newProject()
    const b = await newProject()
    const stats = (views: number) => ({
      views,
      likes: 0,
      comments: 0,
      watchMinutes: null,
      averageViewSeconds: null,
      averageViewPercent: null,
      subscribersGained: null,
      publishedAt: null,
      fetchedAt: new Date().toISOString(),
    })
    await database
      .update(schema.projects)
      .set({ youtubeVideoId: 'v1', stats: stats(500), title: 'Smaller hit' })
      .where(eq(schema.projects.id, a))
    await database
      .update(schema.projects)
      .set({ youtubeVideoId: 'v2', stats: stats(9000), title: 'Big hit', channelId: 'migrated-youtube' })
      .where(eq(schema.projects.id, b))
    const top = await analytics.topTitles(null, null)
    expect(top.map((t) => t.title)).toEqual(['Big hit', 'Smaller hit'])
  })

  it('never posts a video to another channel while its own is disconnected', async () => {
    const other = await connections.saveChannel({
      youtubeId: 'UC-other',
      title: 'Other Channel',
      email: null,
      refreshToken: 't3',
      scope: 'x',
    })
    const projectId = await newProject()
    const database = await db()
    await database
      .update(schema.projects)
      .set({ channelId: other.id, channelYoutubeId: 'UC-other' })
      .where(eq(schema.projects.id, projectId))

    await connections.deleteChannel(other.id)
    let project = await projects.getProjectRow(projectId)
    expect(project.channelId).toBeNull()
    expect(project.channelYoutubeId).toBe('UC-other')
    // Not the default channel: nothing until it is back.
    expect(await connections.channelFor(project.channelId, project.channelYoutubeId)).toBeNull()

    // Connecting it again (a new row) is found through its YouTube id.
    const again = await connections.saveChannel({
      youtubeId: 'UC-other',
      title: 'Other Channel',
      email: null,
      refreshToken: 't4',
      scope: 'x',
    })
    project = await projects.getProjectRow(projectId)
    expect((await connections.channelFor(project.channelId, project.channelYoutubeId))?.id).toBe(again.id)
    await connections.deleteChannel(again.id)
  })
})

describe('series', () => {
  it('copies the setup and files, starts episodes from it, and survives its source', async () => {
    const source = await newProject('portrait')
    const music = await putFile(`projects/${source}/music/song.mp3`, Buffer.from('m'), 'audio/mpeg')
    const avatar = await putFile(`projects/${source}/characters/milo.png`, Buffer.from('p'), 'image/png')
    await projects.updateProject(source, {
      artStyle: 'Watercolor',
      tone: 'Warm',
      musicUrl: music.url,
      musicName: 'song.mp3',
      textOverlays: false,
      voice: { provider: 'gemini', voice: 'Puck', style: 'playful' },
    })
    const database = await db()
    await database.insert(schema.characters).values({
      id: crypto.randomUUID(),
      projectId: source,
      name: 'Milo',
      description: 'Yellow hoodie',
      images: [{ url: avatar.url, key: avatar.key }],
    })

    const row = await series.createSeriesFromProject(source, 'Ocean Oddities', 'One creature per episode')
    expect((await projects.getProjectRow(source)).seriesId).toBe(row.id)
    const t = row.template
    expect(t).toMatchObject({ format: 'portrait', artStyle: 'Watercolor', tone: 'Warm', textOverlays: false })
    expect(t.voice).toEqual({ provider: 'gemini', voice: 'Puck', style: 'playful' })
    expect(t.musicUrl).not.toBe(music.url)
    expect(stored(keyOfUrl(t.musicUrl as string))).toBe(true)
    expect(t.characters[0].images[0].url).not.toBe(avatar.url)

    const episode = await projects.createProject({
      title: '',
      topic: 'Blobfish',
      format: 'landscape',
      series: { id: row.id, template: t },
    })
    const full = await projects.getProjectFull(episode)
    expect(full.project).toMatchObject({
      format: 'portrait',
      artStyle: 'Watercolor',
      seriesId: row.id,
      topic: 'Blobfish',
    })
    expect(full.project.voice?.voice).toBe('Puck')
    expect(full.project.musicUrl).toMatch(new RegExp(`projects/${episode}/music/`))
    expect(full.characters[0].name).toBe('Milo')
    expect(full.characters[0].images[0].url).toMatch(new RegExp(`projects/${episode}/characters/`))

    // Deleting the source project does not touch the series' copies; deleting the series frees them.
    await projects.deleteProject(source)
    expect(stored(keyOfUrl(t.musicUrl as string))).toBe(true)
    await series.deleteSeries(row.id)
    expect(stored(keyOfUrl(t.musicUrl as string))).toBe(false)
    expect(stored(keyOfUrl(full.project.musicUrl as string))).toBe(true)
    expect((await projects.getProjectRow(episode)).seriesId).toBeNull()
  })
})

describe('making a Short', () => {
  async function longVideo() {
    const id = await newProject('landscape')
    const voice = await putFile(`projects/${id}/voiceover/vo.mp3`, Buffer.from('v'), 'audio/mpeg')
    const image = await putFile(`projects/${id}/scenes/s.png`, Buffer.from('i'), 'image/png')
    await projects.updateProject(id, {
      voiceoverUrl: voice.url,
      voiceoverDuration: 100,
      transcript: {
        duration: 100,
        segments: [{ start: 20, end: 30, text: 'Middle part.' }],
        words: [
          { text: 'Middle', start: 21, end: 21.5 },
          { text: 'part.', start: 29, end: 29.6 },
          { text: 'Later', start: 45, end: 45.5 },
        ],
      },
    })
    await projects.replaceScenes(
      id,
      [0, 20, 40, 60, 80].map((start) => ({
        start,
        end: start + 20,
        narration: `Scene at ${start}.`,
        transition: 'crossfade',
      })),
    )
    const scenes = await projects.getScenes(id)
    const database = await db()
    await database.update(schema.scenes).set({ imageUrl: image.url, imageWidth: 1920, imageHeight: 1080 })
    return { id, scenes, image }
  }

  it('makes a 9:16 project from a run of scenes with its own files and shifted captions', async () => {
    const { id, image } = await longVideo()
    const newId = crypto.randomUUID()
    const cut = await putFile(`projects/${newId}/voiceover/short.wav`, Buffer.from('w'), 'audio/wav')
    const shortId = await shorts.createShort({
      sourceId: id,
      newId,
      from: 1,
      to: 2,
      fit: 'contain',
      title: 'The middle',
      voiceover: { url: cut.url, name: 'short.wav', duration: 40 },
    })
    expect(shortId).toBe(newId)
    const full = await projects.getProjectFull(newId)
    expect(full.project).toMatchObject({
      format: 'portrait',
      title: 'The middle',
      sourceProjectId: id,
      voiceoverUrl: cut.url,
      voiceoverDuration: 40,
    })
    expect(full.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 20],
      [20, 40],
    ])
    expect(full.scenes.every((s) => s.fit === 'contain')).toBe(true)
    expect(full.scenes[0].transition).toBe('cut')
    expect(full.scenes[1].transition).toBe('crossfade')
    expect(full.scenes[0].imageUrl).not.toBe(image.url)
    expect(full.scenes[0].imageUrl).toMatch(new RegExp(`projects/${newId}/scenes/`))
    expect(full.project.transcript?.words.map((w) => [w.text, w.start])).toEqual([
      ['Middle', 1],
      ['part.', 9],
      ['Later', 25],
    ])
  })

  it('refuses a voice-over outside the new project, and parts longer than 3 minutes', async () => {
    const { id } = await longVideo()
    const newId = crypto.randomUUID()
    const elsewhere = await putFile(`projects/${id}/voiceover/x.wav`, Buffer.from('w'), 'audio/wav')
    await expect(
      shorts.createShort({
        sourceId: id,
        newId,
        from: 0,
        to: 1,
        fit: 'cover',
        title: '',
        voiceover: { url: elsewhere.url, name: 'x.wav', duration: 40 },
      }),
    ).rejects.toMatchObject({ status: 400 })
    // Neither a path that climbs back out of the new folder, nor a file on another host.
    for (const url of [
      `/api/files/projects/${newId}/voiceover/../../${id}/voiceover/x.wav`,
      `https://evil.example/projects/${newId}/voiceover/x.wav`,
    ]) {
      await expect(
        shorts.createShort({
          sourceId: id,
          newId,
          from: 0,
          to: 1,
          fit: 'cover',
          title: '',
          voiceover: { url, name: 'x.wav', duration: 40 },
        }),
      ).rejects.toMatchObject({ status: 400 })
    }
    expect(stored(keyOfUrl(elsewhere.url))).toBe(true)
    await projects.updateProject(id, { voiceoverDuration: 400 })
    const database = await db()
    const scenes = await projects.getScenes(id)
    await database
      .update(schema.scenes)
      .set({ start: 300, end: 400 })
      .where(eq(schema.scenes.id, scenes[4].id))
    await expect(
      shorts.createShort({ sourceId: id, newId, from: 0, to: 4, fit: 'cover', title: '', voiceover: null }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses an archived video, and fails cleanly when a picture is gone', async () => {
    const { id, image } = await longVideo()
    const database = await db()
    await database.update(schema.projects).set({ archived: true }).where(eq(schema.projects.id, id))
    const newId = crypto.randomUUID()
    const voiceover = await putFile(`projects/${newId}/voiceover/vo.wav`, Buffer.from('w'), 'audio/wav')
    const input = {
      sourceId: id,
      newId,
      from: 1,
      to: 2,
      fit: 'cover' as const,
      title: '',
      voiceover: { url: voiceover.url, name: 'vo.wav', duration: 40 },
    }
    await expect(shorts.createShort(input)).rejects.toThrow(/archived/)
    await expect(series.createSeriesFromProject(id, 'From archive', '')).rejects.toThrow(/archived/)

    // Not archived, but its picture was deleted: no Short with missing pictures is left behind.
    await database.update(schema.projects).set({ archived: false }).where(eq(schema.projects.id, id))
    rmSync(localPath(keyOfUrl(image.url)))
    await expect(shorts.createShort(input)).rejects.toThrow(/picture of scene 2/)
    const [left] = await database.select().from(schema.projects).where(eq(schema.projects.id, newId))
    expect(left).toBeUndefined()
  })
})

describe('notifications', () => {
  it('sends to Discord, Telegram and email with what happened', async () => {
    process.env.NOTIFY_DISCORD_WEBHOOK_URL = 'https://discord.test/webhook'
    process.env.NOTIFY_TELEGRAM_BOT_TOKEN = 'bot-token'
    process.env.NOTIFY_TELEGRAM_CHAT_ID = '42'
    process.env.RESEND_API_KEY = 're-key'
    process.env.NOTIFY_EMAIL_TO = 'me@example.com, you@example.com'
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const results = await notify.sendNotice({
        kind: 'test',
        title: 'Ready for your approval: Octopus',
        body: 'Title: Why octopuses dream',
        url: 'https://app.test/projects/1',
      })
      expect(results.map((r) => [r.channel, r.ok])).toEqual([
        ['Discord', true],
        ['Telegram', true],
        ['Email', true],
      ])
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url,
        body: JSON.parse(init?.body as string),
      }))
      expect(calls[0]).toMatchObject({ url: 'https://discord.test/webhook' })
      expect(calls[0].body.content).toContain('Ready for your approval: Octopus')
      expect(calls[1]).toMatchObject({
        url: 'https://api.telegram.org/botbot-token/sendMessage',
        body: { chat_id: '42' },
      })
      expect(calls[2].body).toMatchObject({
        to: ['me@example.com', 'you@example.com'],
        subject: 'Ready for your approval: Octopus',
      })
    } finally {
      for (const name of [
        'NOTIFY_DISCORD_WEBHOOK_URL',
        'NOTIFY_TELEGRAM_BOT_TOKEN',
        'NOTIFY_TELEGRAM_CHAT_ID',
        'RESEND_API_KEY',
        'NOTIFY_EMAIL_TO',
      ])
        delete process.env[name]
    }
  })

  it('tells you when a video waits for approval, once', async () => {
    process.env.NOTIFY_DISCORD_WEBHOOK_URL = 'https://discord.test/webhook'
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const projectId = await newProject()
      const job = await jobs.startJob(projectId, 'publish')
      await jobs.claimJob(job.id, 'w')
      await jobs.applyEvent(job.id, { type: 'waiting', key: 'approve' }, 'w')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).content).toContain(
        'Ready for your approval',
      )
      // A repeated report of the same state does not send again.
      await jobs.applyEvent(job.id, { type: 'waiting', key: 'approve' })
      await new Promise((r) => setTimeout(r, 50))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.NOTIFY_DISCORD_WEBHOOK_URL
    }
  })
})

describe('one active job per project', () => {
  it('returns the same job to two requests racing to start it, and refuses a retry beside a newer one', async () => {
    const projectId = await newProject()
    const [a, b] = await Promise.all([jobs.startJob(projectId, 'retime'), jobs.startJob(projectId, 'retime')])
    expect(a.id).toBe(b.id)

    const database = await db()
    await expect(
      database
        .insert(schema.jobs)
        .values({ id: 'second', projectId, type: 'voice', status: 'queued', steps: [], result: {} }),
    ).rejects.toThrow()

    await database.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, a.id))
    const newer = await jobs.startJob(projectId, 'retime')
    expect(newer.id).not.toBe(a.id)
    await expect(jobs.retryJob(a.id)).rejects.toMatchObject({ status: 400 })
  })
})

describe('disconnected channels', () => {
  it('holds an approved upload, and tells the worker to fail instead of skipping YouTube', async () => {
    const channel = await connections.saveChannel({
      youtubeId: 'UC-held',
      title: 'Held',
      email: null,
      refreshToken: 't',
      scope: 'x',
    })
    const projectId = await newProject()
    const database = await db()
    const project = await projects.getProjectRow(projectId)
    await database
      .update(schema.projects)
      .set({
        channelId: channel.id,
        channelYoutubeId: 'UC-held',
        post: { ...project.post, title: 'A title' },
      })
      .where(eq(schema.projects.id, projectId))
    const job = await jobs.startJob(projectId, 'publish')
    await jobs.claimJob(job.id, 'worker-a')
    await jobs.applyEvent(job.id, { type: 'waiting', key: 'approve' }, 'worker-a')

    await connections.deleteChannel(channel.id)
    await expect(jobs.approveJob(job.id)).rejects.toMatchObject({ status: 400 })
    const payload = await jobs.buildPayload(job.id, new Request('http://localhost/'))
    expect(payload.google.youtubeRefreshToken).toBeNull()
    expect(payload.google.youtubeChannelMissing).toBe(true)
  })

  it('remembers channels from before multi-channel support', async () => {
    const database = await db()
    await database.insert(schema.channels).values([
      { id: 'legacy-a', youtubeId: null, title: 'Legacy A', refreshToken: 't', isDefault: false },
      { id: 'legacy-b', youtubeId: null, title: 'Legacy B', refreshToken: 't', isDefault: false },
    ])
    const onA = await newProject()
    const onB = await newProject()
    await database.update(schema.projects).set({ channelId: 'legacy-a' }).where(eq(schema.projects.id, onA))
    await database.update(schema.projects).set({ channelId: 'legacy-b' }).where(eq(schema.projects.id, onB))

    // Reconnecting fills in the id on its projects too.
    await connections.saveChannel({
      youtubeId: 'UC-a',
      title: 'Legacy A',
      email: null,
      refreshToken: 't2',
      scope: 'x',
    })
    expect((await projects.getProjectRow(onA)).channelYoutubeId).toBe('UC-a')

    // Disconnected before its id was known (and YouTube can't be asked): its videos wait, never
    // falling back to the default channel.
    await connections.deleteChannel('legacy-b')
    const b = await projects.getProjectRow(onB)
    expect(b.channelYoutubeId).toBe('disconnected:legacy-b')
    expect(await connections.channelFor(b.channelId, b.channelYoutubeId)).toBeNull()
  })

  it('never leaves the channels without exactly one default', async () => {
    const before = (await connections.defaultChannel())?.id
    await connections.setDefaultChannel('no-such-channel')
    expect((await connections.defaultChannel())?.id).toBe(before)
    expect((await connections.listChannels()).filter((c) => c.isDefault)).toHaveLength(1)
  })
})

describe('daily cron and stats', () => {
  it('stays closed on a password-protected app without CRON_SECRET', async () => {
    process.env.APP_PASSWORD = 'secret'
    try {
      const response = await cron.GET(new Request('http://localhost/api/cron'))
      expect(response.status).toBe(401)
    } finally {
      delete process.env.APP_PASSWORD
    }
  })

  it('leaves videos for the next refresh when out of time, without asking YouTube', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await analytics.refreshStats({ force: true, deadlineMs: -1 })
    expect(result.updated).toBe(0)
    expect(result.notes.join(' ')).toMatch(/next refresh/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('channel niche', () => {
  const json = (body: unknown, method = 'POST') =>
    new Request('http://localhost/api', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const patchCharacter = (id: string, body: unknown) =>
    libraryItemRoute.PATCH(json(body, 'PATCH'), { params: Promise.resolve({ id }) })

  it('creates a library character directly and only accepts images from its own folder', async () => {
    const created = await (
      await libraryRoute.POST(json({ name: 'Cappy', description: 'Brown capybara' }), undefined)
    ).json()
    expect(created).toMatchObject({ name: 'Cappy', images: [] })

    const elsewhere = await putFile('projects/other/characters/x.png', Buffer.from('x'), 'image/png')
    expect((await patchCharacter(created.id, { images: [elsewhere] })).status).toBe(400)

    const own = await putFile(`library/characters/${created.id}/cappy.png`, Buffer.from('c'), 'image/png')
    const saved = await (await patchCharacter(created.id, { images: [own] })).json()
    expect(saved.images).toEqual([own])
    // Removing an image deletes its file.
    await patchCharacter(created.id, { images: [] })
    expect(stored(keyOfUrl(own.url))).toBe(false)
  })

  it('starts new videos from the niche: brief, script notes and the main character with images', async () => {
    const narrator = await (
      await libraryRoute.POST(json({ name: 'Cappy', description: 'Chubby 2D capybara' }), undefined)
    ).json()
    const image = await putFile(`library/characters/${narrator.id}/cappy.png`, Buffer.from('c'), 'image/png')
    await patchCharacter(narrator.id, { images: [image] })
    await settingsModule.saveSettings({
      ...DEFAULT_SETTINGS,
      niche: {
        description: 'Funny 2D cartoon about Cappy the capybara',
        narration: 'Cappy narrates in third person: "Capybara wants to eat."',
        audience: 'Kids and adults',
        tone: 'Funny, warm',
        artStyle: '2D cartoon, flat colors',
        targetMinutes: 6,
        pace: 8,
        characterIds: [narrator.id, 'deleted-character'],
      },
    })
    try {
      const id = await newProject('landscape')
      const project = await projects.getProjectRow(id)
      expect(project).toMatchObject({
        audience: 'Kids and adults',
        tone: 'Funny, warm',
        artStyle: '2D cartoon, flat colors',
        targetMinutes: 6,
        pace: 8,
      })
      expect(project.notes).toContain('Channel: Funny 2D cartoon about Cappy the capybara')
      expect(project.notes).toContain('Narration: Cappy narrates in third person')
      const [cast] = await projects.getCharacters(id)
      expect(cast).toMatchObject({ name: 'Cappy', description: 'Chubby 2D capybara', position: 0 })
      expect(cast.images).toHaveLength(1)
      expect(cast.images[0].key.startsWith(`projects/${id}/characters/`)).toBe(true)
      expect(stored(cast.images[0].key)).toBe(true)

      // Shorts keep their short length and quick pace, but get the same narrator and notes.
      const short = await projects.getProjectRow(await newProject('portrait'))
      expect(short).toMatchObject({ targetMinutes: 1, pace: 3, audience: 'Kids and adults' })
      expect(await projects.getCharacters(short.id)).toHaveLength(1)

      // A series episode uses its series' setup instead.
      const fromSeries = await series.createSeriesFromProject(id, 'Cappy specials', '')
      const episode = await projects.createProject({
        title: 'Episode',
        topic: '',
        format: 'landscape',
        series: { id: fromSeries.id, template: fromSeries.template },
      })
      expect((await projects.getProjectRow(episode)).notes).toBe(project.notes)
      expect(await projects.getCharacters(episode)).toHaveLength(1)
    } finally {
      await settingsModule.saveSettings(DEFAULT_SETTINGS)
    }
  })

  it('fills the niche in for settings saved before it existed', async () => {
    const { niche: _dropped, ...old } = DEFAULT_SETTINGS
    await settingsModule.saveSettings(old as typeof DEFAULT_SETTINGS)
    expect((await settingsModule.getSettings()).niche).toEqual(DEFAULT_SETTINGS.niche)
    await settingsModule.saveSettings(DEFAULT_SETTINGS)
  })
})

describe('files sent by the browser', () => {
  const patch = (body: unknown) =>
    new Request('http://localhost/api', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it("only accepts the project's own files, so replacing one never deletes another project's", async () => {
    const id = await newProject()
    const other = await newProject()
    const theirs = await putFile(`projects/${other}/music/song.mp3`, Buffer.from('m'), 'audio/mpeg')
    const mine = await putFile(`projects/${id}/music/song.mp3`, Buffer.from('m'), 'audio/mpeg')
    expect((await projectRoute.PATCH(patch({ musicUrl: theirs.url }), ctx(id))).status).toBe(400)
    // The thumbnail folder is not the music folder either.
    const thumb = await putFile(`projects/${id}/thumbnail/t.png`, Buffer.from('t'), 'image/png')
    expect((await projectRoute.PATCH(patch({ musicUrl: thumb.url }), ctx(id))).status).toBe(400)
    expect((await projectRoute.PATCH(patch({ musicUrl: mine.url }), ctx(id))).status).toBe(200)
    expect((await projectRoute.PATCH(patch({ musicUrl: null }), ctx(id))).status).toBe(200)
    expect(stored(keyOfUrl(theirs.url))).toBe(true)

    await projects.replaceScenes(id, [{ start: 0, end: 5, narration: 'Capybara wants to eat.' }])
    const [scene] = await projects.getScenes(id)
    const theirImage = await putFile(`projects/${other}/scenes/x.png`, Buffer.from('i'), 'image/png')
    expect((await sceneRoute.PATCH(patch({ imageUrl: theirImage.url }), ctx(scene.id))).status).toBe(400)
    const myImage = await putFile(`projects/${id}/scenes/x.png`, Buffer.from('i'), 'image/png')
    expect((await sceneRoute.PATCH(patch({ imageUrl: myImage.url }), ctx(scene.id))).status).toBe(200)

    const database = await db()
    const characterId = crypto.randomUUID()
    await database
      .insert(schema.characters)
      .values({ id: characterId, projectId: id, name: 'Cappy', images: [] })
    expect((await characterRoute.PATCH(patch({ images: [theirImage] }), ctx(characterId))).status).toBe(400)
    const avatar = await putFile(`projects/${id}/characters/cappy.png`, Buffer.from('c'), 'image/png')
    expect((await characterRoute.PATCH(patch({ images: [avatar] }), ctx(characterId))).status).toBe(200)
    expect(stored(keyOfUrl(theirImage.url))).toBe(true)
  })
})

describe('the free worker', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it('moves a video that missed its posting time to the next free slot, and reserves it', async () => {
    process.env.WORKER_SECRET = 'test-secret'
    try {
      const id = await newProject()
      const database = await db()
      await database
        .update(schema.projects)
        .set({ scheduledAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.projects.id, id))
      const job = await jobs.startJob(id, 'publish')
      await jobs.claimJob(job.id, 'worker-a')
      const ask = (headers: Record<string, string>) =>
        rescheduleRoute.POST(new Request('http://localhost/api', { method: 'POST', headers }), ctx(job.id))

      expect((await ask({})).status).toBe(401)
      const auth = { authorization: 'Bearer test-secret' }
      expect((await ask({ ...auth, 'x-cutroom-runner': 'worker-b' })).status).toBe(409)
      const { at } = await (await ask({ ...auth, 'x-cutroom-runner': 'worker-a' })).json()
      expect(new Date(at).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)
      expect((await projects.getProjectRow(id)).scheduledAt?.toISOString()).toBe(at)
    } finally {
      delete process.env.WORKER_SECRET
    }
  })

  it('deletes AI voice-over parts an earlier voice job kept, once a new one starts', async () => {
    const id = await newProject()
    const part = await putFile(`projects/${id}/voiceover/parts/part-001.mp3`, Buffer.from('p'), 'audio/mpeg')
    const earlier = await jobs.startJob(id, 'voice')
    const database = await db()
    await database
      .update(schema.jobs)
      .set({
        status: 'failed',
        result: {
          voiceParts: [
            { text: 'Capybara wants to eat.', url: part.url, key: part.key, duration: 1, words: [] },
          ],
        },
      })
      .where(eq(schema.jobs.id, earlier.id))
    await jobs.startJob(id, 'voice')
    expect(stored(part.key)).toBe(false)
    expect((await jobRow(earlier.id)).result.voiceParts).toBeUndefined()
  })
})
