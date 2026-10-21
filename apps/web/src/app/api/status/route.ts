import { geminiImageModel, geminiModel, geminiTtsModel, hasGeminiKey } from '@cutroom/shared/ai'
import { hasElevenLabsKey } from '@cutroom/shared/elevenlabs'
import { storageDriver } from '@cutroom/shared/storage'
import type { StatusDTO } from '@/lib/dto'
import { authEnabled } from '@/server/auth'
import { connectionSummaries, hasGoogleClient } from '@/server/connections'
import { route } from '@/server/http'
import { pingWorker, workerConfigured, workerMode, workerUrl } from '@/server/jobs'
import { notifyChannels } from '@/server/notify'

export const GET = route(async (): Promise<StatusDTO> => {
  const [connections, worker] = await Promise.all([connectionSummaries(), pingWorker()])
  const mode = workerMode()
  return {
    gemini: {
      configured: hasGeminiKey(),
      model: geminiModel(),
      imageModel: geminiImageModel(),
      ttsModel: geminiTtsModel(),
    },
    elevenlabs: { configured: hasElevenLabsKey() },
    google: { configured: hasGoogleClient() },
    youtube: connections.youtube,
    channels: connections.channels,
    drive: connections.drive,
    worker: {
      mode,
      configured: workerConfigured(),
      reachable: worker.reachable,
      url: mode === 'github' ? `GitHub Actions (${process.env.GITHUB_REPO})` : workerUrl(),
      busy: worker.busy,
    },
    notifications: notifyChannels(),
    storage: storageDriver(),
    blobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    database: process.env.DATABASE_URL ? 'neon' : 'local',
    auth: authEnabled(),
    // A password-protected app refuses the cron without CRON_SECRET (see /api/cron).
    daily: !process.env.VERCEL ? 'local' : process.env.CRON_SECRET || !authEnabled() ? 'on' : 'needs-secret',
  }
})
