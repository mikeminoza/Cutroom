import { readJson, route } from '@/server/http'
import { getSettings, saveSettings } from '@/server/settings'
import { settingsSchema } from '@/server/validation'

export const GET = route(async () => getSettings())

export const PUT = route(async (request) => {
  const data = await readJson(request, settingsSchema)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: data.timezone })
  } catch {
    data.timezone = 'UTC'
  }
  return saveSettings(data)
})
