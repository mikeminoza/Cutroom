// Sends visitors to the login page when APP_PASSWORD is set and they have no session.
// API routes check the session themselves (so uploads are never buffered here).
import { type NextRequest, NextResponse } from 'next/server'
import { authEnabled, SESSION_COOKIE, verifySessionToken } from '@/server/auth'

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next()
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (ok) return NextResponse.next()
  const login = new URL('/login', request.url)
  if (request.nextUrl.pathname !== '/') login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|icon.svg|favicon.ico).*)'],
}
