import type { Metadata } from 'next'
import { SetupPage } from '@/components/setup-page'

export const metadata: Metadata = { title: 'Channel setup' }

export default function Page() {
  return <SetupPage />
}
