'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setThemePreference, type ThemePreference, useThemePreference } from '@/lib/theme'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/** Three small buttons: match the system, light, or dark. */
export function ThemeSwitch({ vertical, className }: { vertical?: boolean; className?: string }) {
  const preference = useThemePreference()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex gap-0.5 rounded-[var(--radius-control)] border border-line bg-sunk p-0.5',
        vertical && 'flex-col',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = preference === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setThemePreference(value)}
            className={cn(
              'grid size-7 place-items-center rounded-[5px] transition-colors',
              on ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
