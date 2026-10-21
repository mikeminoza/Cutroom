'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False on the server and while React hydrates, true afterwards. Pages under a <Suspense> can
 * hydrate after their data has already arrived; rendering data-driven parts only once hydrated
 * keeps the client's first render identical to the server's.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

export function ClientOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  return useHydrated() ? children : fallback
}
