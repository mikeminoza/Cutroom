'use client'

import { CalendarClock, Clapperboard, LogOut, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStatus } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { Dot } from './ui'

const NAV = [
  { href: '/', label: 'Projects', icon: Clapperboard },
  { href: '/schedule', label: 'Schedule', icon: CalendarClock },
  { href: '/settings', label: 'Settings', icon: Settings2 },
]

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden className="relative grid size-7 place-items-center rounded-[6px] bg-film">
        <span className="absolute inset-x-1 top-[3px] h-[3px] sprockets opacity-80" />
        <span className="absolute inset-x-1 bottom-[3px] h-[3px] sprockets opacity-80" />
        <span className="size-3 rounded-[2px] bg-kodak" />
      </span>
      <span className="display text-[19px]">Cutroom</span>
    </span>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: status } = useStatus()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/projects') : pathname.startsWith(href)

  const services: { label: string; tone: Tone; title: string }[] = status
    ? [
        {
          label: 'YouTube',
          tone: status.youtube.connected ? 'ok' : 'idle',
          title: status.youtube.connected ? `Posting to ${status.youtube.label}` : 'Not connected',
        },
        {
          label: 'Drive',
          tone: status.drive.connected ? 'ok' : 'idle',
          title: status.drive.connected ? `Saving to ${status.drive.email}` : 'Not connected',
        },
        {
          label: 'Worker',
          tone: !status.worker.configured
            ? 'idle'
            : status.worker.reachable
              ? status.worker.busy
                ? 'run'
                : 'ok'
              : 'bad',
          title: !status.worker.configured
            ? 'Not set up'
            : status.worker.reachable
              ? status.worker.busy
                ? 'Working on a job'
                : 'Online'
              : 'Asleep or offline — it wakes up when a job starts',
        },
      ]
    : []

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur lg:h-dvh lg:flex-col lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-4 lg:py-5">
        <Link href="/" className="mr-auto rounded-md lg:mr-0 lg:mb-7 lg:px-2">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex gap-1 lg:flex-col">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[14px] transition-colors',
                isActive(href)
                  ? 'bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]'
                  : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink',
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden lg:block">
          <Link
            href="/settings"
            className="block rounded-[var(--radius-control)] px-2.5 py-2 hover:bg-ink/[0.04]"
          >
            <ul className="flex flex-col gap-1.5">
              {services.map((service) => (
                <li
                  key={service.label}
                  className="flex items-center gap-2 text-[12.5px] text-ink-2"
                  title={service.title}
                >
                  <Dot tone={service.tone} />
                  {service.label}
                  <span className="ml-auto truncate pl-2 text-ink-3">
                    {service.tone === 'ok'
                      ? 'On'
                      : service.tone === 'run'
                        ? 'Busy'
                        : service.tone === 'bad'
                          ? 'Asleep'
                          : 'Off'}
                  </span>
                </li>
              ))}
            </ul>
          </Link>
          {status?.auth && (
            <button
              type="button"
              onClick={async () => {
                await api.post('/api/auth/logout')
                window.location.href = '/login'
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-[13px] text-ink-3 hover:bg-ink/[0.04] hover:text-ink"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  )
}
