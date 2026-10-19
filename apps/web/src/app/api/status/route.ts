import { geminiModel, hasGeminiKey } from '@cutroom/shared/ai'
import { storageDriver } from '@cutroom/shared/storage'
import type { StatusDTO } from '@/lib/dto'
import { authEnabled } from '@/server/auth'
import { connectionSummaries, hasGoogleClient } from '@/server/connections'
import { route } from '@/server/http'
import { pingWorker, workerUrl } from '@/server/jobs'

export const GET = route(async (): Promise<StatusDTO> => {
  const [connections, worker] = await Promise.all([connectionSummaries(), pingWorker()])
  return {
    gemini: { configured: hasGeminiKey(), model: geminiModel() },
    google: { configured: hasGoogleClient() },
    youtube: connections.youtube,
    drive: connections.drive,
    worker: {
      configured: Boolean(workerUrl() && process.env.WORKER_SECRET),
      reachable: worker.reachable,
      url: workerUrl(),
      busy: worker.busy,
    },
    storage: storageDriver(),
    database: process.env.DATABASE_URL ? 'neon' : 'local',
    auth: authEnabled(),
  }
})
