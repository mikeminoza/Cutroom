import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/server/auth'
import { route } from '@/server/http'

export const POST = route(
  async () => {
    const response = NextResponse.json({ ok: true })
    response.cookies.delete(SESSION_COOKIE)
    return response
  },
  { public: true },
)
