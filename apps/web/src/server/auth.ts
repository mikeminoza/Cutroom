// Single-user login. When APP_PASSWORD is not set (local development) the app is open.
import { jwtVerify, SignJWT } from 'jose'

export const SESSION_COOKIE = 'cutroom_session'
const MAX_AGE_DAYS = 30

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD)
}

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD || 'local-development'
  return new TextEncoder().encode(`cutroom:${secret}`)
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_DAYS}d`)
    .sign(key())
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  try {
    await jwtVerify(token, key())
    return true
  } catch {
    return false
  }
}

export const sessionMaxAge = MAX_AGE_DAYS * 24 * 60 * 60

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export async function isAuthorized(request: Request): Promise<boolean> {
  if (!authEnabled()) return true
  return verifySessionToken(cookieValue(request, SESSION_COOKIE))
}

/** Constant-time comparison for the password and worker secret. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

export function isWorker(request: Request): boolean {
  const secret = process.env.WORKER_SECRET
  if (!secret) return false
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)
}
