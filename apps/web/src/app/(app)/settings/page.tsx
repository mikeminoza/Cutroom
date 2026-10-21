import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ClientOnly } from '@/components/client-only'
import { SettingsPage } from '@/components/settings-page'

export const metadata: Metadata = { title: 'Settings' }

export default function Page() {
  return (
    <Suspense>
      <ClientOnly>
        <SettingsPage />
      </ClientOnly>
    </Suspense>
  )
}
