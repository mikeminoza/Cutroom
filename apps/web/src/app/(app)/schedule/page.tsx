import type { Metadata } from 'next'
import { SchedulePage } from '@/components/schedule-page'

export const metadata: Metadata = { title: 'Schedule' }

export default function Page() {
  return <SchedulePage />
}
