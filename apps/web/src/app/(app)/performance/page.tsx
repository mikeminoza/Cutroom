import type { Metadata } from 'next'
import { PerformancePage } from '@/components/performance-page'

export const metadata: Metadata = { title: 'Performance' }

export default function Page() {
  return <PerformancePage />
}
