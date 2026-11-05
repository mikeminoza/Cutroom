import type { Metadata } from 'next'
import { GrowPage } from '@/components/grow-page'

export const metadata: Metadata = { title: 'Grow the channel' }

export default function Page() {
  return <GrowPage />
}
