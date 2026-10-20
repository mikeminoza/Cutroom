import type { Metadata } from 'next'
import { IdeasPage } from '@/components/ideas-page'

export const metadata: Metadata = { title: 'Ideas' }

export default function Page() {
  return <IdeasPage />
}
