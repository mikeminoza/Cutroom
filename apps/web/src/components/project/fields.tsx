'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import type { StatusDTO } from '@/lib/dto'
import { useStatus } from '@/lib/hooks'
import { type UploadFolder, uploadFile } from '@/lib/upload'

/** Keeps a local draft while focused so server refreshes never fight your typing. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return {
    draft,
    setDraft,
    focusProps: {
      onFocus: () => {
        focused.current = true
      },
      onBlur: () => {
        focused.current = false
      },
    },
  }
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onValue: (value: string) => void
}

export function SyncedInput({ value, onValue, ...rest }: InputProps) {
  const { draft, setDraft, focusProps } = useDraft(value)
  return (
    <Input
      {...rest}
      {...focusProps}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        onValue(e.target.value)
      }}
    />
  )
}

type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValue: (value: string) => void
}

export function SyncedTextarea({ value, onValue, ...rest }: TextareaProps) {
  const { draft, setDraft, focusProps } = useDraft(value)
  return (
    <Textarea
      {...rest}
      {...focusProps}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        onValue(e.target.value)
      }}
    />
  )
}

export function useUploader(projectId: string) {
  const { data: status } = useStatus()
  return useCallback(
    async (file: File, folder: UploadFolder, onProgress?: (fraction: number) => void) => {
      const driver = status?.storage ?? (await api.get<StatusDTO>('/api/status')).storage
      return uploadFile(file, projectId, folder, driver, onProgress)
    },
    [projectId, status?.storage],
  )
}
