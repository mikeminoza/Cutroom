// Who may run the scheduled checks: Vercel's daily cron, or any scheduler you point at them
// (cron-job.org, GitHub Actions) with the same CRON_SECRET.
import { NextResponse } from 'next/server'
import { authEnabled, safeEqual } from './auth'

/** A response refusing the call, or null when it may run. */
export function cronDenied(request: Request): Response | null {
  const secret = process.env.CRON_SECRET
  if (!secret && authEnabled()) {
    // A password-protected app must not leave this open to anyone (it sends notifications and
    // spends YouTube quota). Vercel only signs its calls when CRON_SECRET is set.
    return NextResponse.json({ error: 'Set CRON_SECRET to enable the scheduled checks.' }, { status: 401 })
  }
  if (secret && !safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
