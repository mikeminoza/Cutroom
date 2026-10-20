// Messages to your phone when a video needs you or something happened: Discord, Telegram and/or
// email (Resend). Channels are set up with environment variables; which events send a message
// is chosen in Settings. Sending never blocks or breaks the job that triggered it.
import type { NotificationPrefs } from '@cutroom/shared/types'
import { after } from 'next/server'
import { getSettings } from './settings'

export type NotifyKind = keyof NotificationPrefs | 'stalled' | 'test'

export interface Notice {
  kind: NotifyKind
  title: string
  body: string
  /** Absolute link back into the app. */
  url?: string
}

export interface NotifyChannels {
  discord: boolean
  telegram: boolean
  email: boolean
}

export function notifyChannels(): NotifyChannels {
  return {
    discord: Boolean(process.env.NOTIFY_DISCORD_WEBHOOK_URL),
    telegram: Boolean(process.env.NOTIFY_TELEGRAM_BOT_TOKEN && process.env.NOTIFY_TELEGRAM_CHAT_ID),
    email: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_TO),
  }
}

const TIMEOUT = 8000

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

function plainText(notice: Notice): string {
  return [notice.title, notice.body, notice.url].filter(Boolean).join('\n')
}

/** Sends to every configured channel. Returns one line per channel saying how it went. */
export async function sendNotice(
  notice: Notice,
): Promise<{ channel: string; ok: boolean; error?: string }[]> {
  const sends: { channel: string; run: () => Promise<void> }[] = []
  const discord = process.env.NOTIFY_DISCORD_WEBHOOK_URL
  if (discord) {
    sends.push({
      channel: 'Discord',
      // Discord caps message content at 2000 characters.
      run: () =>
        post(discord, { content: plainText(notice).slice(0, 1900), allowed_mentions: { parse: [] } }),
    })
  }
  const token = process.env.NOTIFY_TELEGRAM_BOT_TOKEN
  const chat = process.env.NOTIFY_TELEGRAM_CHAT_ID
  if (token && chat) {
    sends.push({
      channel: 'Telegram',
      run: () =>
        post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chat,
          text: plainText(notice).slice(0, 4000),
          disable_web_page_preview: true,
        }),
    })
  }
  const resend = process.env.RESEND_API_KEY
  const to = process.env.NOTIFY_EMAIL_TO
  if (resend && to) {
    sends.push({
      channel: 'Email',
      run: () =>
        post(
          'https://api.resend.com/emails',
          {
            from: process.env.NOTIFY_EMAIL_FROM || 'Cutroom <onboarding@resend.dev>',
            to: to
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean),
            subject: notice.title,
            text: [notice.body, notice.url].filter(Boolean).join('\n\n'),
          },
          { authorization: `Bearer ${resend}` },
        ),
    })
  }
  return Promise.all(
    sends.map(async ({ channel, run }) => {
      try {
        await run()
        return { channel, ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[notify] ${channel} failed: ${message}`)
        return { channel, ok: false, error: message }
      }
    }),
  )
}

/**
 * Sends after the current response is out (so a worker's progress report is never slowed down),
 * if the event is switched on in Settings. Outside a request it just sends in the background.
 */
export function notify(notice: Notice) {
  const channels = notifyChannels()
  if (!channels.discord && !channels.telegram && !channels.email) return
  const task = async () => {
    try {
      if (notice.kind !== 'stalled' && notice.kind !== 'test') {
        const prefs = (await getSettings()).notifications
        if (!prefs[notice.kind]) return
      }
      await sendNotice(notice)
    } catch (error) {
      console.warn('[notify] skipped:', error instanceof Error ? error.message : error)
    }
  }
  try {
    after(task)
  } catch {
    void task()
  }
}
