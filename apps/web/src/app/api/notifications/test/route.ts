import { badRequest, route } from '@/server/http'
import { notifyChannels, sendNotice } from '@/server/notify'
import { appUrl } from '@/server/settings'

/** Sends a test message to every channel set up in the environment, and says how each went. */
export const POST = route(async (request) => {
  const channels = notifyChannels()
  if (!channels.discord && !channels.telegram && !channels.email) {
    badRequest('No notification channel is set up. Add the environment variables first (see ENVIRONMENT.md).')
  }
  const results = await sendNotice({
    kind: 'test',
    title: 'Cutroom test message',
    body: 'Notifications work. You will hear from Cutroom when a video needs you or goes out.',
    url: `${appUrl(request)}/settings`,
  })
  return { results }
})
