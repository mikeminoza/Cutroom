'use client'

import { CalendarClock, ChartColumn, Clapperboard, Library, Lightbulb, LogOut, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStatus } from '@/lib/hooks'
import type { Tone } from '@/lib/stage'
import { ThemeSwitch } from './theme-switch'
import { Dot } from './ui'

const NAV = [
  { href: '/', label: 'Projects', icon: Clapperboard },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/schedule', label: 'Schedule', icon: CalendarClock },
  { href: '/performance', label: 'Performance', short: 'Stats', icon: ChartColumn },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/settings', label: 'Settings', icon: Settings2 },
]

export function Wordmark({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden className="relative grid size-7 shrink-0 place-items-center rounded-[6px] bg-film">
        <span className="absolute inset-x-1 top-[3px] h-[3px] sprockets opacity-80" />
        <span className="absolute inset-x-1 bottom-[3px] h-[3px] sprockets opacity-80" />
        <span className="size-3 rounded-[2px] bg-kodak" />
      </span>
      <span className={cn('display text-[19px]', labelClassName)}>Cutroom</span>
    </span>
  )
}

async function signOut() {
  await api.post('/api/auth/logout')
  window.location.href = '/login'
}

/**
 * Phones: a slim header and a tab bar at the bottom, in thumb reach.
 * Tablets: a narrow rail of icons with short labels.
 * Desktop: the full sidebar, with service status.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: status } = useStatus()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/projects') : pathname.startsWith(href)

  const services: { label: string; tone: Tone; title: string }[] = status
    ? [
        {
          label: status.channels.length > 1 ? `YouTube (${status.channels.length})` : 'YouTube',
          tone: status.youtube.connected ? 'ok' : 'idle',
          title: status.youtube.connected ? status.channels.map((c) => c.title).join(', ') : 'Not connected',
        },
        {
          label: 'Drive',
          tone: status.drive.connected ? 'ok' : 'idle',
          title: status.drive.connected ? `Saving to ${status.drive.email}` : 'Not connected',
        },
        {
          label: status.worker.mode === 'github' ? 'Worker (GitHub)' : 'Worker',
          tone: !status.worker.configured
            ? 'idle'
            : status.worker.reachable
              ? status.worker.busy
                ? 'run'
                : 'ok'
              : 'bad',
          title: !status.worker.configured
            ? 'Not set up'
            : status.worker.mode === 'github'
              ? 'GitHub Actions runs each job'
              : status.worker.reachable
                ? status.worker.busy
                  ? 'Working on a job'
                  : 'Online'
                : 'Asleep or offline — it wakes up when a job starts',
        },
      ]
    : []

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[84px_1fr] lg:grid-cols-[224px_1fr]">
      {/* Phone header */}
      <header className="flex items-center gap-3 border-b border-line px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2.5 md:hidden">
        <Link href="/" className="mr-auto rounded-md">
          <Wordmark />
        </Link>
        <ThemeSwitch />
        {status?.auth && (
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        )}
      </header>

      {/* Tablet rail and desktop sidebar */}
      <aside className="sticky top-0 z-30 hidden h-dvh flex-col border-r border-line px-2 py-5 md:flex lg:px-4">
        <Link href="/" className="mb-7 self-center rounded-md lg:self-stretch lg:px-2">
          <Wordmark labelClassName="hidden lg:inline" />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ href, label, short, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              title={label}
              className={cn(
                'flex flex-col items-center gap-1 rounded-[var(--radius-control)] px-1 py-2 text-[11px] transition-colors lg:flex-row lg:gap-2.5 lg:px-2.5 lg:text-[14px]',
                isActive(href)
                  ? 'bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]'
                  : 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink',
              )}
            >
              <Icon className="size-[18px] lg:size-4" aria-hidden />
              <span className="lg:hidden">{short ?? label}</span>
              <span className="hidden lg:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-3 lg:items-stretch">
          <Link
            href="/settings"
            className="hidden rounded-[var(--radius-control)] px-2.5 py-2 hover:bg-ink/[0.05] lg:block"
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
          <div className="flex flex-col items-center gap-2 lg:items-stretch lg:gap-1 lg:border-t lg:border-line lg:pt-3">
            <ThemeSwitch vertical className="lg:hidden" />
            <div className="hidden items-center justify-between px-2.5 lg:flex">
              <span className="text-[12.5px] text-ink-3">Theme</span>
              <ThemeSwitch />
            </div>
            {status?.auth && (
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] whitespace-nowrap text-ink-3 hover:bg-ink/[0.05] hover:text-ink lg:px-2.5 lg:py-2"
              >
                <LogOut className="size-3.5 shrink-0" aria-hidden />
                <span className="sr-only lg:not-sr-only">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 pb-[calc(var(--tabbar)+env(safe-area-inset-bottom))] md:pb-0">{children}</main>

      {/* Phone tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map(({ href, label, short, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex h-[var(--tabbar)] flex-col items-center justify-center gap-1 text-[10.5px] transition-colors',
                active ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              {active && (
                <span aria-hidden className="absolute inset-x-3 top-0 h-[2px] rounded-b-full bg-kodak" />
              )}
              <Icon className="size-5" aria-hidden />
              {short ?? label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
