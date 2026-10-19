import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authEnabled, createSessionToken, SESSION_COOKIE, safeEqual, sessionMaxAge } from '@/server/auth'
import { readJson, route } from '@/server/http'

export const POST = route(
  async (request) => {
    const { password } = await readJson(request, z.object({ password: z.string().max(500) }))
    if (!authEnabled()) return { ok: true }
    if (!safeEqual(password, process.env.APP_PASSWORD ?? '')) {
      return NextResponse.json({ error: 'That password is not right.' }, { status: 401 })
    }
    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: sessionMaxAge,
    })
    return response
  },
  { public: true },
)
