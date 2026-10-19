import { channelInfo, clientFromRefresh, exchangeCode, type GoogleProvider } from '@cutroom/shared/google'
import { NextResponse } from 'next/server'
import { saveConnection } from '@/server/connections'
import { route } from '@/server/http'
import { appUrl } from '@/server/settings'

export const GET = route(async (request) => {
  const url = new URL(request.url)
  const base = appUrl(request)
  const back = (result: string, detail?: string) => {
    const target = new URL(`${base}/settings`)
    target.searchParams.set('google', result)
    if (detail) target.searchParams.set('detail', detail.slice(0, 300))
    const response = NextResponse.redirect(target)
    response.cookies.delete('cutroom_oauth_state')
    return response
  }
  const state = url.searchParams.get('state') ?? ''
  const expected = request.headers.get('cookie')?.match(/cutroom_oauth_state=([^;]+)/)?.[1]
  if (!expected || decodeURIComponent(expected) !== state) return back('expired')
  if (url.searchParams.get('error')) return back('denied')
  const provider = state.split('.')[0] as GoogleProvider
  const code = url.searchParams.get('code')
  if (!code) return back('denied')
  try {
    const tokens = await exchangeCode(code, `${base}/api/google/callback`)
    let label: string | null = tokens.email
    if (provider === 'youtube') {
      const channel = await channelInfo(clientFromRefresh(tokens.refreshToken))
      if (!channel) return back('no-channel')
      label = channel.title
    }
    await saveConnection(provider, {
      refreshToken: tokens.refreshToken,
      email: tokens.email,
      label,
      scope: tokens.scope,
    })
    return back(`${provider}-connected`)
  } catch (error) {
    return back('failed', error instanceof Error ? error.message : String(error))
  }
})
