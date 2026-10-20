import { type AppSettings, DEFAULT_SETTINGS } from '@cutroom/shared/types'
import { eq } from 'drizzle-orm'
import { db, schema } from './db'

export async function getSettings(): Promise<AppSettings> {
  const database = await db()
  const [row] = await database.select().from(schema.settings).where(eq(schema.settings.id, 'app'))
  if (!row) return DEFAULT_SETTINGS
  // Settings saved by an older version lack the newer groups; fill them from the defaults.
  return {
    ...DEFAULT_SETTINGS,
    ...row.data,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...row.data.defaults },
    voice: { ...DEFAULT_SETTINGS.voice, ...row.data.voice },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...row.data.notifications },
  }
}

export async function saveSettings(data: AppSettings): Promise<AppSettings> {
  const database = await db()
  await database
    .insert(schema.settings)
    .values({ id: 'app', data })
    .onConflictDoUpdate({ target: schema.settings.id, set: { data } })
  return data
}

export function appUrl(request?: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  if (request) return new URL(request.url).origin
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}
