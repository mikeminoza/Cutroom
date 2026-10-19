import { Suspense } from 'react'
import { Workspace } from '@/components/project/workspace'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <Workspace id={id} />
    </Suspense>
  )
}
