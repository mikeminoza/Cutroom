// Render's free instances sleep after 15 minutes without incoming requests, even mid-render.
// While a job runs, the worker calls its own public address every few minutes, which counts as
// incoming traffic, so a job finishes even when no Cutroom tab is open. Idle, it lets itself sleep.
const INTERVAL_MS = 4 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

/** Render sets RENDER_EXTERNAL_URL; WORKER_PUBLIC_URL covers other hosts. */
export function publicUrl(): string | null {
  const url = process.env.WORKER_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL
  return url ? url.replace(/\/$/, '') : null
}

export function keepAwake(on: boolean) {
  if (!on) {
    if (timer) clearInterval(timer)
    timer = null
    return
  }
  const url = publicUrl()
  if (!url || timer) return
  timer = setInterval(() => {
    fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => {})
  }, INTERVAL_MS)
  timer.unref()
}
