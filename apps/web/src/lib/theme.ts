'use client'

// Light, dark, or the system's choice. The preference lives in localStorage (per browser); the
// theme in effect is <html data-theme>, which globals.css keys the dark colors off. THEME_SCRIPT
// sets it before the first paint, so a dark page never flashes white.
import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'cutroom-theme'
const DARK = '(prefers-color-scheme: dark)'

/** Inlined into <head> by the root layout. Keep it tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){var p;try{p=localStorage.getItem('${KEY}')}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('${DARK}').matches);document.documentElement.dataset.theme=d?'dark':'light'})()`

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

let preference: ThemePreference | null = null
const listeners = new Set<() => void>()
let watching = false

function currentPreference(): ThemePreference {
  preference ??= readPreference()
  return preference
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function apply() {
  const pref = currentPreference()
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia(DARK).matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!watching) {
    watching = true
    // Follow the system live while on "system", and changes made in another tab.
    window.matchMedia(DARK).addEventListener('change', () => {
      if (currentPreference() === 'system') apply()
    })
    window.addEventListener('storage', (event) => {
      if (event.key !== KEY) return
      preference = readPreference()
      apply()
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Private mode or storage blocked: the choice lasts until the page reloads.
  }
  apply()
}

/** What the person picked: system, light or dark. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, currentPreference, () => 'system')
}

/** The theme on screen right now, for things CSS can't reach (canvas colors, the toaster). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light')
}
