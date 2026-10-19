'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from 'sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              '!bg-ink !text-paper !border-ink !rounded-[var(--radius-control)] !font-sans !text-[13.5px] !shadow-none',
            description: '!text-paper/70',
            actionButton: '!bg-kodak !text-ink !font-semibold',
          },
        }}
      />
    </QueryClientProvider>
  )
}
