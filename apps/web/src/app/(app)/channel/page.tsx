import type { Metadata } from 'next'
import { ChannelPage } from '@/components/channel-page'

export const metadata: Metadata = { title: 'YouTube channel' }

export default function Page() {
  return <ChannelPage />
}
