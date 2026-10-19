import { authUrl, type GoogleProvider, hasGoogleClient } from '@cutroom/shared/google'
import { NextResponse } from 'next/server'
import { route } from '@/server/http'
import { appUrl } from '@/server/settings'

export const GET = route(async (request) => {
  const provider = new URL(request.url).searchParams.get('provider') as GoogleProvider
  const base = appUrl(request)
  if (provider !== 'youtube' && provider !== 'drive') {
    return NextResponse.redirect(`${base}/settings?google=unknown`)
  }
  if (!hasGoogleClient()) return NextResponse.redirect(`${base}/settings?google=missing-client`)
  const state = `${provider}.${crypto.randomUUID()}`
  const response = NextResponse.redirect(authUrl(provider, `${base}/api/google/callback`, state))
  response.cookies.set('cutroom_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })
  return response
})
